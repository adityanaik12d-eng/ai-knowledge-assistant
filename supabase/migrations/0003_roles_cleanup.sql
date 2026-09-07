-- ============================================================
-- AI Knowledge Assistant — role & department cleanup
-- 1) department concept removed (chatbot is unrestricted)
-- 2) roles are now: admin / free / premium (employee → free)
-- ============================================================

alter table public.profiles drop column if exists department;

alter table public.profiles alter column role set default 'free';
update public.profiles set role = 'free' where role = 'employee';
alter table public.profiles alter column role set not null;