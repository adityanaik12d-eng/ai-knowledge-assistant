-- Admin protection guards
-- 1. owner flag: only the owner may manage other admins (demote/suspend/make owner)
-- 2. self-guard: an admin cannot change their own role or suspension status
-- 3. last-admin guard: the final active admin can never be demoted or suspended

alter table public.profiles add column if not exists is_owner boolean not null default false;

-- mark the very first admin as the owner (deterministic for existing deployments)
update public.profiles set is_owner = true
where id = (
  select id from public.profiles
  where role = 'admin'
  order by created_at asc
  limit 1
);