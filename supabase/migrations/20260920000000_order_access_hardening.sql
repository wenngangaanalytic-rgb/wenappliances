-- Secure guest order access, duplicate-request protection, and order RLS.
-- Guest tracking uses a one-time opaque token. Authenticated members may
-- still view their own orders through their Supabase Auth email.

alter table public.orders
  add column if not exists tracking_token_hash text,
  add column if not exists idempotency_key uuid;

create unique index if not exists orders_tracking_token_hash_uidx
  on public.orders (tracking_token_hash)
  where tracking_token_hash is not null;

create unique index if not exists orders_idempotency_key_uidx
  on public.orders (idempotency_key)
  where idempotency_key is not null;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke insert on table public.orders, public.order_items from anon, authenticated;
revoke update, delete on table public.orders, public.order_items from anon;
grant select, update on table public.orders to authenticated;
grant select on table public.order_items to authenticated;

drop policy if exists "Admins can manage orders" on public.orders;
drop policy if exists "Admins can update orders" on public.orders;
drop policy if exists "Public can create orders" on public.orders;
drop policy if exists "Customers can create orders" on public.orders;
drop policy if exists "Super admins can view orders" on public.orders;
drop policy if exists "Super admins can update orders" on public.orders;
drop policy if exists "Admins can view order items" on public.order_items;
drop policy if exists "Public can insert order items" on public.order_items;
drop policy if exists "Customers can create order items" on public.order_items;
drop policy if exists "Super admins can view order items" on public.order_items;

create policy "Super admins can view orders"
  on public.orders
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

create policy "Super admins can update orders"
  on public.orders
  for update
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

create policy "Super admins can view order items"
  on public.order_items
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

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
  tracking_token_hash_value text := nullif(trim(coalesce(order_payload ->> 'tracking_token_hash', '')), '');
  idempotency_key_value uuid := nullif(trim(coalesce(order_payload ->> 'idempotency_key', '')), '')::uuid;
  existing_order public.orders%rowtype;
  item_record record;
  product_record record;
  order_total numeric := 0;
begin
  if tracking_token_hash_value is null or tracking_token_hash_value !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'A secure tracking token is required.';
  end if;

  if idempotency_key_value is not null then
    select * into existing_order
    from public.orders
    where idempotency_key = idempotency_key_value
    for update;

    if found then
      return jsonb_build_object(
        'orderId', existing_order.id,
        'totalAmount', coalesce(existing_order.total_amount, 0)
      );
    end if;
  end if;

  if customer_name_value = '' or length(customer_name_value) > 120 then
    raise exception using errcode = 'P0001', message = 'Please provide a valid customer name.';
  end if;

  if position('@' in customer_email_value) < 2 or length(customer_email_value) > 254 then
    raise exception using errcode = 'P0001', message = 'Please provide a valid customer email.';
  end if;

  if customer_phone_value !~ '^[0-9+().[:space:]-]{7,40}$' then
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
    delivery_address, fulfillment_method, total_amount, payment_method,
    status, tracking_token_hash, idempotency_key
  ) values (
    new_order_id, customer_name_value, customer_email_value, customer_phone_value,
    delivery_address_value, fulfillment_method_value, 0, payment_method_value,
    'Pending', tracking_token_hash_value, idempotency_key_value
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
end;
$$;

revoke all on function public.create_order_atomic(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_order_atomic(jsonb, jsonb) to service_role;

alter function public.cancel_order_atomic(uuid, text, text) security invoker;
revoke execute on function public.cancel_order_atomic(uuid, text, text) from public, anon;
grant execute on function public.cancel_order_atomic(uuid, text, text) to authenticated, service_role;

-- Small, server-only sliding-window limiter for public Edge Function routes.
create table if not exists public.api_rate_limits (
  key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0)
);

revoke all on table public.api_rate_limits from public, anon, authenticated;

create or replace function public.consume_api_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rate_record public.api_rate_limits%rowtype;
begin
  if p_key is null or length(trim(p_key)) = 0
     or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  select * into rate_record
  from public.api_rate_limits
  where key = p_key
  for update;

  if not found then
    insert into public.api_rate_limits (key, window_started_at, request_count)
    values (p_key, now(), 1);
    return true;
  end if;

  if now() >= rate_record.window_started_at + make_interval(secs => p_window_seconds) then
    update public.api_rate_limits
    set window_started_at = now(), request_count = 1
    where key = p_key;
    return true;
  end if;

  if rate_record.request_count >= p_limit then
    return false;
  end if;

  update public.api_rate_limits
  set request_count = request_count + 1
  where key = p_key;
  return true;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;
