-- DEV ONLY. Puts the Supabase test-number accounts (…0001/2/3) back to a clean
-- slate so the flows can be replayed: no bans, suspensions, reports, blocks,
-- matches or swipes involving them. Seed pets' pre-likes are kept.
--   supabase db query --linked -f e2e/reset-test-accounts.sql     (check the link is pawme-dev first!)
with t as (select id from auth.users where phone in ('639170000001', '639170000002', '639170000003')),
ban as (delete from public.banned_phones returning 1),
act as (update public.owners set status = 'active', suspended_at = null where id in (select id from t) and status = 'suspended' returning 1),
rep as (delete from public.reports where reporter_id in (select id from t) or target_owner_id in (select id from t) returning 1),
blk as (delete from public.blocks where blocker_id in (select id from t) or blocked_id in (select id from t) returning 1),
mat as (delete from public.matches where owner_a_id in (select id from t) or owner_b_id in (select id from t) returning 1),
lik as (delete from public.likes where from_owner_id in (select id from t) returning 1)
select (select count(*) from ban) bans, (select count(*) from act) unsuspended, (select count(*) from rep) reports,
       (select count(*) from blk) blocks, (select count(*) from mat) matches, (select count(*) from lik) swipes;
