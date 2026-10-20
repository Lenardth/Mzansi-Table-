-- Run after deploying the function and creating a Vault secret named
-- notification_dispatch_secret with the SAME value as the Edge Function's
-- NOTIFICATION_DISPATCH_SECRET. No secret belongs in the mobile app.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select cron.schedule(
 'dispatch-booking-notifications',
 '* * * * *',
 $job$
 select net.http_post(
   url := 'https://owygwrazvoxmurceofaw.supabase.co/functions/v1/dispatch-booking-notifications',
   headers := jsonb_build_object('Content-Type','application/json','x-dispatch-secret', decrypted_secret),
   body := '{}'::jsonb,
   timeout_milliseconds := 60000
 ) from vault.decrypted_secrets where name = 'notification_dispatch_secret';
 $job$
);
