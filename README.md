# PAWME

Playdates and friends for your pet, in one neighbourhood at a time. V1 is a mobile-first PWA that proves one loop in one cluster (Makati):

**sign up → add pet → discover → swipe → match → chat → (report / block everywhere)**

Scope and decisions live in [`00-MASTER-PROMPT.md`](00-MASTER-PROMPT.md) and [`docs/V1-SCOPE.md`](docs/V1-SCOPE.md). Screenshots of each flow working are in [`docs/spine-proof/`](docs/spine-proof/).

- **Frontend:** React 19 + Vite + TypeScript + Tailwind, installable PWA (`vite-plugin-pwa`)
- **Backend:** Supabase — Postgres with RLS on every table, phone-OTP auth, Storage, Realtime, one Edge Function
- **No** separate API server, payments, Redis or queues (master prompt §4)

## Two Supabase projects — never mix them up

| Project | Ref | Used for |
|---|---|---|
| **Pawme** (production) | `tzifbmuuczogckruptap` | Real users only. **Never seeded.** `ranking_config.allow_seed` stays `false`. |
| **Pawme-Dev** | `ooigdeefqwgzkpujvexu` | Local development, seed data, end-to-end tests, test deploys. |

Guards that enforce this: the dev server refuses to start against production; every dev script refuses any project that is not on its allowlist (`scripts/lib/dev-guard.mjs`); the database itself rejects `is_seed` rows unless `allow_seed` was switched on by hand; and any deployed build that is *not* pointed at production shows a **TEST BUILD** ribbon.

## Environment variables

| Variable | Where | What |
|---|---|---|
| `VITE_SUPABASE_URL` | client (bundled) | `https://<ref>.supabase.co` — no `/rest/v1` suffix |
| `VITE_SUPABASE_ANON_KEY` | client (bundled) | The project's **publishable** (or legacy anon) key. Public by design. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | dev scripts only | Dev project's service key. **Never** in client code or a committed file. |

Files (all gitignored except the example):

- `.env.example` — names only, committed
- `.env` — production client values (used by `vite build` locally)
- `.env.development.local` — **dev** client values; used by `npm run dev` and overrides `.env`
- `.env.seed.local` — dev service key for `scripts/` and the end-to-end tests

The client reads only the two `VITE_` variables. The service key is used by dev scripts and, in production, only inside the `delete-account` Edge Function, where Supabase injects it.

## Run it locally

```bash
npm install
# create .env.development.local with the DEV project's URL + publishable key
npm run dev            # http://localhost:5173
```

Sign in with a Supabase **test phone number** (no SMS is sent), code `123456`:

| Number | Account |
|---|---|
| `0917 000 0001` | Ana + Mochi (seeded) |
| `0917 000 0002` | Ben + Bruno (seeded) |
| `0917 000 0003` | **kept free** — signs up as a brand-new user (onboarding) |
| `0917 000 0009` | moderator (lands on the moderation queue) |

Thor, Kimchi, Coco and Yuki have already liked Mochi, so a right-swipe on them as Ana is an instant match.

### Dev data

```bash
npm run seed:dev            # create / refresh seed accounts (all flagged is_seed, photos carry a SEED ribbon)
npm run seed:dev:reset      # delete every seed account, then seed again
npm run dev:free-number     # delete whatever account holds 0917 000 0003 so it is "new" again
supabase db query --linked -f e2e/reset-test-accounts.sql   # clear matches/swipes/blocks/reports/bans on the test accounts
```

Seeding needs `allow_seed = true` on the dev cluster row (one-off, by hand, **dev only**):

```sql
update public.ranking_config set allow_seed = true where cluster_id = 'makati';
```

### Tests

```bash
npm run test:db     # 199 database tests (RLS, grants, functions) on in-memory Postgres — no Docker needed
npm run typecheck
npm run build

# end-to-end, in headless Chrome against the dev project (dev server must be running)
npm i --no-save playwright && npx playwright install chromium
node e2e/spine.cjs                                          # discover → match → realtime chat
node e2e/safety.cjs                                         # report / block / unmatch / moderation
node --env-file=.env.seed.local e2e/onboarding.cjs          # brand-new user → swiping; EXIF stripping
node --env-file=.env.seed.local e2e/share.cjs               # share card is public-safe; ?ref= credit
node --env-file=.env.seed.local e2e/playdate.cjs            # propose → accept / counter / decline; feedback prompt
node --env-file=.env.seed.local e2e/settings.cjs && npm run seed:dev:reset   # incl. a REAL account deletion
```

Reset the test accounts between suites (command above).

## Database

Migrations are in `supabase/migrations/` (13 files). The Supabase CLI is linked to **Pawme-Dev**; check before pushing anything:

```bash
cat supabase/.temp/project-ref          # must print the project you intend
supabase db push --linked               # apply new migrations
supabase db advisors --linked           # security + performance lints
npm run types                           # regenerate src/types/database.types.ts
supabase functions deploy delete-account --project-ref <ref> --use-api
```

