-- Verified TCG Stage 1: authenticated users and personal data.
-- Run this migration once in Supabase SQL Editor.

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  username text unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_items (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  card_id text not null,
  quantity integer not null default 1 check (quantity > 0),
  condition text not null,
  grading jsonb,
  acquired_at date,
  acquired_price numeric(12, 2),
  currency text not null default 'AUD',
  notes text,
  is_for_sale boolean not null default false,
  is_for_trade boolean not null default false,
  card_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wishlist_items (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  card_id text not null,
  desired_grade text,
  target_price numeric(12, 2),
  currency text not null default 'AUD',
  price_alert_enabled boolean not null default false,
  alert_type text,
  card_snapshot jsonb,
  added_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collection_items_user_id_idx
  on public.collection_items(user_id);

create index if not exists wishlist_items_user_id_idx
  on public.wishlist_items(user_id);

alter table public.users enable row level security;
alter table public.collection_items enable row level security;
alter table public.wishlist_items enable row level security;

drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select to authenticated
  using (id = auth.uid());

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists collection_items_own on public.collection_items;
create policy collection_items_own on public.collection_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists wishlist_items_own on public.wishlist_items;
create policy wishlist_items_own on public.wishlist_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
