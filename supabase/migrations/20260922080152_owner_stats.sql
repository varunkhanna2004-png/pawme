-- PAWME V1 — headline counts for the pilot (moderator-only, read-only).
-- No new tables. Glance-at-daily numbers only; no funnel or retention.
create function public.get_owner_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  if not private.is_moderator() then raise exception 'NOT_A_MODERATOR'; end if;
  select jsonb_build_object(
    'owners_total',        (select count(*) from public.owners),
    'owners_active',       (select count(*) from public.owners where status = 'active' and cluster_id is not null),
    'owners_suspended',    (select count(*) from public.owners where status = 'suspended'),
    'owners_seed',         (select count(*) from public.owners where is_seed),
    'signups_7d',          (select count(*) from public.owners where created_at >= now() - interval '7 days'),
    'waitlisted',          (select count(*) from public.waitlist),
    'pets',                (select count(*) from public.pets),
    'pets_discoverable',   (select count(*) from public.pets p join public.owners o on o.id = p.owner_id
                             where o.status = 'active' and o.discoverable and p.cluster_id is not null
                               and exists (select 1 from public.pet_photos ph where ph.pet_id = p.id)),
    'swipes',              (select count(*) from public.likes),
    'matches_total',       (select count(*) from public.matches),
    'matches_active',      (select count(*) from public.matches where status = 'active'),
    'messages',            (select count(*) from public.messages),
    'playdates_proposed',  (select count(*) from public.messages where kind = 'playdate_proposal'),
    'playdates_accepted',  (select count(*) from public.messages where kind = 'playdate_proposal' and payload ->> 'status' = 'accepted'),
    'reports_open',        (select count(*) from public.reports where status = 'open'),
    'as_of',               now()
  ) into v;
  return v;
end;
$$;

revoke execute on function public.get_owner_stats() from public, anon, authenticated;
grant execute on function public.get_owner_stats() to authenticated, service_role;
