-- PAWME V1 — foundation: private schema + enums.
--
-- `public` is the only schema exposed through the Data API. `private` holds
-- helpers used by RLS policies and triggers; it is never exposed.
-- No PostGIS: at one-cluster scale a snapped lat/lng pair, a haversine
-- function and Postgres' native polygon type are enough.

create schema if not exists private;

-- Policy helpers in `private` are called from RLS expressions, which run as the
-- querying role, so `authenticated` needs usage here. The schema is still
-- unreachable over the API because it is not an exposed schema.
grant usage on schema private to authenticated, service_role;

create type public.pet_species as enum ('dog', 'cat');
create type public.pet_sex as enum ('male', 'female');
create type public.pet_size as enum ('small', 'medium', 'large');

-- Master prompt §3.4: playdates/friendship only. There is deliberately no
-- breeding or adoption value here — the mode is absent, not switched off.
create type public.pet_intent as enum ('playdate', 'walking_buddy', 'friendship');

-- Fixed personality vocabulary (2–4 per pet). Ranking reads these.
create type public.pet_tag as enum (
  'playful', 'energetic', 'calm', 'couch_potato',
  'friendly', 'shy', 'gentle', 'curious',
  'cuddly', 'independent', 'vocal',
  'loves_walks', 'loves_fetch',
  'good_with_dogs', 'good_with_cats', 'good_with_kids'
);

create type public.swipe_action as enum ('pass', 'like', 'super');
create type public.match_status as enum ('active', 'unmatched');
create type public.message_kind as enum ('text', 'photo', 'playdate_proposal');

create type public.owner_role as enum ('user', 'moderator');
create type public.owner_status as enum ('active', 'suspended');

-- Master prompt §9 report reasons.
create type public.report_reason as enum (
  'harassment', 'scam', 'animal_welfare',
  'sexual_content_involving_animals', 'impersonation', 'spam'
);
create type public.report_status as enum ('open', 'dismissed', 'actioned');
