-- PAWME V1 — functions for the settings screen (§5 screen 9). No new tables.
--
-- Why functions and not plain table access:
--   * set_pet_photos: adding, removing and re-ordering photos has to be ONE
--     atomic change. Done as separate deletes/inserts from the client, a dropped
--     connection half-way could leave a pet with no photo rows, which silently
--     removes it from every deck.
--   * get_my_blocks / get_my_reports: a user can read their own blocks and reports
--     rows, but those only hold ids. The other owner's first name and pet name are
--     not readable through RLS (by design), so these return just those two
--     public-safe fields for rows the caller already owns.

-- Replace a pet's photo list: 1–5 storage paths, in display order ([1] = main).
-- Returns the paths that were dropped so the client can delete the objects.
create function public.set_pet_photos(p_pet_id uuid, p_paths text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_paths text[];
  v_removed text[];
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from public.pets p where p.id = p_pet_id and p.owner_id = v_uid) then
    raise exception 'NOT_YOUR_PET';
  end if;
  if not private.is_active_owner() then raise exception 'SUSPENDED'; end if;

  -- de-duplicate, keeping first occurrence order
  select coalesce(array_agg(path order by first_pos), '{}') into v_paths
  from (select path, min(pos) as first_pos from unnest(p_paths) with ordinality as u(path, pos) where path is not null group by path) d;

  if cardinality(v_paths) not between 1 and 5 then raise exception 'PHOTOS_MUST_BE_1_TO_5'; end if;
  -- every path must sit in the caller's own storage folder
  if exists (select 1 from unnest(v_paths) as path where path not like v_uid::text || '/%' or char_length(path) > 300) then
    raise exception 'PHOTO_PATH_NOT_YOURS';
  end if;

  select coalesce(array_agg(ph.storage_path), '{}') into v_removed
  from public.pet_photos ph
  where ph.pet_id = p_pet_id and ph.storage_path <> all (v_paths);

  delete from public.pet_photos ph where ph.pet_id = p_pet_id;
  insert into public.pet_photos (pet_id, storage_path, position)
  select p_pet_id, path, pos::smallint from unnest(v_paths) with ordinality as u(path, pos);

  return v_removed;
end;
$$;

-- Owners I have blocked, newest first, with the only two things I may know about
-- them: the owner's first name and their pet's name.
create function public.get_my_blocks()
returns table (blocked_id uuid, owner_name text, pet_name text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.blocked_id, o.display_name,
         (select p.name from public.pets p where p.owner_id = b.blocked_id order by p.created_at limit 1),
         b.created_at
  from public.blocks b
  join public.owners o on o.id = b.blocked_id
  where b.blocker_id = (select auth.uid())
  order by b.created_at desc;
$$;

-- Reports I filed ("report history"). Status only — never who handled it or how.
create function public.get_my_reports()
returns table (report_id uuid, reason public.report_reason, status public.report_status, details text, owner_name text, pet_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.reason, r.status, r.details, o.display_name, p.name, r.created_at
  from public.reports r
  left join public.owners o on o.id = r.target_owner_id
  left join public.pets p on p.id = r.target_pet_id
  where r.reporter_id = (select auth.uid())
  order by r.created_at desc
  limit 100;
$$;

revoke execute on function public.set_pet_photos(uuid, text[]), public.get_my_blocks(), public.get_my_reports() from public, anon, authenticated;
grant execute on function public.set_pet_photos(uuid, text[]), public.get_my_blocks(), public.get_my_reports() to authenticated, service_role;
