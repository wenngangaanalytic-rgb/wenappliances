# WenAppliances Supabase setup

1. Confirm the `products` table exists and includes the fields used by the app:
   `id`, `name`, `sku`, `category`, `price`, `cost`, `stock`, `status`,
   `description`, `image`, and `gallery`.
2. Apply every file in `supabase/migrations/` through the Supabase migration workflow. In particular, do not skip `20260920000000_order_access_hardening.sql`; it adds private guest tracking tokens, duplicate-order protection, and the order RLS boundary.
3. Run [`supabase/products-rls.sql`](./supabase/products-rls.sql) in the Supabase SQL Editor only when setting up an existing database that predates the migrations. The products policies must be present before the admin portal is used.
4. Create the administrator in Supabase Authentication and assign this managed app metadata:

   ```json
   { "role": "SUPER_ADMIN", "name": "System Administrator" }
   ```

5. Keep the frontend on the publishable key only. Never put a service-role key in `.env` or browser code.
6. Restart Vite after changing `.env` with `npm run dev`.

The storefront reads the live catalog. Checkout uses the server-side `create_order_atomic` transaction, which validates live prices and stock, stores only a hash of the guest tracking token, and accepts an idempotency key so retries cannot create duplicate orders. Anonymous browser code is intentionally not allowed to update shared inventory or query orders by email alone.
