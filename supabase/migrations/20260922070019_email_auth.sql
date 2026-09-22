-- PAWME V1 — sign-in moves from phone OTP to EMAIL OTP (pilot decision, 2026-09-22).
--
-- What changes:
--   * owners.email_verified_at — set from auth.users.email_confirmed_at. The
--     "Verified" badge now means the login email is confirmed.
--   * owners.email defaults to the login email at sign-up (it was a separately
--     entered notification address; people can still change it in Settings).
--   * The ban-on-suspension record is keyed on EMAIL now: banned_phones becomes
--     banned_identities (identity_hash + kind). Suspending records the email
--     hash (and the phone hash too, if the account has a phone). Re-signing up
--     with a banned email starts suspended. Same design as before.
--   * Email normalisation before hashing: lower-case, trimmed, "+tag" removed,
--     and dots removed for gmail.com — so the obvious aliases of a banned address
--     are banned too. (It cannot stop a genuinely new address; nothing can.)
-- What stays: the phone columns, phone_hash() and phone_verified_at remain,
-- dormant, so phone can return later as an optional extra verification badge.

alter table public.owners add column email_verified_at timestamptz;

alter table public.banned_phones rename to banned_identities;
alter table public.banned_identities rename column phone_hash to identity_hash;
alter table public.banned_identities add column kind text not null default 'phone' check (kind in ('phone', 'email'));
alter table public.banned_identities alter column kind drop default;
alter index banned_phones_report_id_idx rename to banned_identities_report_id_idx;
alter index banned_phones_banned_by_idx rename to banned_identities_banned_by_idx;

create function private.email_hash(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_local text;
  v_domain text;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+$' then return null; end if;
  v_local := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);
  v_local := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return encode(sha256(convert_to(v_local || '@' || v_domain, 'UTF8')), 'hex');
end;
$$;

create function private.is_identity_banned(p_email text, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.banned_identities b
    where (b.kind = 'email' and b.identity_hash = private.email_hash(p_email))
       or (b.kind = 'phone' and b.identity_hash = private.phone_hash(p_phone))
  );
$$;

