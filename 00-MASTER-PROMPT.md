# PAWME — V1 MASTER BUILD PROMPT

**For:** an AI coding agent (Claude Code / Cursor / v0)
**Goal:** a working, launchable V1 that proves matching liquidity in ONE Metro Manila cluster.
**Non-goal:** a feature-complete "social graph for pets." That comes later. Do not build it now.

---

## 0. READ THIS FIRST — THE ONE RULE

Every scope decision resolves the same way: **does this help two pet owners in the same neighborhood discover each other, match, chat, and arrange a playdate?** If yes, build it. If no, it is Phase 2 — write a TODO and move on. When in doubt, cut.

A matching app dies from *empty screens*, not from missing features. Your entire job in V1 is to make one small cluster feel alive.

---

## 1. ROLE

Act as a small, senior startup team: one product-minded full-stack engineer, one mobile UX designer, one backend/data engineer, one trust & safety reviewer. Favor decisions a two-person startup would actually ship. Do not over-architect. Do not build microservices. Do not build an admin portal beyond a single moderation queue.

---

## 2. WHAT V1 IS

A mobile-first web app (PWA) — **not** native iOS/Android in V1. Rationale: instant deploy, no App Store review, shareable by link (critical for the viral loop), one codebase. Native comes only after liquidity is proven.

The complete V1 loop, and nothing outside it:

`Sign up → Create pet profile → Discover nearby pets → Swipe → Mutual match → Chat → Propose a playdate → (report/block available everywhere)`

---

## 3. HARD CONSTRAINTS (build these into the product, not just the plan)

