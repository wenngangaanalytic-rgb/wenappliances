-- WenAppliances order, member, and authorization setup.
-- Run this script in the Supabase SQL Editor.
-- The frontend uses only the publishable/anon key; admin decisions use app_metadata.role.

-- Orders: the create-order Edge Function is the only customer write path.
-- It validates live prices/stock and calls create_order_atomic with the
-- server-side service role. Customers must not insert trusted order data
-- directly from the browser.
alter table public.orders add column if not exists delivery_address text;
alter table public.orders add column if not exists customer_phone text;
alter table public.orders add column if not exists fulfillment_method text not null default 'DELIVERY';
alter table public.orders add column if not exists cancellation_reason text;
alter table public.orders drop constraint if exists orders_fulfillment_method_check;
alter table public.orders
  add constraint orders_fulfillment_method_check
  check (fulfillment_method in ('DELIVERY', 'DOOR_PICKUP'));
create index if not exists orders_customer_email_created_at_idx
  on public.orders (customer_email, created_at desc);
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Let the admin order indicator and order list receive immediate changes.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'orders'
     ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;

-- Keep completed purchase history when an admin removes a catalog product.
-- Order items store a snapshot of the product name/images and the live
-- product relationship becomes nullable with ON DELETE SET NULL.
alter table public.order_items add column if not exists product_name text;
alter table public.order_items add column if not exists product_images text[];
alter table public.order_items alter column product_id drop not null;
alter table public.order_items drop constraint if exists order_items_product_id_fkey;
alter table public.order_items
  add constraint order_items_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;

update public.order_items as item
set product_name = product.name,
    product_images = product.images
from public.products as product
where item.product_id = product.id
  and (item.product_name is null or item.product_images is null);

-- Remove legacy policies that granted broad access to any authenticated or
-- public role. Supabase combines policies permissively, so these must go.
drop policy if exists "Admins can manage orders" on public.orders;
drop policy if exists "Admins can update orders" on public.orders;
drop policy if exists "Public can create orders" on public.orders;
drop policy if exists "Customers can create orders" on public.orders;
drop policy if exists "Admins can view order items" on public.order_items;
drop policy if exists "Public can insert order items" on public.order_items;
drop policy if exists "Customers can create order items" on public.order_items;

revoke insert on table public.orders, public.order_items from anon, authenticated;
grant select, update on table public.orders to authenticated;
grant select on table public.order_items to authenticated;

drop policy if exists "Super admins can view orders" on public.orders;
create policy "Super admins can view orders"
  on public.orders
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

drop policy if exists "Super admins can update orders" on public.orders;
create policy "Super admins can update orders"
  on public.orders
  for update
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

drop policy if exists "Super admins can view order items" on public.order_items;
create policy "Super admins can view order items"
  on public.order_items
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

