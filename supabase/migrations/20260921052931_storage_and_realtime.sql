-- PAWME V1 — Storage buckets + policies, and Realtime.

-- ---------------------------------------------------------------------------
-- Storage
--
-- pet-photos  PUBLIC bucket. Pet photos are public-safe by design (they go on
--             the shareable match card, §11), and public URLs are CDN-cached,
--             which is what lets the deck prefetch the next three cards on a
--             poor connection. Public means "readable by exact URL"; nobody
--             can list the bucket. Writes are limited to your own folder:
--               {owner_id}/{pet_id}/{file}
--             The client re-encodes every image before upload, which strips
--             EXIF GPS (§3.3) and keeps files small.
--
-- chat-photos PRIVATE bucket. Readable only by the two people in the
--             conversation, via short-lived signed URLs:
--               {conversation_id}/{file}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('pet-photos', 'pet-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('chat-photos', 'chat-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Upsert needs INSERT + SELECT + UPDATE, so all three exist for the own-folder case.
create policy pet_photos_objects_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy pet_photos_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pet-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_active_owner())
  );

create policy pet_photos_objects_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy pet_photos_objects_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Turns 'conversation:<uuid>' (a Realtime topic) or a '<uuid>' folder name into
-- a uuid, or null if it is not one — so a malformed value denies instead of
-- raising a cast error.
create function private.safe_uuid(p_text text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_text::uuid
  end;
$$;
revoke execute on function private.safe_uuid(text) from public, anon;
grant execute on function private.safe_uuid(text) to authenticated, service_role;

create policy chat_photos_objects_select_participant on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-photos'
    and private.is_conversation_participant(private.safe_uuid((storage.foldername(name))[1]))
  );

-- Uploading needs the same right as posting: an active match, not suspended,
-- no block. No UPDATE or DELETE policy: chat photos are immutable in V1.
create policy chat_photos_objects_insert_participant on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-photos'
    and private.can_post(private.safe_uuid((storage.foldername(name))[1]))
  );

-- ---------------------------------------------------------------------------
-- Realtime
--
-- Postgres Changes (new messages, new matches, inbox updates) respects the
-- table RLS above, so each user only receives their own rows.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.matches, public.conversations;
  end if;
end;
$$;

-- Typing indicator + online presence (§8) use Broadcast/Presence on the private
-- channel 'conversation:<conversation_id>'. Only the two participants may join.
-- NOTE: "Allow public access" must be switched OFF in the project's Realtime
-- settings, otherwise private-channel policies are not enforced.
create policy conversation_channel_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'conversation:%'
    and private.is_conversation_participant(private.safe_uuid(substr((select realtime.topic()), 14)))
  );

create policy conversation_channel_send on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'conversation:%'
    and private.can_post(private.safe_uuid(substr((select realtime.topic()), 14)))
  );
