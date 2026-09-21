-- messages.sender_id is stamped server-side by the messages_before_insert
-- trigger, and clients have no INSERT privilege on the column. Giving it a
-- default of auth.uid() documents that at the column and makes it optional in
-- the generated TypeScript Insert type, so client code never has to pretend to
-- supply it. The trigger still overwrites whatever arrives.
alter table public.messages alter column sender_id set default auth.uid();
