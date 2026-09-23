-- Newsletter signups. Public users may submit an address; only trusted
-- administrators can read the subscriber list.
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (char_length(btrim(email)) between 3 and 320),
  subscribed_at timestamptz not null default now()
);

alter table public.newsletter_subscribers enable row level security;

drop policy if exists "Anyone can subscribe" on public.newsletter_subscribers;
create policy "Anyone can subscribe"
  on public.newsletter_subscribers
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Admins can read subscribers" on public.newsletter_subscribers;
create policy "Admins can read subscribers"
  on public.newsletter_subscribers
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

revoke all on public.newsletter_subscribers from anon, authenticated;
grant insert on public.newsletter_subscribers to anon, authenticated;
grant select on public.newsletter_subscribers to authenticated;
