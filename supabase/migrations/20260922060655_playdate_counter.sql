-- PAWME V1 — playdate proposals (§2, §7): "Propose a change".
--
-- A counter-proposal must be ONE change: the old proposal is marked 'changed'
-- and the new one is inserted, together or not at all. Done as two client calls,
-- a dropped connection could leave either two open proposals or a declined one
-- with no replacement. So it is a function, and the proposal payload gains:
--   status 'changed'          the other person proposed a change instead
--   replaces <message id>     on the new proposal: which one it replaces
--   replaced_by <message id>  on the old one
-- Status transitions stay server-owned: respond_playdate() (accept/decline) and
-- counter_playdate() (change) are the only ways a proposal leaves 'proposed'.

alter table public.messages drop constraint messages_shape;
alter table public.messages add constraint messages_shape check (
  case kind
    when 'text' then body is not null and btrim(body) <> '' and photo_path is null and payload is null
    when 'photo' then photo_path is not null and payload is null
    when 'playdate_proposal' then
      photo_path is null
      and payload is not null
      and jsonb_typeof(payload) = 'object'
      and payload ? 'place' and payload ? 'starts_at'
      and payload ->> 'status' in ('proposed', 'accepted', 'declined', 'changed')
  end
);

-- The insert trigger rebuilds the payload from scratch; now it keeps a valid
-- `replaces` (a proposal in the same conversation) when one is given.
create or replace function private.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place text;
  v_replaces uuid;
begin
  if (select auth.uid()) is not null then
    new.sender_id := (select auth.uid());
    new.created_at := now();
  end if;

  if new.kind = 'playdate_proposal' then
    v_place := btrim(coalesce(new.payload ->> 'place', ''));
    if char_length(v_place) not between 1 and 120 then
      raise exception 'PLAYDATE_PLACE_INVALID';
    end if;
    perform (new.payload ->> 'starts_at')::timestamptz; -- raises if not a timestamp
    v_replaces := private.safe_uuid(new.payload ->> 'replaces');
    if v_replaces is not null and not exists (
      select 1 from public.messages m
      where m.id = v_replaces and m.conversation_id = new.conversation_id and m.kind = 'playdate_proposal'
    ) then
      v_replaces := null;
    end if;
    new.payload := jsonb_build_object(
      'place', v_place,
      'starts_at', new.payload ->> 'starts_at',
      'note', left(coalesce(new.payload ->> 'note', ''), 280),
      'status', 'proposed'
    ) || case when v_replaces is null then '{}'::jsonb else jsonb_build_object('replaces', v_replaces) end;
  end if;
  return new;
end;
$$;

-- Answer a proposal with a different place/time. Only the person it was sent to,
-- once, while the match is active — the same rules as accept / decline.
create function public.counter_playdate(p_message_id uuid, p_place text, p_starts_at timestamptz, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.messages;
  v_new_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_old from public.messages msg where msg.id = p_message_id and msg.kind = 'playdate_proposal' for update;
  if not found or not private.can_post(v_old.conversation_id) then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_old.sender_id = v_uid then raise exception 'CANNOT_ANSWER_OWN_PROPOSAL'; end if;
  if v_old.payload ->> 'status' <> 'proposed' then raise exception 'PROPOSAL_ALREADY_ANSWERED'; end if;

  insert into public.messages (conversation_id, kind, payload)
  values (v_old.conversation_id, 'playdate_proposal', jsonb_build_object('place', p_place, 'starts_at', p_starts_at, 'note', p_note, 'replaces', p_message_id))
  returning id into v_new_id;

  update public.messages msg
  set payload = msg.payload || jsonb_build_object('status', 'changed', 'responded_at', now(), 'replaced_by', v_new_id)
  where msg.id = p_message_id;

  return v_new_id;
end;
$$;

revoke execute on function public.counter_playdate(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.counter_playdate(uuid, text, timestamptz, text) to authenticated, service_role;
