-- ============================================================
-- AI Knowledge Assistant — initial schema
-- Run this in Supabase Dashboard → SQL Editor for your project.
-- Requires the pgvector extension (enabled by default on Supabase).
-- ============================================================

create extension if not exists vector with schema extensions;

-- ------------------------------------------------------------
-- profiles (one row per auth user; created automatically on signup)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'employee',
  department text not null default 'unassigned',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- projects (optional grouping for conversations; used by sidebar)
-- ------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- documents (knowledge base chunks with embeddings)
-- embedding dims = 3072 (Google gemini-embedding-001)
-- ------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  embedding vector(3072),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists documents_embedding_idx
  on public.documents using hnsw (embedding vector_cosine_ops);

-- vector search helper (called by the /chat edge function)
create or replace function public.match_documents(
  query_embedding vector(3072),
  match_count int default 5
)
returns table (id uuid, title text, content text, similarity double precision)
language sql stable
as $$
  select d.id, d.title, d.content, 1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where d.embedding is not null
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- ------------------------------------------------------------
-- conversations and messages
-- ------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  sources jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

-- ------------------------------------------------------------
-- auto-create profile on signup
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.documents enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- profiles: users read/update their own profile
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id);

-- projects: owners manage their own
drop policy if exists projects_all_own on public.projects;
create policy projects_all_own on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- documents: any authenticated user may read; any may add (via ingest fn);
-- only admin may delete
drop policy if exists documents_select_auth on public.documents;
create policy documents_select_auth on public.documents
  for select using (auth.role() = 'authenticated');

drop policy if exists documents_insert_auth on public.documents;
create policy documents_insert_auth on public.documents
  for insert with check (auth.role() = 'authenticated');

drop policy if exists documents_delete_admin on public.documents;
create policy documents_delete_admin on public.documents
  for delete using (
    coalesce((select role from public.profiles where id = auth.uid()), 'employee') = 'admin'
  );

-- conversations: owners manage their own
drop policy if exists conversations_all_own on public.conversations;
create policy conversations_all_own on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- messages: owners manage their own
drop policy if exists messages_all_own on public.messages;
create policy messages_all_own on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- standard grants for supabase roles
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;