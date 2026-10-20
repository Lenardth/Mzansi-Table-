# Activate booking notifications

The app and database changes are implemented locally. Live notifications require the migration, deployed worker, schedule, and native push credentials below. The publishable key cannot deploy a migration or Edge Function.

## Database

For a fresh database, run `node scripts/prepare-database.mjs` locally and execute `setup.sql` once in Supabase SQL Editor. If the base schema already exists, apply only pending files in `migrations/` in order, including `202610190003_existing_accounts.sql` to restore accounts created before setup. Existing bookings keep their status; notifications start with new requests and subsequent decisions. Apply migrations before launching the updated app.

The second migration separates client reservations from host requests through ownership checks, stores host feedback and timestamps, and creates private notifications and a server-only delivery queue. Rejection requires a reason. Approval checks capacity under a listing lock. Changes and notifications commit atomically. Clients can manage requests for their own events from My events; that does not grant access to other hosts' business requests.

## Deploy the worker

Install/authenticate the Supabase CLI using your own account:

```sh
npx supabase login
npx supabase link --project-ref owygwrazvoxmurceofaw
```

Generate a random dispatcher secret:

```sh
openssl rand -hex 32
```

Save that value as `NOTIFICATION_DISPATCH_SECRET` in **Supabase → Edge Functions → Secrets**. Also save it in **Database → Vault**, named `notification_dispatch_secret`. Do not put it in `.env.local`, an `EXPO_PUBLIC_` variable, source control, or chat.

Deploy:

```sh
npx supabase functions deploy dispatch-booking-notifications --project-ref owygwrazvoxmurceofaw
```

Run `schedule-notifications.sql` in SQL Editor to dispatch queued messages every minute. The function uses its built-in server service-role key; no service-role key is shipped in the app. It verifies the dispatcher secret before processing jobs. The schedule reads the secret from Vault. You can alternatively configure an authenticated external scheduler to POST to the function with an `x-dispatch-secret` header.

## Enable phone push

Expo Go and this web app cannot receive remote phone push alerts. Build the native app with EAS. The following steps require your Expo account and Apple/Google credentials.

```sh
npx eas-cli login
npx eas-cli init
```

EAS init writes your project ID to `app.json`. In your EAS project's **Environment variables**, add the same `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from `.env.local` to the **preview** environment (and **production** when releasing). The local ignored env file is not a substitute for EAS build environment variables.

```sh
npx eas-cli credentials --platform android
npx eas-cli build --profile preview --platform android
```

Configure FCM V1 credentials for Android. For iOS, configure APNs credentials and build with `--platform ios` instead. EAS will ask for app identifiers and signing credentials. Install the build on a physical phone, sign in, open **Profile → Enable push alerts**, and allow notification permission. Build both client and host use cases into the same app; the signed-in profile determines the portal.

If enhanced Expo Push Security is enabled for the EAS project, add `EXPO_ACCESS_TOKEN` to Supabase Edge Function secrets. The token stays on the server.

Phone registration is opt-in. Tokens are re-registered for the signed-in account on launch if previously enabled, removed on explicit disable/sign-out, and checked against the recipient before dispatch. Tapping a notification opens the private inbox. Foreground delivery refreshes it. Reinstalling requires enabling alerts again.

## Optional booking emails

Push and in-app notifications work independently of email configuration. To activate booking emails, add these Edge Function secrets:

- `RESEND_API_KEY`: your Resend API key.
- `BOOKING_EMAIL_FROM`: a verified sender, e.g. `Mzansi Table <bookings@your-domain.com>`.

Email recipients come from verified Supabase Auth accounts; a caller cannot supply an arbitrary recipient. No real email or push message is sent by the local test suite.

## Operations and delivery guarantees

In-app notifications persist immediately. The app refreshes every 15 seconds while active and on foreground/manual refresh; phone pushes additionally refresh the inbox when received. Scheduled external dispatch adds up to about a minute plus provider delay.

Queue jobs use leases and recover after a worker crash. Failures retry up to six attempts with backoff; inspect `notification_deliveries.last_error`, `receipt_status`, and function logs for failed jobs. Unconfigured email jobs wait without consuming attempts, so push is not blocked. Email requests use provider idempotency keys. Push retries may produce duplicates after an ambiguous network failure. Expo receipts are checked after 15 minutes; invalid device registrations are removed. `sent` records provider acceptance, not proof a phone displayed an alert or an email reached an inbox. Notification permission, phone connectivity, operating-system settings, and provider credentials affect delivery.

For a failed job whose underlying issue has been corrected, an administrator can set status to `pending`, attempts to `0`, and available_at to `now()`. Avoid replaying already submitted push tickets without checking provider logs. Pending jobs for a signed-out/reassigned device are skipped.

## Verify live before release

1. Sign in as a host and publish a listing. Sign in as a separate client on a phone and enable push alerts.
2. Request a booking. Verify the host sees the correct client name, note, guest count, and pending status.
3. Approve with feedback. Verify the client's approved booking, saved feedback, inbox, and phone alert after the scheduler runs.
4. Submit another request and reject with a reason. Verify the rejection and reason in the client booking and notification.
5. Cancel an approved booking as the client; verify the host receives cancellation.
6. Try responding from an unrelated account, a repeated decision, and approval over capacity. Each must fail without a misleading notification.
7. Sign out on the phone and verify further pushes to that account are skipped for that device. Sign in with another account, explicitly enable alerts, and verify recipient isolation.

References: [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Supabase email functions](https://supabase.com/docs/guides/functions/examples/send-emails), [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [Expo push delivery](https://docs.expo.dev/push-notifications/sending-notifications/).
