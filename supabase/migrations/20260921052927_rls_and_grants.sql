-- PAWME V1 — grants and RLS policies.
--
-- Two layers, both required:
--   1. GRANTs decide which tables/columns a role can touch at all. We start
--      from zero and add back the minimum. `anon` gets nothing: every screen
--      past the welcome page is behind phone sign-in.
--   2. RLS policies decide which rows.
--
-- The access model (§9): a user reads only their own data. Other people's
-- public-safe profile fields arrive through functions (next migration), never
-- by selecting from these tables. Column-level UPDATE/INSERT grants stop a
-- client from setting server-owned fields (role, status, cluster, location,
-- subscription_tier, is_seed, timestamps).

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- ranking_config — no client access at all (RLS on, zero policies, no grants).
-- The formula is never exposed (§7).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- owners
-- ---------------------------------------------------------------------------
grant select on public.owners to authenticated;
grant update (display_name, email, adult_confirmed_at, notify_in_app, notify_email, show_distance, discoverable)
  on public.owners to authenticated;

create policy owners_select_own on public.owners
  for select to authenticated
  using (id = (select auth.uid()));

create policy owners_update_own on public.owners
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- pets / pet_photos / pet_tags
-- ---------------------------------------------------------------------------
grant select, delete on public.pets to authenticated;
grant insert (id, owner_id, name, species, breed, is_mixed, sex, birth_date, size, intents)
  on public.pets to authenticated;
grant update (name, species, breed, is_mixed, sex, birth_date, size, intents)
  on public.pets to authenticated;

create policy pets_select_visible on public.pets
  for select to authenticated
  using (owner_id = (select auth.uid()) or (select private.can_see_pet(id)));

create policy pets_insert_own on public.pets
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.is_active_owner()));

create policy pets_update_own on public.pets
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select private.is_active_owner()));

create policy pets_delete_own on public.pets
  for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select, delete on public.pet_photos to authenticated;
grant insert (id, pet_id, storage_path, position) on public.pet_photos to authenticated;
grant update (position) on public.pet_photos to authenticated;

create policy pet_photos_select_visible on public.pet_photos
  for select to authenticated
  using (private.can_see_pet(pet_id));

-- The path must sit in the caller's own storage folder, so a row can never
-- point at someone else's object.
create policy pet_photos_insert_own on public.pet_photos
  for insert to authenticated
  with check (
    private.owns_pet(pet_id)
    and storage_path like (select auth.uid())::text || '/%'
    and (select private.is_active_owner())
  );

create policy pet_photos_update_own on public.pet_photos
  for update to authenticated
  using (private.owns_pet(pet_id))
  with check (private.owns_pet(pet_id));

create policy pet_photos_delete_own on public.pet_photos
  for delete to authenticated
  using (private.owns_pet(pet_id));

-- Tags are written through set_pet_tags() so the 2–4 rule holds.
grant select on public.pet_tags to authenticated;

create policy pet_tags_select_visible on public.pet_tags
  for select to authenticated
  using (private.can_see_pet(pet_id));

-- ---------------------------------------------------------------------------
-- likes / matches / conversations — read-only for clients; swipe(), unmatch()
-- and mark_conversation_read() do the writing.
-- ---------------------------------------------------------------------------
grant select on public.likes to authenticated;

create policy likes_select_own on public.likes
  for select to authenticated
  using (from_owner_id = (select auth.uid()));

grant select on public.matches to authenticated;

create policy matches_select_participant on public.matches
  for select to authenticated
  using ((select auth.uid()) in (owner_a_id, owner_b_id));

grant select on public.conversations to authenticated;

create policy conversations_select_participant on public.conversations
  for select to authenticated
  using ((select auth.uid()) in (owner_a_id, owner_b_id));

-- ---------------------------------------------------------------------------
-- messages — participants read; posting needs an active match (§8). No client
-- UPDATE or DELETE in V1.
-- ---------------------------------------------------------------------------
grant select on public.messages to authenticated;
grant insert (id, conversation_id, kind, body, photo_path, payload) on public.messages to authenticated;

create policy messages_select_participant on public.messages
  for select to authenticated
  using (private.is_conversation_participant(conversation_id));

-- A chat photo must live under its own conversation's folder.
create policy messages_insert_participant on public.messages
  for insert to authenticated
  with check (
    private.can_post(conversation_id)
    and (photo_path is null or photo_path like conversation_id::text || '/%')
  );

-- ---------------------------------------------------------------------------
-- reports — file one, and read back the ones you filed ("report history").
-- Moderators read everything; they act through resolve_report().
-- ---------------------------------------------------------------------------
grant select on public.reports to authenticated;
grant insert (target_owner_id, target_pet_id, message_id, reason, details) on public.reports to authenticated;

create policy reports_select_own_or_moderator on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or (select private.is_moderator()));

-- reporter_id is stamped by the reports_before_insert trigger.
create policy reports_insert_any_signed_in on public.reports
  for insert to authenticated
  with check (target_owner_id is not null and target_owner_id <> (select auth.uid()));

-- ---------------------------------------------------------------------------
-- blocks — yours only. The blocked person cannot see that they were blocked.
-- ---------------------------------------------------------------------------
grant select, delete on public.blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;

create policy blocks_select_own on public.blocks
  for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy blocks_insert_own on public.blocks
  for insert to authenticated
  with check (blocker_id = (select auth.uid()));

create policy blocks_delete_own on public.blocks
  for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- playdate_feedback — private to the owner who gave it (§7).
-- ---------------------------------------------------------------------------
grant select on public.playdate_feedback to authenticated;
grant insert (match_id, owner_id, rating) on public.playdate_feedback to authenticated;
grant update (rating) on public.playdate_feedback to authenticated;

create policy playdate_feedback_select_own on public.playdate_feedback
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy playdate_feedback_insert_own on public.playdate_feedback
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.matches m
      where m.id = match_id and (select auth.uid()) in (m.owner_a_id, m.owner_b_id)
    )
  );

create policy playdate_feedback_update_own on public.playdate_feedback
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- waitlist — written by enter_cluster(); you may read your own row and add an
-- email so we can tell you when PAWME reaches your area.
-- ---------------------------------------------------------------------------
grant select on public.waitlist to authenticated;
grant update (email) on public.waitlist to authenticated;

create policy waitlist_select_own on public.waitlist
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy waitlist_update_own on public.waitlist
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
