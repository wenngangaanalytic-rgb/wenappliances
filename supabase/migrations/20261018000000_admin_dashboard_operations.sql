-- Admin operations support for WenAppliances.
-- Adds publication controls, private delivery documents, and an immutable
-- audit trail while keeping authorization tied to trusted app_metadata.role.

alter table public.products
  add column if not exists is_published boolean not null default true;
alter table public.products enable row level security;

-- Enforce visibility at the data boundary as well as in the storefront query.
-- A signed-in SUPER_ADMIN retains access to hidden products for inventory work.
drop policy if exists "Admins can manage products" on public.products;
drop policy if exists "Public can read products" on public.products;
drop policy if exists "Public can view products" on public.products;
create policy "Public can read published products"
  on public.products
  for select
  to anon, authenticated
  using (
    is_published is true
    or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
  );

grant insert, update, delete on table public.products to authenticated;
drop policy if exists "Super admins can insert products" on public.products;
create policy "Super admins can insert products"
  on public.products for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');
drop policy if exists "Super admins can update products" on public.products;
create policy "Super admins can update products"
  on public.products for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');
drop policy if exists "Super admins can delete products" on public.products;
create policy "Super admins can delete products"
  on public.products for delete to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

-- Prevent stale carts or direct RPC calls from buying a product after it has
-- been hidden. Order creation remains atomic: this trigger error rolls back
-- the order and any stock updates in the surrounding transaction.
create or replace function public.ensure_order_item_product_is_published()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.products p
    where p.id = new.product_id
      and p.is_published is true
  ) then
    raise exception using errcode = 'P0001', message = 'This product is no longer available.';
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_order_item_product_is_published() from public, anon, authenticated;
drop trigger if exists order_item_requires_published_product on public.order_items;
create trigger order_item_requires_published_product
  before insert or update of product_id on public.order_items
  for each row execute function public.ensure_order_item_product_is_published();

create index if not exists products_published_category_idx
  on public.products (category)
  where is_published = true;

alter table public.orders
  add column if not exists delivery_assignee_name text,
  add column if not exists delivery_assignee_phone text,
  add column if not exists delivery_document_path text;

alter table public.orders
  drop constraint if exists orders_delivery_assignee_name_length_check,
  drop constraint if exists orders_delivery_assignee_phone_length_check,
  drop constraint if exists orders_delivery_document_path_length_check;

alter table public.orders
  add constraint orders_delivery_assignee_name_length_check
    check (delivery_assignee_name is null or char_length(delivery_assignee_name) <= 120),
  add constraint orders_delivery_assignee_phone_length_check
    check (delivery_assignee_phone is null or char_length(delivery_assignee_phone) <= 32),
  add constraint orders_delivery_document_path_length_check
    check (delivery_document_path is null or char_length(delivery_document_path) <= 500);

-- Delivery documents contain customer/order information and must not be
-- exposed through the public product-image bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wen-delivery-documents',
  'wen-delivery-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
  set name = excluded.name,
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Super admins can read delivery documents" on storage.objects;
create policy "Super admins can read delivery documents"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'wen-delivery-documents'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
  );

drop policy if exists "Super admins can upload delivery documents" on storage.objects;
create policy "Super admins can upload delivery documents"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'wen-delivery-documents'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
  );

drop policy if exists "Super admins can replace delivery documents" on storage.objects;
create policy "Super admins can replace delivery documents"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'wen-delivery-documents'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
  )
  with check (
    bucket_id = 'wen-delivery-documents'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
  );

drop policy if exists "Super admins can delete delivery documents" on storage.objects;
create policy "Super admins can delete delivery documents"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'wen-delivery-documents'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
  );

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 64),
  entity text not null check (entity in ('products', 'orders')),
  entity_id text not null check (char_length(entity_id) between 1 and 120),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object')
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from public, anon, authenticated;
grant select on table public.admin_audit_log to authenticated;

drop policy if exists "Super admins can read audit log" on public.admin_audit_log;
create policy "Super admins can read audit log"
  on public.admin_audit_log
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

