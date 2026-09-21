-- PAWME V1 — the 13 tables from master prompt §10, and nothing else.
-- RLS is enabled here, in the same migration that creates each table, so no
-- table ever exists unprotected. Policies and grants follow in a later file.

-- ---------------------------------------------------------------------------
-- ranking_config — one row per cluster. Holds the cluster definition (§3.1:
-- "a single config value") and the ranking weights (§7: tunable without a
-- redeploy). Clients have no access; functions read it.
-- ---------------------------------------------------------------------------
create table public.ranking_config (
  cluster_id text primary key check (cluster_id ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  is_active boolean not null default true,

  -- Cluster = within radius_m of the centroid AND (if set) inside boundary.
  -- boundary vertices are (lng, lat). A radius alone cannot express
  -- "Makati but not BGC", hence the polygon.
  centroid_lat double precision not null check (centroid_lat between -90 and 90),
  centroid_lng double precision not null check (centroid_lng between -180 and 180),
  radius_m integer not null check (radius_m between 500 and 50000),
  boundary polygon,
  grid_m integer not null default 500 check (grid_m between 250 and 2000),

  -- §3.5: is_seed rows are rejected unless this is true. Set by hand in the
  -- dev project only; it stays false in production.
  allow_seed boolean not null default false,

  w_intent_overlap numeric not null default 3.0,
  w_tag_compatibility numeric not null default 2.0,
  w_size_fit numeric not null default 1.5,
  w_age_fit numeric not null default 1.0,
  w_proximity numeric not null default 1.5,
  w_recency numeric not null default 3.0,
  w_completeness numeric not null default 1.0,
  w_random numeric not null default 0.75,
  w_liked_you numeric not null default 1.5,
  recency_halflife_days numeric not null default 3 check (recency_halflife_days > 0),

  deck_size integer not null default 20 check (deck_size between 1 and 100),
  super_paw_daily_limit integer not null default 1 check (super_paw_daily_limit >= 0),
  pass_cooldown_days integer not null default 14 check (pass_cooldown_days >= 1),

  updated_at timestamptz not null default now()
);
alter table public.ranking_config enable row level security;

-- ---------------------------------------------------------------------------
-- owners — the adult guardian. One row per auth user, created by a trigger on
-- auth.users. The phone number stays in auth.users and is never copied here.
-- ---------------------------------------------------------------------------
create table public.owners (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(btrim(display_name)) between 1 and 40),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  adult_confirmed_at timestamptz,
  phone_verified_at timestamptz,

  -- null cluster_id = not admitted (waitlisted or location step not done yet).
  cluster_id text references public.ranking_config (cluster_id),
  -- Snapped to the cluster grid (~500 m). Raw coordinates are never stored.
  loc_lat double precision,
  loc_lng double precision,
  location_updated_at timestamptz,

  role public.owner_role not null default 'user',
  status public.owner_status not null default 'active',
  suspended_at timestamptz,

  referral_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  referred_by uuid references public.owners (id) on delete set null,

  -- §4: payments seam. Defaults to 'free' and is touched nowhere else.
  subscription_tier text not null default 'free',

  notify_in_app boolean not null default true,
  notify_email boolean not null default false,
  show_distance boolean not null default true,
  discoverable boolean not null default true,

  is_seed boolean not null default false,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint owners_location_pair check ((loc_lat is null) = (loc_lng is null)),
  constraint owners_no_self_referral check (referred_by is null or referred_by <> id)
);
alter table public.owners enable row level security;
create index owners_cluster_id_idx on public.owners (cluster_id);
create index owners_referred_by_idx on public.owners (referred_by);

-- ---------------------------------------------------------------------------
-- pets — schema allows several per owner; the V1 screens handle one.
-- ---------------------------------------------------------------------------
create table public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  species public.pet_species not null,
  breed text check (breed is null or char_length(breed) <= 60),
  is_mixed boolean not null default false,
  sex public.pet_sex not null,
  -- Approximate birth date; a stored age goes stale.
  birth_date date not null check (birth_date >= date '1990-01-01'),
  size public.pet_size not null,
  intents public.pet_intent[] not null check (cardinality(intents) between 1 and 3),

  -- Copied from the owner by trigger; clients cannot set these.
  cluster_id text references public.ranking_config (cluster_id),
  is_seed boolean not null default false,
  last_active_at timestamptz not null default now(),
  last_rewind_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pets enable row level security;
