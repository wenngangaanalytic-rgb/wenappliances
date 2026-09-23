# FCM notification wiring

The Vercel endpoint at `https://wenappliances.vercel.app/api/send-notification` now routes push notifications for both chat and order events. It does not contain Firebase credentials; all credentials remain server-side environment variables.

## Required production configuration

Before testing background delivery, apply the push-notification migration in the production Supabase project:

`supabase/migrations/20260920010000_push_notifications.sql`

The migration adds `members.fcm_token` and `members.role`, adds the chat routing fields, and limits browser clients to updating only their own FCM token. Do not mark this as complete until it has been applied to the remote database.

The Vercel project serving `wenappliances.vercel.app` needs these Production environment variables:

- `FIREBASE_SERVICE_ACCOUNT` — the complete Firebase service-account JSON as one secret value. Do not commit it or put it in a client-side `VITE_*` variable.
- `SUPABASE_URL` — the project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — the server-only Supabase service-role key. `SUPABASE_SECRET_KEY` is accepted as a legacy fallback.
- `NOTIFICATION_WEBHOOK_SECRET` — recommended shared webhook secret. `MESSAGE_WEBHOOK_SECRET` is accepted as a legacy fallback.

After changing Vercel environment variables, redeploy the production project so the function receives the new values.

## Supabase Database Webhooks

In the production Supabase Dashboard, create three Database Webhooks with this URL:

`https://wenappliances.vercel.app/api/send-notification`

For each webhook, add the custom request header:

```text
x-webhook-secret: <the exact value stored in NOTIFICATION_WEBHOOK_SECRET>
```

Create these event subscriptions:

1. `public.messages` — `INSERT`
2. `public.orders` — `INSERT`
3. `public.orders` — `UPDATE`

The endpoint rejects requests without the header, so a webhook that omits it will return `401 Unauthorized`.

## Routing behavior

- A new customer message is sent to all registered admin devices.
- An admin reply is sent to the customer identified by `messages.customer_id`.
- A new pending order is sent to all registered admin devices.
- A customer cancellation is sent to all registered admin devices.
- A confirmed, completed, or cancelled order update is sent to the registered customer device matching `orders.customer_email`.

Tokens are registered after a signed-in user grants Android notification permission. A guest checkout cannot receive an order push with the current `members`-based identity model because there is no authenticated member device to target; the order remains available through the normal tracking flow.

## Safe verification

1. Sign in on the admin APK and allow notifications. Sign in on a customer device and allow notifications.
2. Confirm each device has a non-null `members.fcm_token` in the production database. Never display or log the token publicly.
3. Put the receiving app in the background or swipe it away.
4. Send a chat message, create an order, and change the order status.
5. Verify the system notification tray, notification sound/vibration, and the notification action route.

If a token is rejected by FCM, the endpoint clears that invalid token so the next app launch can register a fresh one.