-- Atomic order creation used only by the server-side Edge Function.
create or replace function public.create_order_atomic(
  order_payload jsonb,
  items_payload jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  new_order_id uuid := gen_random_uuid();
  customer_name_value text := trim(coalesce(order_payload ->> 'customer_name', ''));
  customer_email_value text := lower(trim(coalesce(order_payload ->> 'customer_email', '')));
  customer_phone_value text := trim(coalesce(order_payload ->> 'customer_phone', ''));
  delivery_address_value text := trim(coalesce(order_payload ->> 'delivery_address', ''));
  fulfillment_method_value text := upper(trim(coalesce(order_payload ->> 'fulfillment_method', '')));
  payment_method_value text := trim(coalesce(order_payload ->> 'payment_method', ''));
  item_record record;
  product_record record;
  order_total numeric := 0;
begin
  if customer_name_value = '' or length(customer_name_value) > 120 then
    raise exception using errcode = 'P0001', message = 'Please provide a valid customer name.';
  end if;

  if position('@' in customer_email_value) < 2 or length(customer_email_value) > 254 then
    raise exception using errcode = 'P0001', message = 'Please provide a valid customer email.';
  end if;

  if customer_phone_value = '' or length(customer_phone_value) > 40 then
    raise exception using errcode = 'P0001', message = 'Please provide a valid phone number.';
  end if;

  if fulfillment_method_value not in ('DELIVERY', 'DOOR_PICKUP') then
    raise exception using errcode = 'P0001', message = 'Please choose delivery or door pickup.';
  end if;

  if fulfillment_method_value = 'DOOR_PICKUP' then
    delivery_address_value := 'Door pickup - contact WenAppliances support to arrange.';
  elsif delivery_address_value = '' or length(delivery_address_value) > 500 then
    raise exception using errcode = 'P0001', message = 'Please provide a valid delivery address.';
  end if;

  if payment_method_value not in ('Credit / Debit Card (Stripe)', 'Venmo', 'Cash App', 'Cash on Delivery') then
    raise exception using errcode = 'P0001', message = 'The selected payment method is not supported.';
  end if;

  if jsonb_typeof(items_payload) <> 'array' or jsonb_array_length(items_payload) = 0 then
    raise exception using errcode = 'P0001', message = 'Your cart is empty.';
  end if;

  if jsonb_array_length(items_payload) > 50 then
    raise exception using errcode = 'P0001', message = 'Your cart contains too many different products.';
  end if;

  insert into public.orders (
    id, customer_name, customer_email, customer_phone,
    delivery_address, fulfillment_method, total_amount, payment_method, status
  ) values (
    new_order_id, customer_name_value, customer_email_value, customer_phone_value,
    delivery_address_value, fulfillment_method_value, 0, payment_method_value, 'Pending'
  );

  for item_record in
    select product_id, quantity
    from jsonb_to_recordset(items_payload) as item(product_id text, quantity integer)
  loop
    if item_record.product_id is null or item_record.quantity is null
       or item_record.quantity < 1 or item_record.quantity > 100 then
      raise exception using errcode = 'P0001', message = 'One or more cart quantities are invalid.';
    end if;

    select id, name, images, price, stock
    into product_record
    from public.products
    where id::text = item_record.product_id
    for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'One of the products in your cart is no longer available.';
    end if;

    if coalesce(product_record.stock, 0) < item_record.quantity then
      raise exception using errcode = 'P0001', message = 'There is not enough stock for one of the products in your cart.';
    end if;

    order_total := order_total + (product_record.price * item_record.quantity);

    insert into public.order_items (order_id, product_id, product_name, product_images, quantity, price_at_time)
    values (new_order_id, product_record.id, product_record.name, product_record.images, item_record.quantity, product_record.price);

    update public.products
    set stock = stock - item_record.quantity
    where id = product_record.id;
  end loop;

  update public.orders
  set total_amount = order_total
  where id = new_order_id;

  return jsonb_build_object('orderId', new_order_id, 'totalAmount', order_total);
exception
  when others then
    raise;
end;
$$;

revoke all on function public.create_order_atomic(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_order_atomic(jsonb, jsonb) to service_role;

-- Cancel an order and restore its reserved stock in the same transaction.
-- Customers may only cancel their own pending order. SUPER_ADMIN may cancel
-- pending or confirmed orders, but confirmed cancellations require a reason.
create or replace function public.cancel_order_atomic(
  p_order_id uuid,
  p_customer_email text default null,
  p_cancellation_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_record public.orders%rowtype;
  item_record record;
  request_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  request_role text := current_setting('request.jwt.claim.role', true);
  is_super_admin boolean := coalesce(request_claims -> 'app_metadata' ->> 'role', '') = 'SUPER_ADMIN';
  is_service_role boolean := request_role = 'service_role';
  reason_value text := nullif(trim(coalesce(p_cancellation_reason, '')), '');
begin
  if not is_super_admin and not is_service_role then
    raise exception using errcode = '42501', message = 'Only a SUPER_ADMIN or trusted order service may cancel orders.';
  end if;

  select * into order_record
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'That order could not be found.';
  end if;

  if p_customer_email is not null
     and lower(order_record.customer_email) <> lower(trim(p_customer_email)) then
    raise exception using errcode = 'P0001', message = 'That order could not be found for this email.';
  end if;

  -- Idempotency guard: a repeated request must never restore stock twice.
  if lower(coalesce(order_record.status, '')) = 'cancelled' then
    return jsonb_build_object(
      'orderId', order_record.id,
      'status', 'Cancelled',
      'cancellationReason', coalesce(order_record.cancellation_reason, '')
    );
  end if;

  if is_service_role then
    if p_customer_email is null or trim(p_customer_email) = '' then
      raise exception using errcode = '42501', message = 'A customer email is required for customer cancellation.';
    end if;

    if lower(coalesce(order_record.status, '')) <> 'pending' then
      raise exception using errcode = 'P0001', message = 'This order can no longer be cancelled because it is already being processed.';
    end if;

    reason_value := coalesce(reason_value, 'Cancelled by customer before confirmation.');
  elsif lower(coalesce(order_record.status, '')) <> 'pending' and reason_value is null then
    raise exception using errcode = 'P0001', message = 'A cancellation reason is required for a confirmed order.';
  else
    reason_value := coalesce(reason_value, 'Cancelled by administrator before confirmation.');
  end if;

  for item_record in
    select product_id, quantity
    from public.order_items
    where order_id = order_record.id
  loop
    -- A deleted catalog product has no live stock row to restore.
    if item_record.product_id is not null then
      update public.products
      set stock = coalesce(stock, 0) + item_record.quantity
      where id = item_record.product_id;
    end if;
  end loop;

  update public.orders
  set status = 'Cancelled', cancellation_reason = reason_value
  where id = order_record.id;

  return jsonb_build_object(
    'orderId', order_record.id,
    'status', 'Cancelled',
    'cancellationReason', reason_value
  );
end;
$$;

revoke all on function public.cancel_order_atomic(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cancel_order_atomic(uuid, text, text) to authenticated, service_role;

-- Members: created automatically whenever a Supabase Auth account is created.
create table if not exists public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;
revoke all on table public.members from anon;
grant select on table public.members to authenticated;

drop policy if exists "Super admins can view members" on public.members;
create policy "Super admins can view members"
  on public.members
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

create or replace function public.handle_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.members (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'name')
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.members.full_name);
  return new;
end;
$$;

revoke all on function public.handle_new_member() from public;

drop trigger if exists on_auth_user_created_member on auth.users;
create trigger on_auth_user_created_member
  after insert on auth.users
  for each row execute function public.handle_new_member();

drop trigger if exists on_auth_user_updated_member on auth.users;
create trigger on_auth_user_updated_member
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_member();

-- Backfill accounts that existed before this trigger was installed.
insert into public.members (id, email, full_name)
select id, email, raw_user_meta_data ->> 'name'
from auth.users
on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(excluded.full_name, public.members.full_name);