create index pets_owner_id_idx on public.pets (owner_id);
-- §10: pets by cluster + last_active (the deck's candidate scan).
create index pets_cluster_last_active_idx on public.pets (cluster_id, last_active_at desc);

create table public.pet_photos (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  -- Object path in the pet-photos bucket: {owner_id}/{pet_id}/{file}.
  storage_path text not null unique check (char_length(storage_path) <= 300),
  position smallint not null check (position between 1 and 5),
  created_at timestamptz not null default now(),
  -- Deferrable so a single-statement reorder does not trip mid-update.
  constraint pet_photos_pet_position_key unique (pet_id, position) deferrable initially immediate
);
alter table public.pet_photos enable row level security;

-- 2–4 per pet, enforced by set_pet_tags(); clients never write this directly.
create table public.pet_tags (
  pet_id uuid not null references public.pets (id) on delete cascade,
  tag public.pet_tag not null,
  primary key (pet_id, tag)
);
alter table public.pet_tags enable row level security;

-- ---------------------------------------------------------------------------
-- likes — every swipe, passes included so cards do not reappear. Written only
-- by swipe(); clients can read their own rows and nothing else (no "who liked
-- me" query exists).
-- ---------------------------------------------------------------------------
create table public.likes (
  from_pet_id uuid not null references public.pets (id) on delete cascade,
  to_pet_id uuid not null references public.pets (id) on delete cascade,
  from_owner_id uuid not null references public.owners (id) on delete cascade,
  action public.swipe_action not null,
  created_at timestamptz not null default now(),
  -- §10: likes by (from, to).
  primary key (from_pet_id, to_pet_id),
  constraint likes_not_self check (from_pet_id <> to_pet_id)
);
alter table public.likes enable row level security;
create index likes_to_pet_id_idx on public.likes (to_pet_id);
create index likes_from_owner_created_idx on public.likes (from_owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- matches — created only by swipe(). pet_a_id < pet_b_id keeps one row per
-- pair. Owner ids are denormalised so RLS is an indexed equality check.
-- ---------------------------------------------------------------------------
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  pet_a_id uuid not null references public.pets (id) on delete cascade,
  pet_b_id uuid not null references public.pets (id) on delete cascade,
  owner_a_id uuid not null references public.owners (id) on delete cascade,
  owner_b_id uuid not null references public.owners (id) on delete cascade,
  status public.match_status not null default 'active',
  unmatched_by uuid references public.owners (id) on delete set null,
  unmatched_at timestamptz,
  created_at timestamptz not null default now(),
  constraint matches_pair_key unique (pet_a_id, pet_b_id),
  constraint matches_canonical_order check (pet_a_id < pet_b_id),
  constraint matches_distinct_owners check (owner_a_id <> owner_b_id)
);
alter table public.matches enable row level security;
create index matches_pet_b_id_idx on public.matches (pet_b_id);
create index matches_owner_a_id_idx on public.matches (owner_a_id);
create index matches_owner_b_id_idx on public.matches (owner_b_id);
create index matches_unmatched_by_idx on public.matches (unmatched_by) where unmatched_by is not null;

-- One conversation per match. Per-participant last-read times give both unread
-- counts and the "seen" status without a write per message.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.matches (id) on delete cascade,
  owner_a_id uuid not null references public.owners (id) on delete cascade,
  owner_b_id uuid not null references public.owners (id) on delete cascade,
  a_last_read_at timestamptz,
  b_last_read_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now()
);
alter table public.conversations enable row level security;
create index conversations_owner_a_idx on public.conversations (owner_a_id, last_message_at desc);
create index conversations_owner_b_idx on public.conversations (owner_b_id, last_message_at desc);

-- The id may be supplied by the client so an offline-queued send can be retried
-- without creating a duplicate.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.owners (id) on delete cascade,
  kind public.message_kind not null default 'text',
  body text check (body is null or char_length(body) <= 2000),
  -- Object path in the private chat-photos bucket: {conversation_id}/{file}.
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  -- playdate_proposal: {place, starts_at, note?, status, responded_at?}
  payload jsonb,
  created_at timestamptz not null default now(),
  constraint messages_shape check (
    case kind
      when 'text' then body is not null and btrim(body) <> '' and photo_path is null and payload is null
      when 'photo' then photo_path is not null and payload is null
      when 'playdate_proposal' then
        photo_path is null
        and payload is not null
        and jsonb_typeof(payload) = 'object'
        and payload ? 'place' and payload ? 'starts_at'
        and payload ->> 'status' in ('proposed', 'accepted', 'declined')
    end
  )
);
alter table public.messages enable row level security;
-- §10: messages by conversation.
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index messages_sender_id_idx on public.messages (sender_id);

-- ---------------------------------------------------------------------------
-- Trust & safety
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.owners (id) on delete set null,
  target_owner_id uuid references public.owners (id) on delete set null,
  target_pet_id uuid references public.pets (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  -- Copied at report time so evidence survives an unmatch or account deletion.
  message_snapshot text,
  reason public.report_reason not null,
  details text check (details is null or char_length(details) <= 1000),
  status public.report_status not null default 'open',
  resolved_by uuid references public.owners (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  -- Plain <> on purpose: it passes when either side is null. Both sides go null
  -- once both accounts are deleted, and "is distinct from" would then fail the
  -- check and block the second account deletion.
  constraint reports_not_self check (reporter_id <> target_owner_id)
);
alter table public.reports enable row level security;
create index reports_status_created_idx on public.reports (status, created_at);
create index reports_reporter_id_idx on public.reports (reporter_id);
create index reports_target_owner_id_idx on public.reports (target_owner_id);
create index reports_target_pet_id_idx on public.reports (target_pet_id) where target_pet_id is not null;
create index reports_message_id_idx on public.reports (message_id) where message_id is not null;
create index reports_resolved_by_idx on public.reports (resolved_by) where resolved_by is not null;

create table public.blocks (
  blocker_id uuid not null references public.owners (id) on delete cascade,
  blocked_id uuid not null references public.owners (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
create index blocks_blocked_id_idx on public.blocks (blocked_id);

-- §7 feedback seam. Private to the owner who gave it; unused by ranking in V1.
create table public.playdate_feedback (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  owner_id uuid not null references public.owners (id) on delete cascade,
  rating smallint not null check (rating between 1 and 4), -- 1 🙁  2 😐  3 😊  4 😍
  created_at timestamptz not null default now(),
  constraint playdate_feedback_once unique (match_id, owner_id)
);
alter table public.playdate_feedback enable row level security;
create index playdate_feedback_owner_id_idx on public.playdate_feedback (owner_id);

-- Owners whose location is outside every active cluster. Written only by
-- enter_cluster(). Location is snapped like everywhere else.
create table public.waitlist (
  owner_id uuid primary key references public.owners (id) on delete cascade,
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  loc_lat double precision,
  loc_lng double precision,
  area_label text check (area_label is null or char_length(area_label) <= 80),
  created_at timestamptz not null default now(),
  notified_at timestamptz
);
alter table public.waitlist enable row level security;
