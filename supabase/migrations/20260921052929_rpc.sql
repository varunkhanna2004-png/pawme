-- PAWME V1 — the functions the app calls (supabase.rpc).
--
-- These are SECURITY DEFINER on purpose: each one has to look at rows the
-- caller may not read directly (other owners' snapped locations, reverse
-- likes, the ranking weights). The rules that keep that safe:
--   * search_path is pinned to '' and every object is schema-qualified;
--   * identity always comes from auth.uid(), never from an argument;
--   * only public-safe fields are returned — never coordinates, phone numbers,
--     emails, scores or weights;
--   * EXECUTE is revoked from PUBLIC/anon and granted to `authenticated` only
--     (see the bottom of this file).
--
-- Errors are raised as short codes (e.g. 'NOT_IN_CLUSTER') for the client to map
-- to copy.

-- ---------------------------------------------------------------------------
-- Pair signals: the rule-based half of ranking, shared by the deck and the
-- full-profile view. Each component is 0..1. `why` holds reason codes for the
-- "Why this match" line (§7); the client turns codes into words, so the
-- formula and weights stay server-side.
-- ---------------------------------------------------------------------------
create function private.pair_signals(
  p_viewer_pet_id uuid,
  p_target_pet_id uuid,
  out intent_overlap double precision,
  out tag_compatibility double precision,
  out size_fit double precision,
  out age_fit double precision,
  out why text[]
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.pets;
  t public.pets;
  v_tags public.pet_tag[];
  t_tags public.pet_tag[];
  shared_tags public.pet_tag[];
  shared_intents public.pet_intent[];
  union_tags integer;
  union_intents integer;
  v_energy integer;
  t_energy integer;
  v_stage integer;
  t_stage integer;
  size_gap integer;
  high constant public.pet_tag[] := array['playful', 'energetic', 'loves_fetch', 'loves_walks']::public.pet_tag[];
  low constant public.pet_tag[] := array['calm', 'couch_potato', 'shy', 'gentle']::public.pet_tag[];
begin
  select * into v from public.pets where id = p_viewer_pet_id;
  select * into t from public.pets where id = p_target_pet_id;
  select coalesce(array_agg(pt.tag order by pt.tag), '{}') into v_tags from public.pet_tags pt where pt.pet_id = p_viewer_pet_id;
  select coalesce(array_agg(pt.tag order by pt.tag), '{}') into t_tags from public.pet_tags pt where pt.pet_id = p_target_pet_id;

  shared_intents := array(select unnest(v.intents) intersect select unnest(t.intents) order by 1);
  union_intents := (select count(*) from (select unnest(v.intents) union select unnest(t.intents)) u);
  intent_overlap := coalesce(cardinality(shared_intents)::double precision / nullif(union_intents, 0), 0);

  shared_tags := array(select unnest(v_tags) intersect select unnest(t_tags) order by 1);
  union_tags := (select count(*) from (select unnest(v_tags) union select unnest(t_tags)) u);

  -- Energy: -1 mellow, 0 mixed/unknown, +1 lively.
  v_energy := sign((select count(*) from unnest(v_tags) x where x = any (high)) - (select count(*) from unnest(v_tags) x where x = any (low)));
  t_energy := sign((select count(*) from unnest(t_tags) x where x = any (high)) - (select count(*) from unnest(t_tags) x where x = any (low)));

  tag_compatibility :=
    0.6 * coalesce(cardinality(shared_tags)::double precision / nullif(union_tags, 0), 0)
    + 0.4 * (1 - abs(v_energy - t_energy) / 2.0);

  size_gap := abs(array_position(enum_range(null::public.pet_size), v.size) - array_position(enum_range(null::public.pet_size), t.size));
  size_fit := case size_gap when 0 then 1.0 when 1 then 0.5 else 0.0 end;

  -- Life stage: young (<1y), adult, senior (8y+).
  v_stage := case when v.birth_date > current_date - interval '1 year' then 0 when v.birth_date > current_date - interval '8 years' then 1 else 2 end;
  t_stage := case when t.birth_date > current_date - interval '1 year' then 0 when t.birth_date > current_date - interval '8 years' then 1 else 2 end;
  age_fit := case abs(v_stage - t_stage) when 0 then 1.0 when 1 then 0.5 else 0.0 end;

  why := '{}';
  if size_gap = 0 and v_energy = t_energy and v_energy <> 0 then
    why := why || 'similar_size_and_energy'::text;
  else
    if v_energy = t_energy and v_energy <> 0 then why := why || 'similar_energy'::text; end if;
    if size_gap = 0 then why := why || 'similar_size'::text; end if;
  end if;
  if cardinality(shared_intents) > 0 then why := why || ('shared_intent:' || shared_intents[1]::text); end if;
  if cardinality(shared_tags) > 0 then why := why || ('shared_tag:' || shared_tags[1]::text); end if;
  if v_stage = t_stage then why := why || 'similar_age'::text; end if;
end;
$$;

-- Distance shown to users (§3.3): between snapped cell centres, rounded to
-- 0.1 km; anything under 1 km is reported as 0, meaning "under 1 km". Null if
-- the other owner hides distance.
create function private.display_distance_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision, b_show boolean)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when not b_show or a_lat is null or b_lat is null then null
    when private.distance_m(a_lat, a_lng, b_lat, b_lng) < 1000 then 0
    else round((private.distance_m(a_lat, a_lng, b_lat, b_lng) / 1000.0)::numeric, 1)
  end;
