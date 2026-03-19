create extension if not exists pgcrypto;

create table if not exists public.memora_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, lower(name))
);

create table if not exists public.memora_sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  started_at timestamptz not null,
  stopped_at timestamptz,
  local_file_path text,
  local_file_name text,
  status text not null,
  category_id uuid references public.memora_categories(id) on delete set null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.memora_processing_jobs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null references public.memora_sessions(id) on delete cascade,
  job_type text not null,
  status text not null,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null
);

create table if not exists public.memora_extracted_chunks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null references public.memora_sessions(id) on delete cascade,
  chunk_type text not null,
  content text not null,
  confidence double precision not null,
  source_job_type text not null,
  created_at timestamptz not null
);

create table if not exists public.memora_user_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists idx_memora_categories_user_id on public.memora_categories(user_id);
create index if not exists idx_memora_sessions_user_id on public.memora_sessions(user_id);
create index if not exists idx_memora_sessions_category_id on public.memora_sessions(category_id);
create index if not exists idx_memora_processing_jobs_session_id on public.memora_processing_jobs(session_id);
create index if not exists idx_memora_extracted_chunks_session_id on public.memora_extracted_chunks(session_id);
create index if not exists idx_memora_extracted_chunks_user_id on public.memora_extracted_chunks(user_id);

alter table public.memora_categories enable row level security;
alter table public.memora_sessions enable row level security;
alter table public.memora_processing_jobs enable row level security;
alter table public.memora_extracted_chunks enable row level security;
alter table public.memora_user_settings enable row level security;

create policy if not exists "memora_categories_select_own" on public.memora_categories
for select using (auth.uid() = user_id);

create policy if not exists "memora_categories_insert_own" on public.memora_categories
for insert with check (auth.uid() = user_id);

create policy if not exists "memora_categories_update_own" on public.memora_categories
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "memora_categories_delete_own" on public.memora_categories
for delete using (auth.uid() = user_id);

create policy if not exists "memora_sessions_select_own" on public.memora_sessions
for select using (auth.uid() = user_id);

create policy if not exists "memora_sessions_insert_own" on public.memora_sessions
for insert with check (auth.uid() = user_id);

create policy if not exists "memora_sessions_update_own" on public.memora_sessions
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "memora_sessions_delete_own" on public.memora_sessions
for delete using (auth.uid() = user_id);

create policy if not exists "memora_processing_jobs_select_own" on public.memora_processing_jobs
for select using (auth.uid() = user_id);

create policy if not exists "memora_processing_jobs_insert_own" on public.memora_processing_jobs
for insert with check (auth.uid() = user_id);

create policy if not exists "memora_processing_jobs_update_own" on public.memora_processing_jobs
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "memora_processing_jobs_delete_own" on public.memora_processing_jobs
for delete using (auth.uid() = user_id);

create policy if not exists "memora_extracted_chunks_select_own" on public.memora_extracted_chunks
for select using (auth.uid() = user_id);

create policy if not exists "memora_extracted_chunks_insert_own" on public.memora_extracted_chunks
for insert with check (auth.uid() = user_id);

create policy if not exists "memora_extracted_chunks_update_own" on public.memora_extracted_chunks
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "memora_extracted_chunks_delete_own" on public.memora_extracted_chunks
for delete using (auth.uid() = user_id);

create policy if not exists "memora_user_settings_select_own" on public.memora_user_settings
for select using (auth.uid() = user_id);

create policy if not exists "memora_user_settings_insert_own" on public.memora_user_settings
for insert with check (auth.uid() = user_id);

create policy if not exists "memora_user_settings_update_own" on public.memora_user_settings
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "memora_user_settings_delete_own" on public.memora_user_settings
for delete using (auth.uid() = user_id);