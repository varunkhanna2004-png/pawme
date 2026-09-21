-- PAWME V1 — banned-phone record (approved 2026-09-21; a 14th table, outside
-- master prompt §10's list).
--
-- Gap it closes: a suspended owner could delete their account (which cascades
-- everything) and sign straight back up with the same phone number.
--
-- How it works:
--   * Suspending an owner records a hash of their phone number here. The row
--     has no link to the owner, so it survives account deletion.
--   * When an auth user is created, or their phone changes/gets confirmed, and
--     the phone matches a ban, their owner row is created (or set) SUSPENDED.
--     Sign-up itself still succeeds — the app shows the normal "account
--     suspended" state instead of a confusing sign-up error — and a suspended
--     owner can already do nothing: no deck, no swipes, no pets, no messages.
--   * Unsuspending removes the ban.
--
-- Only a SHA-256 of the digits is stored, never the number. Be clear about what
-- that buys: phone numbers are a small space, so the hash stops casual reading,
-- not a determined attacker with table access — which is why no client role has
-- any access to this table at all.

create table public.banned_phones (
  phone_hash text primary key check (phone_hash ~ '^[0-9a-f]{64}$'),
  reason public.report_reason,
  report_id uuid references public.reports (id) on delete set null,
  banned_by uuid references public.owners (id) on delete set null,
  banned_at timestamptz not null default now()
);
alter table public.banned_phones enable row level security;
create index banned_phones_report_id_idx on public.banned_phones (report_id) where report_id is not null;
create index banned_phones_banned_by_idx on public.banned_phones (banned_by) where banned_by is not null;

-- No policies and no grants for anon/authenticated: definer functions only.
revoke all on public.banned_phones from anon, authenticated;
grant all on public.banned_phones to service_role;

-- '+63 917 000 0002', '639170000002' and '+639170000002' must hash the same.
create function private.phone_hash(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null or regexp_replace(p_phone, '\D', '', 'g') = '' then null
    else encode(sha256(convert_to(regexp_replace(p_phone, '\D', '', 'g'), 'UTF8')), 'hex')
  end;
$$;

create function private.is_phone_banned(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.banned_phones b where b.phone_hash = private.phone_hash(p_phone)
  );
$$;

-- auth.users → owners, now carrying a ban over to the new account.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_banned boolean := private.is_phone_banned(new.phone);
begin
  insert into public.owners (id, phone_verified_at, status, suspended_at)
  values (
    new.id,
    new.phone_confirmed_at,
    case when v_banned then 'suspended' else 'active' end::public.owner_status,
    case when v_banned then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Fires when the phone is confirmed or changed (e.g. swapping a clean number
-- for a banned one after sign-up).
create or replace function private.handle_user_phone_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phone_confirmed_at is distinct from old.phone_confirmed_at then
    update public.owners set phone_verified_at = new.phone_confirmed_at where id = new.id;
  end if;
  if private.is_phone_banned(new.phone) then
    update public.owners set status = 'suspended', suspended_at = now()
    where id = new.id and status <> 'suspended';
  end if;
  return new;
end;
$$;

drop trigger on_auth_user_phone_confirmed on auth.users;
create trigger on_auth_user_phone_confirmed after update of phone, phone_confirmed_at on auth.users
  for each row execute function private.handle_user_phone_confirmed();

-- Suspend: as before, plus record the ban.
create or replace function public.resolve_report(p_report_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_report public.reports;
  v_hash text;
begin
  if not private.is_moderator() then raise exception 'NOT_A_MODERATOR'; end if;
  if p_action not in ('suspend', 'dismiss') then raise exception 'INVALID_ACTION'; end if;
  select * into v_report from public.reports r where r.id = p_report_id for update;
  if not found then raise exception 'REPORT_NOT_FOUND'; end if;

  if p_action = 'dismiss' then
    update public.reports r set status = 'dismissed', resolved_by = v_uid, resolved_at = now() where r.id = p_report_id;
    return;
  end if;

  if v_report.target_owner_id is null then raise exception 'REPORT_TARGET_GONE'; end if;
  if v_report.target_owner_id = v_uid then raise exception 'CANNOT_SUSPEND_SELF'; end if;
  update public.owners o set status = 'suspended', suspended_at = now() where o.id = v_report.target_owner_id;

  select private.phone_hash(u.phone) into v_hash from auth.users u where u.id = v_report.target_owner_id;
  if v_hash is not null then
    insert into public.banned_phones (phone_hash, reason, report_id, banned_by)
    values (v_hash, v_report.reason, v_report.id, v_uid)
    on conflict (phone_hash) do nothing;
  end if;

  update public.reports r set status = 'actioned', resolved_by = v_uid, resolved_at = now()
  where r.target_owner_id = v_report.target_owner_id and r.status = 'open';
end;
$$;

-- Unsuspend: as before, plus lift the ban.
create or replace function public.unsuspend_owner(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_moderator() then raise exception 'NOT_A_MODERATOR'; end if;
  update public.owners o set status = 'active', suspended_at = null where o.id = p_owner_id and o.status = 'suspended';
  if not found then raise exception 'OWNER_NOT_SUSPENDED'; end if;
  delete from public.banned_phones b
  where b.phone_hash = (select private.phone_hash(u.phone) from auth.users u where u.id = p_owner_id);
end;
$$;

-- New functions are PUBLIC-executable by default; close that. (create or replace
-- keeps the grants already set on resolve_report / unsuspend_owner.)
revoke execute on function private.phone_hash(text), private.is_phone_banned(text) from public, anon, authenticated;
grant execute on function private.phone_hash(text), private.is_phone_banned(text) to service_role;
