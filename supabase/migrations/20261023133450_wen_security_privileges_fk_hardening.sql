-- TRUNCATE bypasses row-level security. Browser roles must never receive it.
-- REFERENCES, TRIGGER, and MAINTAIN are also not needed by browser clients.
revoke truncate, references, trigger, maintain
  on all tables in schema public
  from anon, authenticated;

-- Orders are private and are accessed through the protected order flows.
-- Keep authenticated admin access subject to the existing RLS policies.
revoke all on table public.orders, public.order_items from anon;
grant select, update on table public.orders to authenticated;
grant select on table public.order_items to authenticated;

-- No client-facing flow deletes messages; keep message changes insert/read-only.
revoke delete on table public.messages from authenticated;

-- Cover foreign-key lookups and parent-row delete/update checks.
create index if not exists admin_audit_log_actor_id_idx
  on public.admin_audit_log (actor_id);

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

create index if not exists order_items_product_id_idx
  on public.order_items (product_id);
