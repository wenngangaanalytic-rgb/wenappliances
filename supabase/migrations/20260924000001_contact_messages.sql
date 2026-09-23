-- Customer support submissions. Public users may insert only; only trusted
-- administrators can read the queue.
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  email text not null check (char_length(btrim(email)) between 3 and 320),
  message text not null check (char_length(btrim(message)) between 1 and 5000),
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;

drop policy if exists "Anyone can submit contact messages" on public.contact_messages;
create policy "Anyone can submit contact messages"
  on public.contact_messages
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Admins can read contact messages" on public.contact_messages;
create policy "Admins can read contact messages"
  on public.contact_messages
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN');

revoke all on public.contact_messages from anon, authenticated;
grant insert on public.contact_messages to anon, authenticated;
grant select on public.contact_messages to authenticated;
