-- 0009_leads.sql
-- White-label sales pipeline (Sales-Copilot CRM).
-- Private table: only service_role (via edge functions) can touch it —
-- RLS stays ON with no public policies so end users never see it.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  size text not null default 'm',            -- s | m | e
  source text default 'network',
  stage text not null default 'lead',        -- lead | demo | proposal | signed | paid | won | lost
  addons jsonb not null default '[]'::jsonb,
  setup_fee numeric not null default 0,      -- INR, signed deal's one-time price
  amc numeric not null default 0,            -- INR/month
  notes text,
  next_follow_up timestamptz,
  won_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads enable row level security;

-- service_role bypasses RLS automatically; no public policies
-- (no grant on public.leads to authenticated — private to the owner).