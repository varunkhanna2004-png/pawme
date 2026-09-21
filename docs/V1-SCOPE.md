# PAWME V1 — scope, screens, data model

Status: **approved 2026-09-21**. Source of truth for scope is `00-MASTER-PROMPT.md`; this page records how it is being built and the decisions taken on top of it.

**V1 proves one loop in one cluster:** sign up → add pet → discover → swipe → match → chat → propose a playdate, with report and block available everywhere. Anything outside that loop, including everything in §13 of the master prompt, gets a TODO and is not built.

## Approved decisions

1. **Cluster:** Ayala Triangle centroid (14.5566, 121.0234), 3.5 km radius, **Makati only**. BGC / Taguig are explicitly excluded. A radius alone cannot do this (BGC High Street is about 3.0 km from the centroid), so the cluster is "inside the radius **and** inside the Makati city boundary". §3's "Makati" is authoritative; the BGC mention in §13 is ignored.
2. **Environments:** `tzifbmuuczogckruptap` is **production** and is never seeded. Dev and seed data live in a separate Supabase project.
3. **OTP:** Supabase test phone numbers in dev. The real SMS provider is a dashboard/config change before launch; nothing in the schema or app depends on which provider it is.
4. **Pets:** one pet per owner in the V1 screens; the schema supports several.
5. **Notifications:** in-app first, optional email second, web push only if it fits the one-day limit in §4.

## How the §3 constraints change the build

**1. Single cluster**
- The cluster check runs on the server (`enter_cluster()`); a client-only gate can be bypassed.
- Centroid, radius and boundary live in one config row, so the cluster can be changed with a single SQL update and no redeploy.
- Every owner, pet and waitlist row carries a cluster reference, which makes multi-city possible later at almost no cost now.
- If the user denies location permission, they pick a barangay and its centre point is used.

**2. Owner operates**
- Chat is between owners; copy reads "You and Mochi matched with Ana and Bruno".
- Signup includes an 18+ confirmation. Blocks, reports and suspensions apply to the owner, never the pet.

**3. Approximate distance**
- Raw coordinates are never stored. `enter_cluster()` tests the received point against the cluster, discards it, and stores only the point snapped to a 500 m grid. (The gate runs before snapping: snapping first wrongly waitlists about 8% of Makati's area and admits a ~300 m strip of BGC.)
- Other users' snapped points never reach any client. The deck returns only a rounded distance, with "under 1 km" as the floor.
- Row-level security works on whole rows, so other people's pets are served only through database functions that return public-safe fields, never by reading base tables.
- Phone photos carry GPS in their EXIF metadata. Every upload is re-encoded in the browser, which strips it and compresses the photo for poor connections.

**4. Playdates only**
- Breeding is absent, not hidden behind a flag. Intent has exactly three values; there are no pedigree, papers or "intact" fields.
- Breeding solicitation in chat is handled by the "animal welfare" report reason.

**5. No fake data in production**
- Seeded owners and pets carry `is_seed`. The database refuses `is_seed` rows unless the cluster config row has `allow_seed = true`, which is set by hand in the dev project only.
- The seed script also refuses to run without an explicit dev flag.

## Screens

The nine screens in §5 plus the moderation queue, with no additions. These are states inside existing screens, not new screens:
- waitlist (inside screen 3)
- the Paw-Match overlay and share-card sheet (on Discover)
- the playdate proposal sheet and the "How did it go?" prompt (in Chat)
- the report / block / unmatch sheet (everywhere)

All screens handle loading, empty, error, offline and permission-denied. Offline means a cached app shell, a banner and retry; the only queued write is sending a chat message.

Build order: schema, then the Discover → Match → Chat spine against dev seed data with rough sign-in, then onboarding polish.

## Data model

The 13 tables from §10, plus one approved addition (`banned_phones`).

| Table | Key fields and notes |
|---|---|
| `owners` | id (the auth user id), display_name, email (optional), cluster_id, snapped location, role, status, referral_code, referred_by, subscription_tier (defaults to `free`, used nowhere else), is_seed, last_active_at. The phone number stays in Supabase auth and is never copied here. |
| `pets` | owner_id, name, species, breed, is_mixed, sex, approximate birth date, size, intents, cluster_id, last_active_at, is_seed |
| `pet_photos` | pet_id, storage path, position 1–5 |
| `pet_tags` | pet_id, tag from a fixed list, 2–4 per pet |
| `likes` | from_pet, to_pet, action (pass, like or super). Passes are stored so cards don't reappear. Written only by the swipe function. Super Paw is capped per day on the server. |
| `matches` | pet_a, pet_b, status. Created only by the swipe function. |
| `conversations` | one per match, last_message_at, per-participant last-read time |
| `messages` | conversation_id, sender, kind (text, photo or playdate_proposal), body, payload |
| `reports` | reporter, target owner, optional pet or message, reason (the six in §9), status, resolution |
| `blocks` | blocker, blocked. Applied in both directions in the deck, inbox and chat. |
| `playdate_feedback` | match_id, owner_id, rating 1–4. Private; not used for ranking in V1. |
| `waitlist` | owner, optional email, coarse area, notified_at |
| `ranking_config` | one row per cluster: ranking weights plus centroid, radius and boundary |
| `banned_phones` | 14th table, added by decision on 2026-09-21. A hash of a suspended owner's phone number, with no link to the owner, so it survives account deletion. Signing up again with a banned number creates the account already suspended. Unsuspending removes the ban. No client access. |

Server logic: database functions for the cluster check, the deck (with its "Why this match" reasons), the swipe, moderation and data export. Account deletion needs one Edge Function, because removing the auth user requires the secret key. That function and the seed script are the only places the secret key appears.

## Gaps resolved

- **"Propose a playdate"** has no screen or table in the master prompt. It is a structured chat message holding place, time and status, nudged toward public places. The feedback prompt fires after it.
- **"Verified" badge:** signup requires phone OTP, so every user has it in V1. Built anyway because it is cheap.
- **Share card:** drawn in the browser on a canvas with pet names and one photo each, no owner name and no location. Shared through the phone's native share sheet, with download and copy-link as fallbacks.
