-- PAWME — grant (or revoke) the moderator role for one account. Run ONCE per
-- project, by hand, in the Supabase dashboard → SQL editor (or with
-- `supabase db query --linked -f scripts/grant-moderator.sql` on the linked project).
--
-- Moderator status is DATA (owners.role), never code: the app and every
-- moderator-only function (get_moderation_queue, resolve_report, unsuspend_owner,
-- get_owner_stats) read this column, so granting or revoking needs no redeploy
-- and nobody's email is special-cased in the app.
--
-- The person must have signed in at least once (that creates their owners row).
-- Edit the address, then run. The query prints the row it changed; zero rows
-- means that email has no account yet.

update public.owners o
set role = 'moderator'
from auth.users u
where u.id = o.id
  and lower(u.email) = lower('varunkhanna2004@gmail.com')   -- <- the account to grant
returning o.id, u.email, o.role;

-- To revoke:
-- update public.owners o set role = 'user' from auth.users u
-- where u.id = o.id and lower(u.email) = lower('someone@example.com') returning o.id, u.email, o.role;

-- To list current moderators:
-- select u.email, o.display_name from public.owners o join auth.users u on u.id = o.id where o.role = 'moderator';
