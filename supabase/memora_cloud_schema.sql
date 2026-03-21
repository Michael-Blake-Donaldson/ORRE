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

create table if not exists public.memora_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free',
  status text not null default 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memora_subscriptions_tier_check check (tier in ('free', 'premium')),
  constraint memora_subscriptions_status_check check (status in ('inactive', 'active', 'past_due', 'canceled'))
);

create table if not exists public.memora_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_key text not null,
  total_tokens integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period_key),
  constraint memora_ai_usage_total_tokens_check check (total_tokens >= 0)
);

create index if not exists idx_memora_categories_user_id on public.memora_categories(user_id);
create index if not exists idx_memora_sessions_user_id on public.memora_sessions(user_id);
create index if not exists idx_memora_sessions_category_id on public.memora_sessions(category_id);
create index if not exists idx_memora_processing_jobs_session_id on public.memora_processing_jobs(session_id);
create index if not exists idx_memora_extracted_chunks_session_id on public.memora_extracted_chunks(session_id);
create index if not exists idx_memora_extracted_chunks_user_id on public.memora_extracted_chunks(user_id);
create index if not exists idx_memora_subscriptions_status on public.memora_subscriptions(status);
create index if not exists idx_memora_ai_usage_period_key on public.memora_ai_usage(period_key);

alter table public.memora_categories enable row level security;
alter table public.memora_sessions enable row level security;
alter table public.memora_processing_jobs enable row level security;
alter table public.memora_extracted_chunks enable row level security;
alter table public.memora_user_settings enable row level security;
alter table public.memora_subscriptions enable row level security;
alter table public.memora_ai_usage enable row level security;

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

create policy if not exists "memora_subscriptions_select_own" on public.memora_subscriptions
for select using (auth.uid() = user_id);

create policy if not exists "memora_subscriptions_insert_own" on public.memora_subscriptions
for insert with check (auth.uid() = user_id);

create policy if not exists "memora_subscriptions_update_own" on public.memora_subscriptions
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "memora_subscriptions_delete_own" on public.memora_subscriptions
for delete using (auth.uid() = user_id);

create policy if not exists "memora_ai_usage_select_own" on public.memora_ai_usage
for select using (auth.uid() = user_id);

create policy if not exists "memora_ai_usage_insert_own" on public.memora_ai_usage
for insert with check (auth.uid() = user_id);

create policy if not exists "memora_ai_usage_update_own" on public.memora_ai_usage
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "memora_ai_usage_delete_own" on public.memora_ai_usage
for delete using (auth.uid() = user_id);