Expected advisor output: ~19 "SECURITY DEFINER function executable by authenticated" warnings (those are the app's RPCs, by design — the *anon* variant must never appear) and two "RLS enabled, no policy" notes on `ranking_config` and `banned_phones` (deny-all, by design).

Per-project dashboard settings that migrations cannot set:

- **Realtime → Settings → "Allow public access": OFF.** The app uses private channels only; with this on, their access policies are not enforced.
- **Authentication → Sign In / Providers → Phone:** enabled with an SMS provider. Dev also lists the test numbers above. Production must **not** have test numbers.

## Changing the cluster

The whole cluster is one row in `ranking_config`. No redeploy is needed.

```sql
-- move / resize (metres). The cluster is "within radius_m of the centroid AND inside boundary".
update public.ranking_config
set centroid_lat = 14.5566, centroid_lng = 121.0234, radius_m = 3500
where cluster_id = 'makati';

-- boundary is a polygon of (lng lat) vertices; set it to null for a plain circle
update public.ranking_config set boundary = null where cluster_id = 'makati';

-- ranking weights, deck size, Super Paw limit and pass cooldown are columns on the same row
update public.ranking_config set w_recency = 3.5, pass_cooldown_days = 10 where cluster_id = 'makati';

-- a second city later: insert another row (owners, pets and the waitlist already carry a cluster_id)
```

Why a polygon: Makati-only is a product decision, and a circle cannot express it — BGC High Street is 3.0 km from the Ayala Triangle centroid, inside the 3.5 km radius. The Makati boundary comes from OpenStreetMap (© OpenStreetMap contributors, ODbL). People already admitted keep their cluster; the gate applies to new location checks. The barangay picker used when location permission is denied is `src/lib/makati.ts` — update it if the cluster changes.

## Deploying (Vercel)

`vercel.json` pins everything the build needs (Vite preset, `dist/`, SPA rewrites so `/matches` or `/chat/…` load directly, cache headers for the service worker). In the Vercel dashboard you only set the two variables:

1. **Project → Settings → Environment Variables → Add**
   - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = that project's publishable key
   - Environments: **Production** and **Preview**
2. Push to `main` (or **Deployments → ⋯ → Redeploy**). `VITE_` variables are baked in at build time, so a change only takes effect on the next build.

A test deploy pointed at **Pawme-Dev** is fine and shows the TEST BUILD ribbon; remember that anyone with the URL can sign in to the seeded test accounts with `123456`, so don't put real data in dev.

Netlify works the same way: build `npm run build`, publish `dist`, the same two variables, plus an SPA redirect (`/* /index.html 200`).

### Before pointing a deploy at production

- [ ] `supabase link --project-ref tzifbmuuczogckruptap`, `supabase db push`, deploy `delete-account`, then **re-link to dev**
- [ ] Realtime "Allow public access" OFF; Phone provider live with a real SMS sender; **no** test numbers
- [ ] `select allow_seed from ranking_config` → `false`; `select count(*) from owners where is_seed` → `0`
- [ ] Make your own account a moderator: `update public.owners set role = 'moderator' where id = '<your auth user id>';`
- [ ] Advisors clean (see above); Vercel variables switched to the production URL + publishable key; redeploy; the TEST BUILD ribbon is gone

## Project layout

```
src/
  screens/        Login, onboarding/, Discover, Matches, Chat, Settings, PetEditor, Moderation
  components/     SwipeDeck, PetCard, MatchOverlay, SafetySheet, ShareCardSheet, PhotoPicker, …
  lib/            supabase client, auth, inbox (shared realtime + in-app alerts), realtime, image (EXIF strip),
                  shareCard (canvas), share, install (PWA), makati (barangays), format
  types/          database.types.ts — generated, do not edit
supabase/
  migrations/     schema, RLS, functions
  functions/      delete-account (Edge Function)
  tests/          rls.test.mjs — database tests on PGlite
scripts/          dev-only: seed, free a test number (guarded against production)
e2e/              Playwright end-to-end suites + dev reset SQL
```

## Privacy and safety rules the code relies on

- Exact coordinates are never stored. `enter_cluster()` tests the received point, discards it, and stores a point snapped to a 500 m grid. Other users only ever receive a rounded distance.
- Photos are re-encoded in the browser before upload (`src/lib/image.ts`), which strips EXIF including GPS.
- Other people's pets are read only through functions that return public-safe fields (`get_deck`, `get_pet_profile`, `get_inbox`), never from base tables.
- The share card renderer (`src/lib/shareCard.ts`) is only ever given pet names and photo URLs.
- Reports, blocks and suspensions act on the owner, never the pet. A suspended owner's phone is remembered as a hash so deleting the account does not lift the ban.
- Account deletion and data export are real (Settings → Your data), per the Philippine Data Privacy Act.

## Not built yet (V1 per the master prompt)

Photos in chat, the full pet profile screen, per-message reporting, email notifications (the preference is saved; nothing sends yet), waitlist launch emails, web push.
