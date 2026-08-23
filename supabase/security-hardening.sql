-- WenAppliances authentication and API hardening.
-- Apply this migration to the production Supabase project.
-- Authorization is based only on app_metadata.role, never user_metadata.

-- Trigger-only helper functions must not be callable through the public API.
-- They remain available to their database triggers.
revoke execute on function public.handle_new_member() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Order cancellation performs an atomic stock restoration. It does not need
-- elevated privileges: the caller is protected by RLS, while the Edge
-- Function uses service_role for customer cancellations.
alter function public.cancel_order_atomic(uuid, text, text) security invoker;
revoke execute on function public.cancel_order_atomic(uuid, text, text) from public, anon;
grant execute on function public.cancel_order_atomic(uuid, text, text) to authenticated, service_role;

-- Keep the server-only checkout transaction inaccessible to browser roles.
revoke execute on function public.create_order_atomic(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_order_atomic(jsonb, jsonb) to service_role;

-- Defense in depth: customer sessions have no direct write privileges for
-- catalog, orders, order items, or member records.
revoke insert, update, delete on table public.products from anon, authenticated;
revoke insert, update, delete on table public.orders, public.order_items from anon, authenticated;
revoke insert, update, delete on table public.members from anon, authenticated;

-- Re-assert the only intended browser write: a SUPER_ADMIN can manage the
-- catalog and images through the existing RLS policies.
grant insert, update, delete on table public.products to authenticated;
