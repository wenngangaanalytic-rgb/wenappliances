-- Native push notification identity and product-chat routing.
--
-- The existing public.members table is the application's profile table. Keep
-- device tokens there so the server can route FCM notifications without
-- exposing auth.users or a service-role key to the client.

alter table public.members
  add column if not exists fcm_token text,
  add column if not exists role text not null default 'customer';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.members'::regclass
      and conname = 'members_role_check'
  ) then
    alter table public.members
      add constraint members_role_check check (role in ('customer', 'admin'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.members'::regclass
      and conname = 'members_fcm_token_length_check'
  ) then
    alter table public.members
      add constraint members_fcm_token_length_check
      check (fcm_token is null or char_length(btrim(fcm_token)) between 1 and 4096);
  end if;
end;
$$;

-- Backfill trusted administrator roles from app_metadata. Never use
-- raw_user_meta_data for authorization or role assignment.
update public.members as member
set role = 'admin'
from auth.users as auth_user
where auth_user.id = member.id
  and upper(coalesce(auth_user.raw_app_meta_data ->> 'role', '')) = 'SUPER_ADMIN';

create index if not exists members_fcm_token_role_idx
  on public.members (role)
  where fcm_token is not null;

-- Registered customers need an explicit identity in the chat row so an admin
-- reply can be routed back to that customer's device. Anonymous chat remains
-- supported with customer_id null.
alter table public.messages
  add column if not exists chat_id text,
  add column if not exists sender_id uuid,
  add column if not exists customer_id uuid;

update public.messages
set chat_id = concat(session_id, '::', product_id)
where chat_id is null or btrim(chat_id) = '';

update public.messages
set sender_id = owner_id
where sender_id is null;

-- Keep older deployed storefront bundles compatible during the rollout. The
-- trigger fills the new routing fields when an older client omits them.
create or replace function public.populate_product_chat_routing()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.chat_id := coalesce(nullif(btrim(new.chat_id), ''), concat(new.session_id, '::', new.product_id));
  new.sender_id := coalesce(new.sender_id, (select auth.uid()), new.owner_id);
  return new;
end;
$$;

revoke execute on function public.populate_product_chat_routing() from public, anon, authenticated;

drop trigger if exists populate_product_chat_routing on public.messages;
create trigger populate_product_chat_routing
  before insert on public.messages
  for each row execute function public.populate_product_chat_routing();

alter table public.messages
  alter column chat_id set not null,
  alter column sender_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_chat_id_length_check'
  ) then
    alter table public.messages
      add constraint messages_chat_id_length_check
      check (char_length(btrim(chat_id)) between 1 and 350);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_customer_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_customer_id_fkey
      foreign key (customer_id) references auth.users(id) on delete set null;
  end if;
end;
$$;

create index if not exists messages_customer_chat_created_idx
  on public.messages (customer_id, chat_id, created_at);

create index if not exists messages_sender_created_idx
  on public.messages (sender_id, created_at);

-- Keep the single-policy model while permitting signed-in customers to use
-- the same protected chat table. Anonymous chat is still restricted to the
-- anonymous Auth identity created by chatSession.js.
drop policy if exists "Customers and admins can create product chat messages" on public.messages;
create policy "Customers and admins can create product chat messages"
  on public.messages
  for insert
  to authenticated
  with check (
    (
      (select auth.uid()) = owner_id
      and (select auth.uid()) = sender_id
      and sender_role = 'customer'
      and is_read = false
      and (customer_id is null or customer_id = (select auth.uid()))
      and (
        (select auth.jwt() ->> 'is_anonymous') = 'true'
        or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'SUPER_ADMIN'
      )
    )
    or (
      (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
      and (select auth.uid()) = sender_id
      and sender_role = 'admin'
      and is_read = false
    )
  );

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
     or new.owner_id is distinct from old.owner_id
     or new.chat_id is distinct from old.chat_id
     or new.sender_id is distinct from old.sender_id
     or new.customer_id is distinct from old.customer_id then
    raise exception using errcode = '42501', message = 'Only the message read state may be changed.';
  end if;

  return new;
end;
$$;

-- Keep members readable only by the owner or a trusted administrator, and
-- permit clients to update only the fcm_token column on their own row.
drop policy if exists "Super admins can view members" on public.members;
drop policy if exists "Users can view their own notification profile" on public.members;
drop policy if exists "Users can update their own FCM token" on public.members;

create policy "Users can view permitted member profiles"
  on public.members
  for select
  to authenticated
  using (
    (select auth.jwt() ->> 'is_anonymous') is distinct from 'true'
    and (
      (select auth.uid()) = id
      or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'SUPER_ADMIN'
    )
  );

revoke insert, update, delete on table public.members from anon, authenticated;
grant select on table public.members to authenticated;
grant update (fcm_token) on table public.members to authenticated;

create policy "Users can update their own FCM token"
  on public.members
  for update
  to authenticated
  using (
    (select auth.jwt() ->> 'is_anonymous') is distinct from 'true'
    and (select auth.uid()) = id
  )
  with check (
    (select auth.jwt() ->> 'is_anonymous') is distinct from 'true'
    and (select auth.uid()) = id
  );

-- Keep future member rows aligned with trusted Auth app_metadata. Existing
-- rows are backfilled above, and the role column remains non-writable to
-- browser clients.
create or replace function public.handle_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_role text := case
    when upper(coalesce(new.raw_app_meta_data ->> 'role', '')) = 'SUPER_ADMIN' then 'admin'
    else 'customer'
  end;
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  insert into public.members (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data ->> 'name', member_role)
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.members.full_name),
        role = excluded.role;
  return new;
end;
$$;

revoke execute on function public.handle_new_member() from public, anon, authenticated;
