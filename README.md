# Mzansi Table

Expo app with Supabase authentication, two account types, listing creation, and persistent booking requests. No sample restaurants, users, bookings, wallet balances, or simulated payments are included.

## Connect the database

1. Create a Supabase project. For a fresh database, run `node scripts/prepare-database.mjs`, then paste `supabase/setup.sql` into SQL Editor and run it once. It applies all migrations atomically. If the base schema already exists, apply only the pending files in `supabase/migrations` in order.
2. Copy `.env.example` to `.env.local`. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` using the project's Connect dialog. An anon key can also be used as the publishable key value. Never use a secret or service-role key in the app.
3. Run `npm install`, then `npx expo start --clear` (or `npm run web`).
4. Configure the hosted signup and password-recovery email templates using [AUTH-EMAIL.md](supabase/AUTH-EMAIL.md). The app uses email codes so phone users can verify inside the app without a localhost redirect.

The migration must be applied before registering accounts. It provisions a profile on signup. The existing-accounts migration restores profiles for Auth users who registered before database setup, preserving their registered account type.

## Account types

- **Client portal:** discovery, personal reservations, host feedback, event creation, a separate My events request screen, and a private notification inbox.
- **Business / host portal:** own listings dashboard, incoming booking requests, approval/rejection with feedback, publishing, and a private notification inbox. Business accounts cannot book as clients.

These are two account types, with any number of users. A role is chosen at registration and cannot be changed through the client. Every account can create events; only business accounts can publish restaurants and experiences.

## Booking behavior

A request starts as pending. Rejection requires feedback; approval and rejection save a response timestamp and notify the client. Client cancellation notifies the host. Only its listing's host can accept or decline it. Only its client can cancel a pending or accepted booking. Acceptance checks capacity while locking the listing, preventing simultaneous acceptances from overbooking the same slot. Events have a fixed scheduled time. Restaurants and experiences accept future times; capacity is measured at each exact timestamp, with no duration or opening-hours model yet. Account data refreshes every 15 seconds while active, on foregrounding, and through the Refresh button.

Database row policies restrict personal account and booking reads. Booking writes use authenticated database functions with ownership and status checks. Public keys are safe to ship only with these permissions applied. Payment processing, menus, and money transfers are not implemented; their simulated controls have been removed.

## Validate

```sh
npm test
npx tsc --noEmit
npx expo export --platform web
```

## Live acceptance checks

Use two confirmed accounts in separate browser sessions: one host and one client. Publish a listing as the host, book it as the client, accept it as the host, and refresh the client to verify the accepted state persists after signing out and back in. Cancel as the client and confirm the host sees cancellation. Create a client event and verify that its creator can accept requests from another client. Try requests exceeding capacity and confirm acceptance fails. Verify an unrelated account cannot read bookings or respond to them through the API.

Implementation references: [Supabase React Native Auth](https://supabase.com/docs/guides/auth/quickstarts/react-native) and [Supabase row level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Booking alerts

In-app inboxes, opt-in native phone push, and optional Resend emails are implemented. Follow [notification deployment and phone build setup](supabase/NOTIFICATIONS.md) to activate live delivery. This needs the second database migration, deployed Edge Function, minute scheduler, and Expo push credentials. Expo Go does not support remote push. Local tests exercise real PostgreSQL permissions, booking decisions, queue leases, and mocked provider success/failure paths without sending messages.

## Source and Expo publishing

GitHub repository: https://github.com/Lenardth/Mzansi-Table-

Expo project: https://expo.dev/accounts/tivanan_ilenard/projects/expo-go-app

The app is linked to EAS project `6147018a-bb96-4c50-904a-abb5cadcb2c5`. The preview environment holds the public Supabase connection settings. Local environment files are excluded from Git.

Publish a preview update after committing changes:

```sh
npm run update:preview -- --message "Describe the update"
```

Native preview builds use the `preview` channel. Installing an initial native build is required before EAS Update can deliver updates to that app; updates do not install a new app or change its native icon. Database migrations, hosted Auth templates, and notification worker configuration remain separate Supabase deployment steps.