-- auth.users → owners: email + verification stamps, ban carried over.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_banned boolean := private.is_identity_banned(new.email, new.phone);
begin
  insert into public.owners (id, email, email_verified_at, phone_verified_at, status, suspended_at)
  values (
    new.id,
    case when new.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(new.email) <= 254 then lower(new.email) end,
    new.email_confirmed_at,
    new.phone_confirmed_at,
    case when v_banned then 'suspended' else 'active' end::public.owner_status,
    case when v_banned then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Email or phone confirmed / changed: stamp the badge, apply any ban.
create or replace function private.handle_user_identity_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is distinct from old.email_confirmed_at then
    update public.owners set email_verified_at = new.email_confirmed_at where id = new.id;
  end if;
  if new.phone_confirmed_at is distinct from old.phone_confirmed_at then
    update public.owners set phone_verified_at = new.phone_confirmed_at where id = new.id;
  end if;
  if private.is_identity_banned(new.email, new.phone) then
    update public.owners set status = 'suspended', suspended_at = now()
    where id = new.id and status <> 'suspended';
  end if;
  return new;
end;
$$;

drop trigger on_auth_user_phone_confirmed on auth.users;
drop function private.handle_user_phone_confirmed();
drop function private.is_phone_banned(text);
create trigger on_auth_user_identity_confirmed after update of email, email_confirmed_at, phone, phone_confirmed_at on auth.users
  for each row execute function private.handle_user_identity_confirmed();

-- Suspend: record the email hash (and the phone hash if there is one).
create or replace function public.resolve_report(p_report_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_report public.reports;
  v_user auth.users;
begin
  if not private.is_moderator() then raise exception 'NOT_A_MODERATOR'; end if;
  if p_action not in ('suspend', 'dismiss') then raise exception 'INVALID_ACTION'; end if;
  select * into v_report from public.reports r where r.id = p_report_id for update;
  if not found then raise exception 'REPORT_NOT_FOUND'; end if;

  if p_action = 'dismiss' then
    update public.reports r set status = 'dismissed', resolved_by = v_uid, resolved_at = now() where r.id = p_report_id;
    return;
  end if;

  if v_report.target_owner_id is null then raise exception 'REPORT_TARGET_GONE'; end if;
  if v_report.target_owner_id = v_uid then raise exception 'CANNOT_SUSPEND_SELF'; end if;
  update public.owners o set status = 'suspended', suspended_at = now() where o.id = v_report.target_owner_id;

  select * into v_user from auth.users u where u.id = v_report.target_owner_id;
  insert into public.banned_identities (identity_hash, kind, reason, report_id, banned_by)
  select h, k, v_report.reason, v_report.id, v_uid
  from (values (private.email_hash(v_user.email), 'email'), (private.phone_hash(v_user.phone), 'phone')) as v(h, k)
  where h is not null
  on conflict (identity_hash) do nothing;

  update public.reports r set status = 'actioned', resolved_by = v_uid, resolved_at = now()
  where r.target_owner_id = v_report.target_owner_id and r.status = 'open';
end;
$$;

create or replace function public.unsuspend_owner(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user auth.users;
begin
  if not private.is_moderator() then raise exception 'NOT_A_MODERATOR'; end if;
  update public.owners o set status = 'active', suspended_at = null where o.id = p_owner_id and o.status = 'suspended';
  if not found then raise exception 'OWNER_NOT_SUSPENDED'; end if;
  select * into v_user from auth.users u where u.id = p_owner_id;
  delete from public.banned_identities b
  where b.identity_hash in (private.email_hash(v_user.email), private.phone_hash(v_user.phone));
end;
$$;

-- The badge now reflects the confirmed login email.
create or replace function public.get_deck(p_pet_id uuid, p_limit integer default null)
returns table (
  pet_id uuid,
  owner_id uuid,
  owner_name text,
  verified boolean,
  name text,
  species public.pet_species,
  breed text,
  is_mixed boolean,
  sex public.pet_sex,
  age_months integer,
  size public.pet_size,
  intents public.pet_intent[],
  tags public.pet_tag[],
  photos text[],
  distance_km numeric,
  super_pawed_you boolean,
  why text[]
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_me public.pets;
  v_owner public.owners;
  v_cfg public.ranking_config;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into v_me from public.pets p where p.id = p_pet_id and p.owner_id = v_uid;
  if not found then raise exception 'NOT_YOUR_PET'; end if;
  select * into v_owner from public.owners o where o.id = v_uid;
  if v_owner.status <> 'active' then raise exception 'SUSPENDED'; end if;
  if v_owner.cluster_id is null then raise exception 'NOT_IN_CLUSTER'; end if;
  select * into v_cfg from public.ranking_config c where c.cluster_id = v_owner.cluster_id;

  -- Opening Discover counts as activity (recency drives ranking). At most one
  -- write per five minutes.
  if v_owner.last_active_at < now() - interval '5 minutes' then
    update public.owners o set last_active_at = now() where o.id = v_uid;
    update public.pets p set last_active_at = now() where p.owner_id = v_uid;
  end if;

  return query
  with candidates as (
    -- Most recently active first, capped, via pets_cluster_last_active_idx.
    select p.*, o.display_name, o.email_verified_at, o.loc_lat, o.loc_lng, o.show_distance
    from public.pets p
    join public.owners o on o.id = p.owner_id
    where p.cluster_id = v_owner.cluster_id
      and p.species = v_me.species
      and p.owner_id <> v_uid
      and o.status = 'active'
      and o.discoverable
      and o.loc_lat is not null
      -- a card needs at least one photo and its tags
      and exists (select 1 from public.pet_photos ph where ph.pet_id = p.id)
      and (select count(*) from public.pet_tags pt where pt.pet_id = p.id) >= 2
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = v_uid and b.blocked_id = p.owner_id)
           or (b.blocker_id = p.owner_id and b.blocked_id = v_uid)
      )
      -- already liked, or passed within the cooldown
      and not exists (
        select 1 from public.likes l
        where l.from_pet_id = v_me.id and l.to_pet_id = p.id
          and (l.action <> 'pass' or l.created_at > now() - make_interval(days => v_cfg.pass_cooldown_days))
      )
      -- matched before (active or unmatched): never shown again
      and not exists (
        select 1 from public.matches m
        where m.pet_a_id = least(v_me.id, p.id) and m.pet_b_id = greatest(v_me.id, p.id)
      )
    order by p.last_active_at desc
    limit 500
  ),
  scored as (
    select
      c.*,
      s.why as why_codes,
      liked.action as their_action,
      private.distance_m(v_owner.loc_lat, v_owner.loc_lng, c.loc_lat, c.loc_lng) as dist_m,
      (select count(*) from public.pet_photos ph where ph.pet_id = c.id) as photo_count,
      (select count(*) from public.pet_tags pt where pt.pet_id = c.id) as tag_count,
      s.intent_overlap, s.tag_compatibility, s.size_fit, s.age_fit
    from candidates c
    cross join lateral private.pair_signals(v_me.id, c.id) s
    left join public.likes liked
      on liked.from_pet_id = c.id and liked.to_pet_id = v_me.id and liked.action in ('like', 'super')
  )
  select
    sc.id,
    sc.owner_id,
    sc.display_name,
    sc.email_verified_at is not null,
    sc.name,
    sc.species,
    sc.breed,
    sc.is_mixed,
    sc.sex,
    (extract(year from age(current_date, sc.birth_date)) * 12 + extract(month from age(current_date, sc.birth_date)))::integer,
    sc.size,
    sc.intents,
    array(select pt.tag from public.pet_tags pt where pt.pet_id = sc.id order by pt.tag),
    array(select ph.storage_path from public.pet_photos ph where ph.pet_id = sc.id order by ph.position),
    private.display_distance_km(v_owner.loc_lat, v_owner.loc_lng, sc.loc_lat, sc.loc_lng, sc.show_distance),
    coalesce(sc.their_action = 'super', false),
    case when sc.dist_m < 1000 then sc.why_codes || 'very_close'::text else sc.why_codes end
  from scored sc
  order by (
      v_cfg.w_intent_overlap * sc.intent_overlap
    + v_cfg.w_tag_compatibility * sc.tag_compatibility
    + v_cfg.w_size_fit * sc.size_fit
    + v_cfg.w_age_fit * sc.age_fit
    + v_cfg.w_proximity * (1 - least(1.0, sc.dist_m / (2.0 * v_cfg.radius_m)))
    + v_cfg.w_recency * power(0.5, extract(epoch from (now() - sc.last_active_at)) / 86400.0 / v_cfg.recency_halflife_days)
    + v_cfg.w_completeness * (0.5 * least(sc.photo_count, 5) / 5.0 + 0.3 * least(sc.tag_count, 4) / 4.0 + case when sc.breed is not null then 0.2 else 0 end)
    + v_cfg.w_liked_you * case when sc.their_action is not null then 1 else 0 end
    + v_cfg.w_random * random()
  ) desc
  limit least(coalesce(p_limit, v_cfg.deck_size), 50);
end;
$$;

create or replace function public.get_pet_profile(p_viewer_pet_id uuid, p_pet_id uuid)
returns table (
  pet_id uuid,
  owner_id uuid,
  owner_name text,
  verified boolean,
  name text,
  species public.pet_species,
  breed text,
  is_mixed boolean,
  sex public.pet_sex,
  age_months integer,
  size public.pet_size,
  intents public.pet_intent[],
  tags public.pet_tag[],
  photos text[],
  distance_km numeric,
  is_matched boolean,
  why text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_owner public.owners;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from public.pets p where p.id = p_viewer_pet_id and p.owner_id = v_uid) then
    raise exception 'NOT_YOUR_PET';
  end if;
  select * into v_owner from public.owners o where o.id = v_uid;
  if v_owner.status <> 'active' then raise exception 'SUSPENDED'; end if;

  return query
  select
    p.id, p.owner_id, o.display_name, o.email_verified_at is not null,
    p.name, p.species, p.breed, p.is_mixed, p.sex,
    (extract(year from age(current_date, p.birth_date)) * 12 + extract(month from age(current_date, p.birth_date)))::integer,
    p.size, p.intents,
    array(select pt.tag from public.pet_tags pt where pt.pet_id = p.id order by pt.tag),
    array(select ph.storage_path from public.pet_photos ph where ph.pet_id = p.id order by ph.position),
    private.display_distance_km(v_owner.loc_lat, v_owner.loc_lng, o.loc_lat, o.loc_lng, o.show_distance),
    m.id is not null,
    s.why
  from public.pets p
  join public.owners o on o.id = p.owner_id
  left join public.matches m
    on m.pet_a_id = least(p_viewer_pet_id, p.id) and m.pet_b_id = greatest(p_viewer_pet_id, p.id) and m.status = 'active'
  cross join lateral private.pair_signals(p_viewer_pet_id, p.id) s
  where p.id = p_pet_id
    and o.status = 'active'
    and not private.is_blocked_between(v_uid, p.owner_id)
    and (m.id is not null or (p.cluster_id is not null and p.cluster_id = v_owner.cluster_id));
end;
$$;

-- Data export: the login email is part of what we hold.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'phone', u.phone, 'created_at', u.created_at) from auth.users u where u.id = v_uid),
    'owner', (select to_jsonb(o) - 'role' from public.owners o where o.id = v_uid),
    'pets', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from public.pets p where p.owner_id = v_uid),
    'pet_photos', (select coalesce(jsonb_agg(to_jsonb(ph)), '[]') from public.pet_photos ph join public.pets p on p.id = ph.pet_id where p.owner_id = v_uid),
    'pet_tags', (select coalesce(jsonb_agg(to_jsonb(pt)), '[]') from public.pet_tags pt join public.pets p on p.id = pt.pet_id where p.owner_id = v_uid),
    'swipes', (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from public.likes l where l.from_owner_id = v_uid),
    'matches', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.matches m where v_uid in (m.owner_a_id, m.owner_b_id)),
    'messages_sent', (select coalesce(jsonb_agg(to_jsonb(msg) order by msg.created_at), '[]') from public.messages msg where msg.sender_id = v_uid),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status, 'created_at', r.created_at)), '[]') from public.reports r where r.reporter_id = v_uid),
    'blocks', (select coalesce(jsonb_agg(to_jsonb(b)), '[]') from public.blocks b where b.blocker_id = v_uid),
    'playdate_feedback', (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from public.playdate_feedback f where f.owner_id = v_uid),
    'waitlist', (select to_jsonb(w) from public.waitlist w where w.owner_id = v_uid)
  );
end;
$$;

revoke execute on function private.email_hash(text), private.is_identity_banned(text, text) from public, anon, authenticated;
grant execute on function private.email_hash(text), private.is_identity_banned(text, text) to service_role;
