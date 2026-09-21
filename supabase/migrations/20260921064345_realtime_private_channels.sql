-- PAWME V1 — Realtime: every channel is private.
--
-- With "Allow public access" OFF in Realtime settings (required, and now the
-- case in both projects), Supabase rejects ANY non-private channel — including
-- ones that only carry Postgres Changes ("PrivateOnly: This project only allows
-- private channels"). So the app uses exactly two private topics, and joining
-- either needs a SELECT policy on realtime.messages:
--
--   conversation:<conversation_id>  new messages + read position (Postgres
--                                   Changes) and the typing indicator
--                                   (Broadcast). The two participants only.
--   inbox:<owner_id>                new matches / inbox updates (Postgres
--                                   Changes). That owner only. Nobody can
--                                   broadcast on it: there is no INSERT policy.
--
-- Postgres Changes payloads are still filtered by each table's own RLS, so a
-- channel never delivers a row its subscriber could not SELECT.

drop policy conversation_channel_receive on realtime.messages;

create policy private_channels_receive on realtime.messages
  for select to authenticated
  using (
    (
      (select realtime.topic()) like 'conversation:%'
      and private.is_conversation_participant(private.safe_uuid(substr((select realtime.topic()), 14)))
    )
    or (select realtime.topic()) = 'inbox:' || (select auth.uid())::text
  );

-- conversation_channel_send (INSERT, broadcast/presence, can_post) is unchanged.
