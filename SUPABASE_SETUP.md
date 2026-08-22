# WenAppliances Supabase setup

1. Confirm the `products` table exists and includes the fields used by the app:
   `id`, `name`, `sku`, `category`, `price`, `cost`, `stock`, `status`,
   `description`, `image`, and `gallery`.
2. Run [`supabase/products-rls.sql`](./supabase/products-rls.sql) in the Supabase SQL Editor.
3. Create the administrator in Supabase Authentication and assign this managed app metadata:

   ```json
   { "role": "SUPER_ADMIN", "name": "System Administrator" }
   ```

4. Keep the frontend on the publishable key only. Never put a service-role key in `.env` or browser code.
5. Restart Vite after changing `.env` with `npm run dev`.

The storefront reads the live catalog. Checkout currently keeps stock changes local until a server-side order/payment transaction is added; anonymous browser code is intentionally not allowed to update shared inventory.
