-- Keep the shared notification webhook credential in Supabase Vault rather
-- than in trigger arguments, which are visible in database metadata and dumps.
-- Seed vault secret `notification_webhook_secret` before applying this change.

create or replace function public.dispatch_notification_webhook()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, net, vault, supabase_functions
as $$
declare
  webhook_secret text;
  request_id bigint;
  old_record jsonb;
  payload jsonb;
begin
  if tg_table_schema <> 'public' or tg_table_name not in ('messages', 'orders') then
    raise exception 'Unsupported notification webhook source.';
  end if;

  select decrypted_secret
    into webhook_secret
    from vault.decrypted_secrets
   where name = 'notification_webhook_secret'
   limit 1;

  if webhook_secret is null or char_length(webhook_secret) < 32 then
    raise exception 'Notification webhook secret is not configured in Vault.';
  end if;

  if tg_op = 'INSERT' then
    old_record := null;
  else
    old_record := to_jsonb(old);
  end if;

  payload := jsonb_build_object(
    'old_record', old_record,
    'record', to_jsonb(new),
    'type', tg_op,
    'table', tg_table_name,
    'schema', tg_table_schema
  );

  select net.http_post(
    'https://wenappliances.vercel.app/api/send-notification',
    payload,
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    1000
  ) into request_id;

  if request_id is not null then
    insert into supabase_functions.hooks (hook_table_id, hook_name, request_id)
    values (tg_relid, tg_name, request_id);
  end if;

  return new;
end;
$$;

revoke all on function public.dispatch_notification_webhook()
  from public, anon, authenticated, service_role;

drop trigger if exists "send-message-notifications" on public.messages;
create trigger "send-message-notifications"
  after insert on public.messages
  for each row execute function public.dispatch_notification_webhook();

drop trigger if exists "send-order-notifications-insert" on public.orders;
create trigger "send-order-notifications-insert"
  after insert on public.orders
  for each row execute function public.dispatch_notification_webhook();

drop trigger if exists "send-order-notifications-update" on public.orders;
create trigger "send-order-notifications-update"
  after update on public.orders
  for each row execute function public.dispatch_notification_webhook();
