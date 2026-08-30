-- Product-specific customer support chat for WenAppliances.
--
-- Anonymous chat uses a separate Supabase anonymous Auth session. The local
-- chat_session_id is still stored and queried for browser/thread continuity,
-- while owner_id is the trusted RLS boundary that prevents one visitor from
-- reading another visitor's conversation.

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sender_role text not null check (sender_role in ('customer', 'admin')),
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  session_id text not null check (char_length(btrim(session_id)) between 1 and 120),
  product_id text not null check (char_length(btrim(product_id)) between 1 and 200),
  product_name text not null check (char_length(btrim(product_name)) between 1 and 200),
  is_read boolean not null default false,
  owner_id uuid not null references auth.users(id) on delete cascade
);

create index if not exists messages_owner_product_created_idx
  on public.messages (owner_id, product_id, created_at);

create index if not exists messages_session_product_created_idx
  on public.messages (session_id, product_id, created_at);

create index if not exists messages_unread_customer_idx
  on public.messages (owner_id, product_id, is_read)
  where sender_role = 'customer' and is_read = false;

alter table public.messages enable row level security;

-- The table is accessed through the Data API by authenticated anonymous chat
-- users and authenticated SUPER_ADMIN users only. There is no direct anon
-- access: the widget creates an anonymous Auth identity first.
revoke all on table public.messages from anon;
grant select, insert, update on table public.messages to authenticated;

drop policy if exists "Customers can read their own product chats" on public.messages;
drop policy if exists "Super admins can read all product chats" on public.messages;
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

-- Chat messages are append-only apart from the read flag. This prevents a
-- browser client from rewriting product, sender, owner, or message content.
create or replace function public.guard_product_chat_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.sender_role is distinct from old.sender_role
     or new.content is distinct from old.content
     or new.session_id is distinct from old.session_id
     or new.product_id is distinct from old.product_id
     or new.product_name is distinct from old.product_name
     or new.owner_id is distinct from old.owner_id then
    raise exception using errcode = '42501', message = 'Only the message read state may be changed.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_product_chat_update() from public, anon, authenticated;

drop trigger if exists guard_product_chat_update on public.messages;
create trigger guard_product_chat_update
  before update on public.messages
  for each row execute function public.guard_product_chat_update();

-- Anonymous chat identities must not appear in the customer Members list.
-- The function already exists in the WenAppliances security setup; replacing
-- it here keeps the member trigger compatible with the chat identity.
create or replace function public.handle_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  insert into public.members (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'name')
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.members.full_name);
  return new;
end;
$$;

revoke execute on function public.handle_new_member() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end;
$$;
