# Push notification setup

The application code is ready for native Android push notifications, but the
credentials below must be supplied outside the repository.

## 1. Rotate the Firebase service account

The service-account key that was previously pasted into chat must be revoked in
Firebase/Google Cloud. Create a replacement key and keep it only in a secure
server-side secret store. Do not commit it, put it in a `VITE_` variable, or
paste it into source files.

## 2. Configure the Android Firebase app

Create an Android app in the `wenappliances-chats` Firebase project with the
package name `com.wenappliances.admin`. Download its `google-services.json` to:

`android/app/google-services.json`

That file is intentionally ignored by Git. Rebuild the release APK after it is
present.

## 3. Configure Vercel production secrets

Add these server-only production variables to the Vercel project hosting the
storefront:

- `SUPABASE_URL`: the production Supabase URL
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase server-only service-role key
- `FIREBASE_SERVICE_ACCOUNT`: the replacement Firebase service-account JSON
- `NOTIFICATION_WEBHOOK_SECRET`: a long random value shared only with the webhook

The endpoint also accepts the older `MESSAGE_WEBHOOK_SECRET` name during the
transition. Keep the Firebase and Supabase values as Vercel **Production
secrets**, never as `VITE_` variables.

Never expose any of these through a `VITE_` variable or the browser bundle.

## 4. Configure the Supabase Database Webhooks

Create webhooks for these events and send each one as a `POST` to:

`https://wenappliances.vercel.app/api/send-notification`

- `public.messages` — `INSERT`
- `public.orders` — `INSERT`
- `public.orders` — `UPDATE`

Add this request header, using the same value as the Vercel secret:

`x-webhook-secret: <NOTIFICATION_WEBHOOK_SECRET>`

The endpoint routes customer messages to all registered admins, admin replies to
the registered customer for that product chat, new pending orders to admins,
customer cancellations to admins, and confirmed/completed/cancelled order
updates to the registered customer. Invalid FCM tokens are cleared
automatically. See [`supabase/fcm-webhooks.md`](supabase/fcm-webhooks.md) for
the exact production checklist and guest-checkout limitation.

## 5. Install and test

Install the rebuilt release APK, sign in, accept the Android notification
permission, and send a message from the other side. Background delivery while
the app is minimized or killed requires the Firebase file and the three server
secrets above to be configured first.
