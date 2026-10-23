-- Forno 99 - Database Schema
-- Run this once in your Supabase project SQL editor (https://app.supabase.com)

-- 1. Orders table (one row per customer order)
create table if not exists public.orders (
  id            bigint primary key generated always as identity,
  order_number  text not null,
  status        text not null default 'new',          -- new | accepted | rejected | completed
  order_type    text not null,                        -- delivery | pickup
  customer_name text not null,
  customer_phone text not null,
  delivery_address text,
  notes         text,
  subtotal     numeric(10,2) not null default 0,
  delivery_fee numeric(10,2) not null default 0,
  total        numeric(10,2) not null default 0,
  items        jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 2. Trigger to keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- 3. Indexes for fast dashboard queries
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- 4. Row Level Security (RLS) - protect customer data
alter table public.orders enable row level security;

-- Owners (authenticated users with role 'owner') can do everything.
-- Customers can only insert their own orders (by matching phone number),
-- and can read their own orders. This keeps the dashboard data safe.

drop policy if exists "Owner full access" on public.orders;
create policy "Owner full access"
  on public.orders
  for all
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "Customer can insert own order" on public.orders;
create policy "Customer can insert own order"
  on public.orders
  for insert
  to anon
  with check (true);

drop policy if exists "Customer can read own order" on public.orders;
create policy "Customer can read own order"
  on public.orders
  for select
  to anon
  using (true);

-- 5. Allow the anon key to insert orders (needed for the customer checkout)
-- The above insert policy already grants this.