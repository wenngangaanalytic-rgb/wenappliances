-- Run this in the Supabase SQL Editor after the public.products table exists.
-- The frontend uses only the anon public key; write access is restricted to
-- Supabase Auth users whose app_metadata.role is SUPER_ADMIN.

alter table public.products enable row level security;

-- Remove legacy permissive policies so the SUPER_ADMIN rules below are the
-- only policies granting product writes.
drop policy if exists "Admins can manage products" on public.products;
drop policy if exists "Public can view products" on public.products;

drop policy if exists "Public can read products" on public.products;
create policy "Public can read products"
  on public.products
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Super admins can insert products" on public.products;
create policy "Super admins can insert products"
  on public.products
  for insert
  to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

drop policy if exists "Super admins can update products" on public.products;
create policy "Super admins can update products"
  on public.products
  for update
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

drop policy if exists "Super admins can delete products" on public.products;
create policy "Super admins can delete products"
  on public.products
  for delete
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

-- Storage setup for ProductEditor.jsx. Keep the bucket public so the
-- customer storefront can render getPublicUrl(...) image links.
insert into storage.buckets (id, name, public)
values ('Wenappliances', 'Wenappliances', true)
on conflict (id) do update set public = true;

drop policy if exists "Super admins can upload product images" on storage.objects;
create policy "Super admins can upload product images"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'Wenappliances'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
  );

drop policy if exists "Super admins can remove product images" on storage.objects;
create policy "Super admins can remove product images"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'Wenappliances'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
  );
