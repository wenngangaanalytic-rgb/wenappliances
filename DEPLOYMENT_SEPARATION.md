# Separate WenAppliances deployments

The project now supports two independently buildable Vite applications from the same Git repository:

- Storefront: `npm run build:storefront` → `dist`
- Admin portal: `npm run build:admin` → `dist/admin`

Both applications use the same Supabase project and the browser-safe publishable/anon key. No service-role key belongs in either deployment.

## Local testing

Run one application at a time:

```bash
npm run dev:storefront
npm run dev:admin -- --port 5174
```

The admin portal opens at the admin app root and uses `/dashboard`, `/products`, `/orders`, and `/members` routes.

## Vercel projects

Create two Vercel projects from the same GitHub repository, with the Root Directory set to `/` for both projects.

### Customer storefront project

- Build Command: `npm run build:storefront`
- Output Directory: `dist`
- Environment Variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`

### Admin portal project

- Build Command: `npm run build:admin`
- Output Directory: `dist/admin`
- Environment Variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `VITE_STOREFRONT_URL` set to the deployed storefront URL

After both projects are deployed, assign the admin project a separate hostname such as `admin.wenappliances.com`. Only users whose trusted Supabase `app_metadata.role` is `SUPER_ADMIN` can pass the admin login check. Database and Storage RLS policies must remain enabled because separating the frontends is not a replacement for backend authorization.
