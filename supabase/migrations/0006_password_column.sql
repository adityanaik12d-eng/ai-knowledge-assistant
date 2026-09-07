-- Stored password (clear-text in DB) so the admin dashboard can display it.
-- This is a conscious choice for this private self-hosted admin tool.
alter table public.profiles add column if not exists password text;