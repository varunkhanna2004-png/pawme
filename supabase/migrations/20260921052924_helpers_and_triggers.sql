-- PAWME V1 — private helpers (geo + RLS predicates) and triggers.
--
-- Everything here lives in `private`, which is not exposed over the API.
-- SECURITY DEFINER is used only where a predicate must look past the caller's
-- own rows (e.g. "is there a block between us?"); each such function pins
-- search_path and keys off auth.uid() so it cannot be pointed at another user.

-- ---------------------------------------------------------------------------
-- Geo
-- ---------------------------------------------------------------------------

-- Great-circle distance in metres.
create function private.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(least(1.0,
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- Snap a coordinate to the centre of a grid_m × grid_m cell (§3.3). The
-- longitude step is derived from the snapped latitude, so snapping an already
-- snapped point returns the same point.
create function private.snap(lat double precision, lng double precision, grid_m integer, out snapped_lat double precision, out snapped_lng double precision)
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  lat_step double precision := grid_m / 111320.0;
  lng_step double precision;
begin
  snapped_lat := round((lat / lat_step)::numeric) * lat_step;
  lng_step := grid_m / (111320.0 * cos(radians(snapped_lat)));
  snapped_lng := round((lng / lng_step)::numeric) * lng_step;
  snapped_lat := round(snapped_lat::numeric, 6);
  snapped_lng := round(snapped_lng::numeric, 6);
end;
$$;

-- The active cluster containing this point, or null. Within radius AND, when a
-- boundary is set, inside it. Nearest centroid wins if clusters ever overlap.
create function private.find_cluster(lat double precision, lng double precision)
returns text
language sql
stable
set search_path = ''
as $$
  select c.cluster_id
  from public.ranking_config c
  where c.is_active
    and private.distance_m(c.centroid_lat, c.centroid_lng, lat, lng) <= c.radius_m
    and (c.boundary is null or c.boundary @> point(lng, lat))
  order by private.distance_m(c.centroid_lat, c.centroid_lng, lat, lng)
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- RLS predicates
-- ---------------------------------------------------------------------------

create function private.is_active_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.owners o
    where o.id = (select auth.uid()) and o.status = 'active'
  );
$$;

-- Moderator status comes from the owners table, never from JWT user metadata
-- (which users can edit).
create function private.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.owners o
    where o.id = (select auth.uid()) and o.role = 'moderator' and o.status = 'active'
  );
$$;

create function private.owns_pet(p_pet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pets p
    where p.id = p_pet_id and p.owner_id = (select auth.uid())
  );
$$;

-- A pet row is directly readable if it is mine or actively matched with one of
-- mine. Everyone else's pets are reachable only through get_deck() /
-- get_pet_profile(), which return public-safe fields.
create function private.can_see_pet(p_pet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pets p
    where p.id = p_pet_id and p.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.matches m
    where m.status = 'active'
      and ((m.pet_a_id = p_pet_id and m.owner_b_id = (select auth.uid()))
        or (m.pet_b_id = p_pet_id and m.owner_a_id = (select auth.uid())))
  );
$$;

create function private.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks bl
    where (bl.blocker_id = a and bl.blocked_id = b)
       or (bl.blocker_id = b and bl.blocked_id = a)
  );
$$;

create function private.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and (select auth.uid()) in (c.owner_a_id, c.owner_b_id)
  );
$$;

