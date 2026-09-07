-- ============================================================
-- AI Knowledge Assistant — admin dashboard support
-- 1) per-document stats view for the Documents tab
-- 2) is_admin() helper + admin read-policy for the Users tab
-- ============================================================

-- per-document stats (used by the /admin edge function Documents tab)
create or replace view public.document_stats as
select
  title,
  coalesce(uploaded_by::text, '') as uploaded_by,
  count(*) as "chunkCount",
  sum(length(content)) as "totalChars",
  min(created_at) as "firstUploaded"
from public.documents
group by title, uploaded_by;

grant select on public.document_stats to authenticated, service_role;

-- is_admin helper (security definer → no RLS recursion when used in policies)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.suspended = false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- admins may read/select every profile (Users tab in Admin Dashboard)
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select using (public.is_admin());