create or replace function public.capture_admin_audit_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  event_action text;
  event_id text;
  event_details jsonb := '{}'::jsonb;
  old_row jsonb;
  new_row jsonb;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'SUPER_ADMIN' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'products' then
    if tg_op = 'DELETE' then
      old_row := to_jsonb(old);
      event_action := 'product.deleted';
      event_id := old.id::text;
      event_details := jsonb_build_object(
        'name', old_row -> 'name',
        'category', old_row -> 'category',
        'price', old_row -> 'price',
        'stock', old_row -> 'stock',
        'is_published', old_row -> 'is_published'
      );
    elsif tg_op = 'INSERT' then
      new_row := to_jsonb(new);
      event_action := 'product.created';
      event_id := new.id::text;
      event_details := jsonb_build_object(
        'name', new_row -> 'name',
        'category', new_row -> 'category',
        'price', new_row -> 'price',
        'stock', new_row -> 'stock',
        'is_published', new_row -> 'is_published'
      );
    else
      old_row := to_jsonb(old);
      new_row := to_jsonb(new);
      if old_row -> 'name' is distinct from new_row -> 'name'
         or old_row -> 'category' is distinct from new_row -> 'category'
         or old_row -> 'price' is distinct from new_row -> 'price'
         or old_row -> 'stock' is distinct from new_row -> 'stock'
         or old_row -> 'is_published' is distinct from new_row -> 'is_published' then
        event_action := 'product.updated';
        event_id := new.id::text;
        event_details := jsonb_build_object(
          'before', jsonb_build_object(
            'name', old_row -> 'name', 'category', old_row -> 'category',
            'price', old_row -> 'price', 'stock', old_row -> 'stock',
            'is_published', old_row -> 'is_published'
          ),
          'after', jsonb_build_object(
            'name', new_row -> 'name', 'category', new_row -> 'category',
            'price', new_row -> 'price', 'stock', new_row -> 'stock',
            'is_published', new_row -> 'is_published'
          )
        );
      end if;
    end if;
  elsif tg_table_name = 'orders' and tg_op = 'UPDATE' then
    old_row := to_jsonb(old);
    new_row := to_jsonb(new);
    if old_row -> 'status' is distinct from new_row -> 'status'
       or old_row -> 'total_amount' is distinct from new_row -> 'total_amount'
       or old_row -> 'cancellation_reason' is distinct from new_row -> 'cancellation_reason'
       or old_row -> 'delivery_assignee_name' is distinct from new_row -> 'delivery_assignee_name'
       or old_row -> 'delivery_assignee_phone' is distinct from new_row -> 'delivery_assignee_phone'
       or old_row -> 'delivery_document_path' is distinct from new_row -> 'delivery_document_path' then
      event_action := 'order.updated';
      event_id := new.id::text;
      event_details := jsonb_build_object(
        'before', jsonb_build_object(
          'status', old_row -> 'status', 'total_amount', old_row -> 'total_amount'
        ),
        'after', jsonb_build_object(
          'status', new_row -> 'status', 'total_amount', new_row -> 'total_amount'
        ),
        'delivery_assignment_changed',
          old_row -> 'delivery_assignee_name' is distinct from new_row -> 'delivery_assignee_name'
          or old_row -> 'delivery_assignee_phone' is distinct from new_row -> 'delivery_assignee_phone',
        'delivery_document_changed',
          old_row -> 'delivery_document_path' is distinct from new_row -> 'delivery_document_path'
      );
    end if;
  end if;

  if event_action is not null then
    insert into public.admin_audit_log (actor_id, action, entity, entity_id, details)
    values (auth.uid(), event_action, tg_table_name, event_id, event_details);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.capture_admin_audit_event() from public, anon, authenticated;

drop trigger if exists audit_admin_product_changes on public.products;
create trigger audit_admin_product_changes
  after insert or update or delete on public.products
  for each row execute function public.capture_admin_audit_event();

drop trigger if exists audit_admin_order_changes on public.orders;
create trigger audit_admin_order_changes
  after update on public.orders
  for each row execute function public.capture_admin_audit_event();

create or replace function public.admin_dashboard_summary()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'SUPER_ADMIN' then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;

  return jsonb_build_object(
    'revenue_30d', coalesce((
      select sum(total_amount)
      from public.orders
      where created_at >= now() - interval '30 days'
        and lower(coalesce(status, '')) in ('completed', 'delivered', 'delivered & paid', 'picked', 'picked & paid')
    ), 0),
    'pending_orders_30d', (
      select count(*)
      from public.orders
      where created_at >= now() - interval '30 days'
        and lower(coalesce(status, '')) = 'pending'
    ),
    'confirmed_orders_30d', (
      select count(*)
      from public.orders
      where created_at >= now() - interval '30 days'
        and lower(coalesce(status, '')) in ('confirmed', 'processing')
    ),
    'low_stock_products', (
      select count(*) from public.products where coalesce(stock, 0) between 1 and 10
    ),
    'out_of_stock_products', (
      select count(*) from public.products where coalesce(stock, 0) <= 0
    ),
    'unread_customer_messages', (
      select count(*) from public.messages where sender_role = 'customer' and is_read = false
    )
  );
end;
$$;

revoke all on function public.admin_dashboard_summary() from public, anon;
grant execute on function public.admin_dashboard_summary() to authenticated;

comment on column public.products.is_published is
  'Whether this product is visible in the customer storefront; admin views retain unpublished products.';
comment on column public.orders.delivery_document_path is
  'Object path in the private wen-delivery-documents bucket; never store a public or signed URL.';