-- §8: chat only after a mutual match. Posting needs an active match, an active
-- (non-suspended) sender and no block in either direction.
create function private.can_post(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversations c
    join public.matches m on m.id = c.match_id
    join public.owners me on me.id = (select auth.uid())
    where c.id = p_conversation_id
      and me.id in (c.owner_a_id, c.owner_b_id)
      and me.status = 'active'
      and m.status = 'active'
      and not private.is_blocked_between(c.owner_a_id, c.owner_b_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger owners_set_updated_at before update on public.owners
  for each row execute function private.set_updated_at();
create trigger pets_set_updated_at before update on public.pets
  for each row execute function private.set_updated_at();
create trigger ranking_config_set_updated_at before update on public.ranking_config
  for each row execute function private.set_updated_at();

-- auth.users → owners. Runs inside the signup transaction, so it must not fail.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.owners (id, phone_verified_at)
  values (new.id, new.phone_confirmed_at)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- The OTP is confirmed after the user row exists; this is what earns the
-- "Verified" badge (§9).
create function private.handle_user_phone_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phone_confirmed_at is distinct from old.phone_confirmed_at then
    update public.owners set phone_verified_at = new.phone_confirmed_at where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_phone_confirmed after update of phone_confirmed_at on auth.users
  for each row execute function private.handle_user_phone_confirmed();

-- §3.5: no fake data in production. is_seed rows are refused unless a cluster
-- row has allow_seed = true, which is only ever set by hand in the dev project.
create function private.guard_seed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_seed and not exists (select 1 from public.ranking_config c where c.allow_seed) then
    raise exception 'SEED_NOT_ALLOWED'
      using hint = 'Seed data is dev-only. ranking_config.allow_seed is false in this project.';
  end if;
  return new;
end;
$$;

create trigger owners_guard_seed before insert or update of is_seed on public.owners
  for each row execute function private.guard_seed();
create trigger pets_guard_seed before insert or update of is_seed on public.pets
  for each row execute function private.guard_seed();

-- Pets inherit their cluster from the owner; clients cannot set it.
create function private.pets_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select o.cluster_id into new.cluster_id from public.owners o where o.id = new.owner_id;
  new.intents := array(select distinct i from unnest(new.intents) as i order by i);
  return new;
end;
$$;

create trigger pets_before_write before insert or update on public.pets
  for each row execute function private.pets_before_write();

create function private.owners_sync_pet_cluster()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pets set cluster_id = new.cluster_id where owner_id = new.id;
  return null;
end;
$$;

create trigger owners_sync_pet_cluster after update of cluster_id on public.owners
  for each row when (new.cluster_id is distinct from old.cluster_id)
  execute function private.owners_sync_pet_cluster();

-- Messages: the server, not the client, decides who sent it and when. A new
-- playdate proposal always starts as 'proposed'; respond_playdate() is the
-- only way to change that.
create function private.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place text;
begin
  if (select auth.uid()) is not null then
    new.sender_id := (select auth.uid());
    new.created_at := now();
  end if;

  if new.kind = 'playdate_proposal' then
    v_place := btrim(coalesce(new.payload ->> 'place', ''));
    if char_length(v_place) not between 1 and 120 then
      raise exception 'PLAYDATE_PLACE_INVALID';
    end if;
    -- Raises if starts_at is not a valid timestamp.
    perform (new.payload ->> 'starts_at')::timestamptz;
    new.payload := jsonb_build_object(
      'place', v_place,
      'starts_at', new.payload ->> 'starts_at',
      'note', left(coalesce(new.payload ->> 'note', ''), 280),
      'status', 'proposed'
    );
  end if;
  return new;
end;
$$;

create trigger messages_before_insert before insert on public.messages
  for each row execute function private.messages_before_insert();

create function private.messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
  set last_message_at = new.created_at,
      last_message_preview = case new.kind
        when 'text' then left(new.body, 80)
        when 'photo' then '📷 Photo'
        else '📅 Playdate proposal'
      end,
      a_last_read_at = case when c.owner_a_id = new.sender_id then new.created_at else c.a_last_read_at end,
      b_last_read_at = case when c.owner_b_id = new.sender_id then new.created_at else c.b_last_read_at end
  where c.id = new.conversation_id;
  return null;
end;
$$;

create trigger messages_after_insert after insert on public.messages
  for each row execute function private.messages_after_insert();

-- Blocking someone ends every active match with them.
create function private.blocks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.matches m
  set status = 'unmatched', unmatched_by = new.blocker_id, unmatched_at = now()
  where m.status = 'active'
    and ((m.owner_a_id = new.blocker_id and m.owner_b_id = new.blocked_id)
      or (m.owner_a_id = new.blocked_id and m.owner_b_id = new.blocker_id));
  return null;
end;
$$;

create trigger blocks_after_insert after insert on public.blocks
  for each row execute function private.blocks_after_insert();

-- Reports: the reporter is always the caller. A reported pet must belong to the
-- reported owner; a reported message must have been sent by them in one of the
-- reporter's conversations. The message text is snapshotted as evidence.
create function private.reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.reporter_id := (select auth.uid());
    new.status := 'open';
    new.resolved_by := null;
    new.resolved_at := null;
  end if;

  if new.target_owner_id is null then
    raise exception 'REPORT_TARGET_REQUIRED';
  end if;

  if new.target_pet_id is not null and not exists (
    select 1 from public.pets p where p.id = new.target_pet_id and p.owner_id = new.target_owner_id
  ) then
    raise exception 'REPORT_PET_MISMATCH';
  end if;

  if new.message_id is not null then
    select coalesce(msg.body, msg.photo_path, msg.payload::text)
    into new.message_snapshot
    from public.messages msg
    join public.conversations c on c.id = msg.conversation_id
    where msg.id = new.message_id
      and msg.sender_id = new.target_owner_id
      and new.reporter_id in (c.owner_a_id, c.owner_b_id);
    if not found then
      raise exception 'REPORT_MESSAGE_MISMATCH';
    end if;
  else
    new.message_snapshot := null;
  end if;
  return new;
end;
$$;

create trigger reports_before_insert before insert on public.reports
  for each row execute function private.reports_before_insert();

-- ---------------------------------------------------------------------------
-- Execute privileges: nothing in `private` is callable by default.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;

-- Only the predicates referenced by RLS policies are granted.
grant execute on function
  private.is_active_owner(),
  private.is_moderator(),
  private.owns_pet(uuid),
  private.can_see_pet(uuid),
  private.is_conversation_participant(uuid),
  private.can_post(uuid)
to authenticated;

grant execute on all functions in schema private to service_role;