1. **Single cluster at launch.** The app operates in ONE configurable geographic cluster (default: Makati). New signups outside the cluster radius go on a waitlist with "PAWME isn't in your area yet — we'll tell you when it is." This is a *feature*: it concentrates liquidity. Make the cluster centroid + radius a single config value.
2. **Owner operates the account.** Never imply pets operate accounts. Every action is by an adult guardian.
3. **Approximate distance only.** Never expose exact coordinates. Snap displayed location to ~500m grid; show "1.8 km away," never a pin on a house.
4. **Playdates/friendship is the V1 positioning.** Breeding mode is OFF in V1 (the welfare/scam surface isn't worth it before you have moderation staff). Adoption is OFF in V1.
5. **No fake data in production.** Seed data is clearly flagged and lives only in dev.

---

## 4. TECH (pick these unless you have a strong reason)

- **Frontend:** React + Vite PWA, TypeScript, Tailwind. Mobile-first, installable, works on poor connections.
- **Backend + DB + auth + storage + realtime:** Supabase (Postgres, Row Level Security, Realtime for chat, Storage for photos, Auth for phone OTP). One managed platform = a solo founder can run it.
- **Push:** web push via service worker; skip if it costs more than a day in V1 — use in-app + email for match notifications instead.
- **Payments:** NONE in V1. No premium tiers, no PayMongo. Monetization is meaningless before liquidity. Leave a clean seam (a `subscription_tier` column defaulting to `free`) and nothing more.

Do not add Redis, Kafka, a separate API server, or Kubernetes. If you reach for them, you've misunderstood the scope.

---

## 5. SCREENS — the complete V1 inventory (roughly 9)

1. **Welcome / value prop** + phone signup
2. **OTP verification**
3. **Location permission** → cluster check (in-cluster or waitlist)
4. **Add pet** (name, dog/cat, breed + mixed toggle, sex, age, size, 1–5 photos, 2–4 personality tags, intent: Playdate / Walking Buddy / Friendship)
5. **Discover** (the swipe deck — the heart of the app)
6. **Full pet profile** (tap-through from a card)
7. **Matches inbox**
8. **Chat** (per match, realtime)
9. **My profile / settings** (edit pet, notifications, privacy toggles, delete account, report history)

Plus one non-user screen: a bare **moderation queue** (a protected route listing open reports with suspend/dismiss actions). That's the whole "admin portal" for V1.

Every screen must handle: loading, empty, error, offline, permission-denied. The **empty state on Discover is the most important screen in the app** — when the deck runs out, don't show a blank; show "You've met everyone nearby for now 🐾 Invite a friend to grow the pack" with a share button. This is your liquidity release valve.

---

## 6. THE SWIPE DECK (spend your quality budget here)

- Card shows: photo, name, age, breed, distance, 2–4 tags, intent, verified badge if phone-verified.
- Gestures: left = pass, right = like, up = "Super Paw" (limited to ~1/day in V1 to keep it meaningful), a rewind button for the last card.
- 60fps, haptics where available, prefetch the next 3 cards' images.
- Deck is served by the ranking function (§7), never a raw distance sort.

---

## 7. MATCHING + RANKING

**Match:** A likes B *and* B likes A → animated "IT'S A PAW-MATCH!" → the match lands in both inboxes.

**Ranking (keep it simple but real):** score candidates in the cluster by a weighted sum, weights stored in a config row so you can tune without redeploying:

```
score = intent_overlap
      + tag_compatibility
      + size_fit
      + age_fit
      + proximity
      + recency_of_activity      // strongly favor active users — dead profiles kill liquidity
      + profile_completeness
      + small_random_term        // exploration, prevents a closed loop
```

Do NOT expose the formula in the UI. Do add one honest touch: a plain-language "Why this match" line ("Similar size and energy") — this is your differentiator and later becomes real IP once you feed it playdate outcomes. In V1 it can be rule-based, not ML.

**Feedback seam for later:** after a match, a lightweight "How did the playdate go?" prompt (😍 / 😊 / 😐 / 🙁), stored privately. You won't use it for ranking in V1, but capturing it from day one is what makes the data defensible.

---

## 8. CHAT

Realtime (Supabase Realtime). Text + photos + emoji. Typing indicator, read status. Available ONLY after a mutual match. Block / report / unmatch reachable from every conversation. 2–3 auto-suggested openers ("What's [pet]'s favorite park?"). Never auto-share phone numbers.

---

## 9. TRUST & SAFETY (non-negotiable, even in V1)

- Phone OTP verification → "Verified" badge.
- Report (user + pet + reasons: harassment, scam, animal welfare, sexual content involving animals, impersonation, spam), block, unmatch — everywhere.
- Reports flow to the moderation queue; a reported user can be suspended in one click.
- RLS on every table: a user can read only their own data + public-safe profile fields of others. No client ever queries raw locations or another user's contact info.
- Account deletion + data export (Philippine Data Privacy Act). Build these; don't stub them.

---

## 10. DATABASE (V1 tables only)

`owners`, `pets`, `pet_photos`, `pet_tags`, `likes`, `matches`, `conversations`, `messages`, `reports`, `blocks`, `playdate_feedback`, `waitlist`, `ranking_config`.

Postgres. Geospatial: store a snapped/approximate point (PostGIS or a simple geohash is fine at V1 scale). Index likes by (from, to), messages by conversation, pets by cluster + last_active. Add a `subscription_tier` column on `owners` defaulting to `free` and touch it nowhere else.

Leave stubs (a TODO comment + empty migration) for: `events`, `communities`, `lost_pet_alerts`, `subscriptions`. Do not implement them.

---

## 11. THE VIRAL LOOP (this is your growth, treat it as core, not polish)

Every match generates a shareable, public-safe card image: "🐾 [Pet A] ❤️ [Pet B] — a Paw Match on PAWME," with a deep link to install/create a pet. Share targets: Messenger, Instagram, FB, WhatsApp, Viber, TikTok, copy-link. A referral link that credits the inviter. This loop, plus your real-world seeding (vets, groomers, condos, dog parks, pet cafés, shelters in the launch cluster), is how the one cluster fills. Build the share card in V1; it is not optional.

---

## 12. WHAT TO OUTPUT, IN ORDER

1. A **one-page** V1 scope + screen list + data model (confirm you've absorbed the constraints above — don't reprint them, react to them).
2. Supabase schema + migrations + RLS policies.
3. The app, screen by screen, in the order of §5, each fully working (persisted to backend, real states handled) before moving to the next.
4. Seed script (dev-only, flagged) with realistic Makati pet data so Discover isn't empty while you build.
5. README: env vars, how to run, how to change the cluster, how to deploy to Vercel/Netlify.

Build the Discover→Match→Chat spine first and get it genuinely working end-to-end before onboarding polish. A rough onboarding into a working core beats a beautiful onboarding into an empty deck.

---

## 13. EXPLICITLY OUT OF SCOPE FOR V1 (do not build; TODO only)

Breeding, adoption, communities, events, lost-pet network, discovery map, pet social graph / Paw Friends, AI bio generation, premium tiers & payments, native apps, multi-city, multi-currency, gamification/badges beyond a "verified" tick, commercial marketplace, brand ads.

Every one of these is a good Phase 2/3 idea. Building any of them in V1 is a mistake, because none of them matters until two owners in BGC reliably match and meet.

---

## 14. NORTH STAR

Long term: the social graph for pets. **V1's only job:** prove that in one dense Manila cluster (Makati), pet owners will match, chat, and actually meet. Everything is subordinate to that. Start with the Discover deck and the schema. Do not begin coding features outside §5.