$$;

-- ---------------------------------------------------------------------------
-- enter_cluster — screen 3. The coordinate received is tested against the
-- cluster as-is, held only for the length of this call, and then discarded:
-- what gets stored is the point snapped to the cluster grid (§3.3).
--
-- The gate deliberately runs BEFORE snapping. Snapping first moves a point by
-- up to ~350 m, which (measured against the Makati boundary) wrongly waitlists
-- ~8% of Makati's area and admits a ~300 m strip of BGC.
--
-- Once admitted you stay admitted: a later call from outside the cluster (on
-- holiday, say) changes nothing rather than evicting you.
-- ---------------------------------------------------------------------------
create function public.enter_cluster(p_lat double precision, p_lng double precision, p_area_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner public.owners;
  v_cluster public.ranking_config;
  v_cluster_id text;
  v_lat double precision;
  v_lng double precision;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_COORDINATES';
  end if;

  select * into v_owner from public.owners where id = v_uid for update;
  if not found then raise exception 'OWNER_NOT_FOUND'; end if;

  v_cluster_id := private.find_cluster(p_lat, p_lng);
  select s.snapped_lat, s.snapped_lng into v_lat, v_lng from private.snap(p_lat, p_lng, 500) s;

  if v_cluster_id is not null then
    select * into v_cluster from public.ranking_config where cluster_id = v_cluster_id;
    select s.snapped_lat, s.snapped_lng into v_lat, v_lng from private.snap(p_lat, p_lng, v_cluster.grid_m) s;
    update public.owners
      set cluster_id = v_cluster_id, loc_lat = v_lat, loc_lng = v_lng, location_updated_at = now()
      where id = v_uid;
    delete from public.waitlist where owner_id = v_uid;
    return jsonb_build_object('admitted', true, 'cluster_id', v_cluster_id, 'cluster_name', v_cluster.name);
  end if;

  if v_owner.cluster_id is not null then
    select * into v_cluster from public.ranking_config where cluster_id = v_owner.cluster_id;
    return jsonb_build_object('admitted', true, 'cluster_id', v_owner.cluster_id, 'cluster_name', v_cluster.name, 'location_unchanged', true);
  end if;

  update public.owners set loc_lat = v_lat, loc_lng = v_lng, location_updated_at = now() where id = v_uid;
  insert into public.waitlist (owner_id, email, loc_lat, loc_lng, area_label)
  values (v_uid, v_owner.email, v_lat, v_lng, left(btrim(p_area_label), 80))
  on conflict (owner_id) do update
    set loc_lat = excluded.loc_lat, loc_lng = excluded.loc_lng,
        area_label = coalesce(excluded.area_label, public.waitlist.area_label);
  return jsonb_build_object('admitted', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_pet_tags — replaces a pet's tags atomically; 2–4 required (§5).
-- ---------------------------------------------------------------------------
create function public.set_pet_tags(p_pet_id uuid, p_tags public.pet_tag[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tags public.pet_tag[];
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from public.pets p where p.id = p_pet_id and p.owner_id = v_uid) then
    raise exception 'NOT_YOUR_PET';
  end if;
  v_tags := array(select distinct x from unnest(p_tags) x where x is not null);
  if cardinality(v_tags) not between 2 and 4 then raise exception 'TAGS_MUST_BE_2_TO_4'; end if;

  delete from public.pet_tags where pet_id = p_pet_id;
  insert into public.pet_tags (pet_id, tag) select p_pet_id, x from unnest(v_tags) x;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_deck — the Discover deck (§6, §7). Always ranked, never a raw distance
-- sort. Returns public-safe card fields only.
-- ---------------------------------------------------------------------------
create function public.get_deck(p_pet_id uuid, p_limit integer default null)
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
    select p.*, o.display_name, o.phone_verified_at, o.loc_lat, o.loc_lng, o.show_distance
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
    sc.phone_verified_at is not null,
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

-- ---------------------------------------------------------------------------
-- get_pet_profile — screen 6. Same public-safe shape as a deck card, for one
-- pet: allowed if it is in my cluster (and nobody is blocked or suspended) or
-- we are matched.
-- ---------------------------------------------------------------------------
create function public.get_pet_profile(p_viewer_pet_id uuid, p_pet_id uuid)
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
    p.id, p.owner_id, o.display_name, o.phone_verified_at is not null,
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

-- ---------------------------------------------------------------------------
-- swipe — the only writer of likes and matches (§6, §7).
-- ---------------------------------------------------------------------------
create function public.swipe(p_from_pet_id uuid, p_to_pet_id uuid, p_action public.swipe_action)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner public.owners;
  v_from public.pets;
  v_to public.pets;
  v_cfg public.ranking_config;
  v_supers_used integer;
  v_match_id uuid;
  v_conversation_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_from_pet_id = p_to_pet_id then raise exception 'TARGET_UNAVAILABLE'; end if;

  select * into v_from from public.pets p where p.id = p_from_pet_id and p.owner_id = v_uid;
  if not found then raise exception 'NOT_YOUR_PET'; end if;
  select * into v_owner from public.owners o where o.id = v_uid;
  if v_owner.status <> 'active' then raise exception 'SUSPENDED'; end if;
  if v_owner.cluster_id is null then raise exception 'NOT_IN_CLUSTER'; end if;
  select * into v_cfg from public.ranking_config c where c.cluster_id = v_owner.cluster_id;

  select p.* into v_to
  from public.pets p
  join public.owners o on o.id = p.owner_id
  where p.id = p_to_pet_id
    and p.owner_id <> v_uid
    and p.cluster_id = v_owner.cluster_id
    and p.species = v_from.species
    and o.status = 'active';
  if not found or private.is_blocked_between(v_uid, v_to.owner_id) then
    raise exception 'TARGET_UNAVAILABLE';
  end if;

  -- Serialise the two directions of a pair. Without this, two simultaneous
  -- right-swipes each miss the other's uncommitted like and no match is made.
  perform pg_advisory_xact_lock(hashtextextended(least(p_from_pet_id, p_to_pet_id)::text || greatest(p_from_pet_id, p_to_pet_id)::text, 0));

  if exists (
    select 1 from public.matches m
    where m.pet_a_id = least(p_from_pet_id, p_to_pet_id) and m.pet_b_id = greatest(p_from_pet_id, p_to_pet_id)
  ) then
    raise exception 'ALREADY_MATCHED';
  end if;

  if p_action = 'super' then
    -- The Super Paw day rolls over at midnight Manila time.
    select count(*) into v_supers_used
    from public.likes l
    where l.from_owner_id = v_uid
      and l.action = 'super'
      and l.created_at >= date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'
      and not (l.from_pet_id = p_from_pet_id and l.to_pet_id = p_to_pet_id);
    if v_supers_used >= v_cfg.super_paw_daily_limit then raise exception 'SUPER_PAW_LIMIT'; end if;
  end if;

  insert into public.likes (from_pet_id, to_pet_id, from_owner_id, action)
  values (p_from_pet_id, p_to_pet_id, v_uid, p_action)
  on conflict (from_pet_id, to_pet_id) do update set action = excluded.action, created_at = now();

  if p_action in ('like', 'super') and exists (
    select 1 from public.likes l
    where l.from_pet_id = p_to_pet_id and l.to_pet_id = p_from_pet_id and l.action in ('like', 'super')
  ) then
    insert into public.matches (pet_a_id, pet_b_id, owner_a_id, owner_b_id)
    values (
      least(p_from_pet_id, p_to_pet_id),
      greatest(p_from_pet_id, p_to_pet_id),
      case when p_from_pet_id < p_to_pet_id then v_uid else v_to.owner_id end,
      case when p_from_pet_id < p_to_pet_id then v_to.owner_id else v_uid end
    )
    returning id into v_match_id;

    insert into public.conversations (match_id, owner_a_id, owner_b_id)
    select m.id, m.owner_a_id, m.owner_b_id from public.matches m where m.id = v_match_id
    returning id into v_conversation_id;

    return jsonb_build_object('matched', true, 'match_id', v_match_id, 'conversation_id', v_conversation_id);
  end if;

  return jsonb_build_object('matched', false);
end;
$$;

-- Rewind the last card only (§6). After a rewind, the next rewind needs a new
-- swipe first, so you cannot walk back through the whole deck. A swipe that
-- produced a match cannot be rewound.
create function public.rewind_last_swipe(p_from_pet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pet public.pets;
  v_last public.likes;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_pet from public.pets p where p.id = p_from_pet_id and p.owner_id = v_uid for update;
  if not found then raise exception 'NOT_YOUR_PET'; end if;

  select * into v_last from public.likes l where l.from_pet_id = p_from_pet_id order by l.created_at desc limit 1;
  if not found or (v_pet.last_rewind_at is not null and v_last.created_at <= v_pet.last_rewind_at) then
    raise exception 'REWIND_UNAVAILABLE';
  end if;
  if exists (
    select 1 from public.matches m
    where m.pet_a_id = least(v_last.from_pet_id, v_last.to_pet_id) and m.pet_b_id = greatest(v_last.from_pet_id, v_last.to_pet_id)
  ) then
    raise exception 'REWIND_MATCHED';
  end if;

  delete from public.likes l where l.from_pet_id = v_last.from_pet_id and l.to_pet_id = v_last.to_pet_id;
  update public.pets p set last_rewind_at = now() where p.id = p_from_pet_id;
  return jsonb_build_object('rewound', true, 'pet_id', v_last.to_pet_id, 'action', v_last.action);
end;
$$;

-- What the Discover screen needs to draw its buttons.
create function public.get_swipe_state(p_pet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pet public.pets;
  v_limit integer;
  v_used integer;
  v_last_at timestamptz;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_pet from public.pets p where p.id = p_pet_id and p.owner_id = v_uid;
  if not found then raise exception 'NOT_YOUR_PET'; end if;

  select coalesce(c.super_paw_daily_limit, 0) into v_limit from public.ranking_config c where c.cluster_id = v_pet.cluster_id;
  select count(*) into v_used from public.likes l
  where l.from_owner_id = v_uid and l.action = 'super'
    and l.created_at >= date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';
  select max(l.created_at) into v_last_at from public.likes l where l.from_pet_id = p_pet_id;

  return jsonb_build_object(
    'super_paws_left', greatest(coalesce(v_limit, 0) - v_used, 0),
    'can_rewind', v_last_at is not null and (v_pet.last_rewind_at is null or v_last_at > v_pet.last_rewind_at)
  );
end;
$$;

create function public.unmatch(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.matches m
  set status = 'unmatched', unmatched_by = v_uid, unmatched_at = now()
  where m.id = p_match_id and v_uid in (m.owner_a_id, m.owner_b_id) and m.status = 'active';
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inbox + chat
-- ---------------------------------------------------------------------------

-- Screen 7 in one round trip (it matters on a poor connection): each active
-- match with the other pet's card basics and the other owner's first name.
create function public.get_inbox()
returns table (
  conversation_id uuid,
  match_id uuid,
  matched_at timestamptz,
  my_pet_id uuid,
  my_pet_name text,
  other_pet_id uuid,
  other_pet_name text,
  other_pet_photo text,
  other_owner_id uuid,
  other_owner_name text,
  last_message_at timestamptz,
  last_message_preview text,
  unread boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id, m.id, m.created_at,
    mine.id, mine.name,
    theirs.id, theirs.name,
    (select ph.storage_path from public.pet_photos ph where ph.pet_id = theirs.id order by ph.position limit 1),
    other.id, other.display_name,
    c.last_message_at, c.last_message_preview,
    c.last_message_at is not null
      and c.last_message_at > coalesce(case when m.owner_a_id = (select auth.uid()) then c.a_last_read_at else c.b_last_read_at end, '-infinity')
  from public.matches m
  join public.conversations c on c.match_id = m.id
  join public.pets mine on mine.id = case when m.owner_a_id = (select auth.uid()) then m.pet_a_id else m.pet_b_id end
  join public.pets theirs on theirs.id = case when m.owner_a_id = (select auth.uid()) then m.pet_b_id else m.pet_a_id end
  join public.owners other on other.id = theirs.owner_id
  where (select auth.uid()) in (m.owner_a_id, m.owner_b_id)
    and m.status = 'active'
  order by coalesce(c.last_message_at, m.created_at) desc;
$$;

create function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.conversations c
  set a_last_read_at = case when c.owner_a_id = v_uid then now() else c.a_last_read_at end,
      b_last_read_at = case when c.owner_b_id = v_uid then now() else c.b_last_read_at end
  where c.id = p_conversation_id and v_uid in (c.owner_a_id, c.owner_b_id);
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
end;
$$;

-- Accept or decline a playdate proposal. Only the person it was sent to can
-- answer, once, while the match is still active.
create function public.respond_playdate(p_message_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_msg public.messages;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_msg from public.messages msg where msg.id = p_message_id and msg.kind = 'playdate_proposal' for update;
  if not found or not private.can_post(v_msg.conversation_id) then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_msg.sender_id = v_uid then raise exception 'CANNOT_ANSWER_OWN_PROPOSAL'; end if;
  if v_msg.payload ->> 'status' <> 'proposed' then raise exception 'PROPOSAL_ALREADY_ANSWERED'; end if;

  update public.messages msg
  set payload = msg.payload || jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end, 'responded_at', now())
  where msg.id = p_message_id
  returning msg.payload into v_msg.payload;
  return v_msg.payload;
end;
$$;

-- ---------------------------------------------------------------------------
-- Referral (§11): credit the inviter, once.
-- ---------------------------------------------------------------------------
create function public.claim_referral(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inviter uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select o.id into v_inviter from public.owners o where o.referral_code = lower(btrim(p_code)) and o.id <> v_uid;
  if v_inviter is null then return false; end if;
  update public.owners o set referred_by = v_inviter where o.id = v_uid and o.referred_by is null;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Data export (§9, Philippine Data Privacy Act): everything we hold about the
-- caller, as one JSON document.
-- ---------------------------------------------------------------------------
create function public.export_my_data()
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
    'account', (select jsonb_build_object('phone', u.phone, 'created_at', u.created_at) from auth.users u where u.id = v_uid),
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

-- ---------------------------------------------------------------------------
-- Moderation queue (§5, §9) — the whole "admin portal".
-- ---------------------------------------------------------------------------
create function public.get_moderation_queue(p_status public.report_status default 'open')
returns table (
  report_id uuid,
  created_at timestamptz,
  status public.report_status,
  reason public.report_reason,
  details text,
  message_snapshot text,
  reporter_id uuid,
  reporter_name text,
  target_owner_id uuid,
  target_owner_name text,
  target_owner_status public.owner_status,
  target_pet_id uuid,
  target_pet_name text,
  open_reports_against_target bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_moderator() then raise exception 'NOT_A_MODERATOR'; end if;
  return query
  select
    r.id, r.created_at, r.status, r.reason, r.details, r.message_snapshot,
    r.reporter_id, rep.display_name,
    r.target_owner_id, tgt.display_name, tgt.status,
    r.target_pet_id, tp.name,
    (select count(*) from public.reports r2 where r2.target_owner_id = r.target_owner_id and r2.status = 'open')
  from public.reports r
  left join public.owners rep on rep.id = r.reporter_id
  left join public.owners tgt on tgt.id = r.target_owner_id
  left join public.pets tp on tp.id = r.target_pet_id
  where r.status = p_status
  order by r.created_at
  limit 200;
end;
$$;

-- One click: 'suspend' suspends the reported owner and closes every open report
-- against them; 'dismiss' closes just this one.
create function public.resolve_report(p_report_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_report public.reports;
begin
  if not private.is_moderator() then raise exception 'NOT_A_MODERATOR'; end if;
  if p_action not in ('suspend', 'dismiss') then raise exception 'INVALID_ACTION'; end if;
  select * into v_report from public.reports r where r.id = p_report_id for update;
  if not found then raise exception 'REPORT_NOT_FOUND'; end if;

  if p_action = 'dismiss' then
    update public.reports r set status = 'dismissed', resolved_by = v_uid, resolved_at = now() where r.id = p_report_id;
    return;
  end if;

  if v_report.target_owner_id = v_uid then raise exception 'CANNOT_SUSPEND_SELF'; end if;
  update public.owners o set status = 'suspended', suspended_at = now() where o.id = v_report.target_owner_id;
  update public.reports r set status = 'actioned', resolved_by = v_uid, resolved_at = now()
  where r.target_owner_id = v_report.target_owner_id and r.status = 'open';
end;
$$;

create function public.unsuspend_owner(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_moderator() then raise exception 'NOT_A_MODERATOR'; end if;
  update public.owners o set status = 'active', suspended_at = null where o.id = p_owner_id and o.status = 'suspended';
  if not found then raise exception 'OWNER_NOT_SUSPENDED'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges. Postgres grants EXECUTE to PUBLIC on every new function,
-- which would make these callable by `anon`; take that away, then grant to
-- signed-in users only.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon;

grant execute on function
  public.enter_cluster(double precision, double precision, text),
  public.set_pet_tags(uuid, public.pet_tag[]),
  public.get_deck(uuid, integer),
  public.get_pet_profile(uuid, uuid),
  public.swipe(uuid, uuid, public.swipe_action),
  public.rewind_last_swipe(uuid),
  public.get_swipe_state(uuid),
  public.unmatch(uuid),
  public.get_inbox(),
  public.mark_conversation_read(uuid),
  public.respond_playdate(uuid, boolean),
  public.claim_referral(text),
  public.export_my_data(),
  public.get_moderation_queue(public.report_status),
  public.resolve_report(uuid, text),
  public.unsuspend_owner(uuid)
to authenticated;

grant execute on all functions in schema public to service_role;
grant execute on all functions in schema private to service_role;
