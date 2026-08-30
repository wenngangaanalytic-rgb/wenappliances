-- Keep one policy per action so Supabase's linter and Postgres do not need to
-- evaluate multiple permissive policies for every chat row.

drop policy if exists "Customers can read their own product chats" on public.messages;
drop policy if exists "Super admins can read all product chats" on public.messages;
drop policy if exists "Customers and admins can read product chats" on public.messages;
create policy "Customers and admins can read product chats"
  on public.messages
  for select
  to authenticated
  using (
    (select auth.uid()) = owner_id
    or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
  );

drop policy if exists "Anonymous customers can start product chats" on public.messages;
drop policy if exists "Super admins can reply to product chats" on public.messages;
drop policy if exists "Customers and admins can create product chat messages" on public.messages;
create policy "Customers and admins can create product chat messages"
  on public.messages
  for insert
  to authenticated
  with check (
    (
      (select auth.uid()) = owner_id
      and (select auth.jwt() ->> 'is_anonymous') = 'true'
      and sender_role = 'customer'
      and is_read = false
    )
    or (
      (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
      and sender_role = 'admin'
      and is_read = false
    )
  );

drop policy if exists "Customers can mark admin messages read" on public.messages;
drop policy if exists "Super admins can mark product chats read" on public.messages;
drop policy if exists "Customers and admins can mark product chats read" on public.messages;
create policy "Customers and admins can mark product chats read"
  on public.messages
  for update
  to authenticated
  using (
    (
      (select auth.uid()) = owner_id
      and sender_role = 'admin'
    )
    or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
  )
  with check (
    (
      (select auth.uid()) = owner_id
      and sender_role = 'admin'
      and is_read = true
    )
    or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
  );
