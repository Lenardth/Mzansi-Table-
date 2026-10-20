import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

type Delivery = { id: string; notification_id: string; channel: 'email' | 'push'; push_token: string | null; attempts: number; lease_id: string };
Deno.serve(async (request: Request) => {
  const secret = Deno.env.get('NOTIFICATION_DISPATCH_SECRET');
  if (!secret || request.headers.get('x-dispatch-secret') !== secret) return new Response('Unauthorized', { status: 401 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response('Missing server configuration', { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc('claim_notification_deliveries', { p_limit: 10 });
  if (error) { console.error('Unable to claim notification deliveries', error.code); return new Response('Queue unavailable', { status: 503 }); }
  let submitted = 0;
  const results = await Promise.allSettled(((data || []) as Delivery[]).map(async delivery => {
    // Lease-scoped updates prevent a worker from acknowledging another worker's attempt.
    const finish = async (values: Record<string, unknown>) => {
      const { error: updateError } = await db.from('notification_deliveries').update(values).eq('id', delivery.id).eq('lease_id', delivery.lease_id).eq('status', 'sending');
      if (updateError) throw new Error('Unable to record delivery result');
    };
    try {
      const { data: notification, error: notificationError } = await db.from('notifications').select('user_id,title,body,booking_id').eq('id', delivery.notification_id).single();
      if (notificationError || !notification) throw new Error('Notification unavailable');
      if (delivery.channel === 'email') {
        const apiKey = Deno.env.get('RESEND_API_KEY');
        const from = Deno.env.get('BOOKING_EMAIL_FROM');
        if (!apiKey || !from) {
          // Missing email configuration must not exhaust retries or block push delivery.
          await finish({ status: 'pending', attempts: delivery.attempts - 1, available_at: new Date(Date.now() + 300000).toISOString(), last_error: 'Email sender is not configured' });
          return;
        }
        const { data: recipient, error: recipientError } = await db.auth.admin.getUserById(notification.user_id);
        if (recipientError || !recipient.user?.email) throw new Error('Recipient email unavailable');
        if (!recipient.user.email_confirmed_at) { await finish({ status: 'skipped', last_error: 'Email is not verified' }); return; }
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `booking/${delivery.id}` },
          body: JSON.stringify({ from, to: [recipient.user.email], subject: notification.title, text: notification.body }), signal: AbortSignal.timeout(15000),
        });
        const result = await response.json();
        if (!response.ok || !result.id) throw new Error(`Email provider rejected delivery (${response.status})`);
        await finish({ status: 'sent', provider_id: result.id, sent_at: new Date().toISOString(), last_error: null });
      } else {
        const { data: device, error: deviceError } = await db.from('push_devices').select('token').eq('token', delivery.push_token).eq('user_id', notification.user_id).maybeSingle();
        if (deviceError) throw new Error('Could not verify device');
        if (!device) { await finish({ status: 'skipped', last_error: 'Device was unregistered' }); return; }
        const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(expoToken ? { Authorization: `Bearer ${expoToken}` } : {}) },
          body: JSON.stringify({ to: device.token, title: notification.title, body: Array.from(notification.body as string).slice(0, 400).join(''), sound: 'default', channelId: 'bookings', data: { bookingId: notification.booking_id } }), signal: AbortSignal.timeout(15000),
        });
        const result = await response.json();
        const ticket = result.data;
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          await db.from('push_devices').delete().eq('token', device.token).eq('user_id', notification.user_id);
          await finish({ status: 'skipped', last_error: 'Device not registered with push provider' }); return;
        }
        if (!response.ok || ticket?.status !== 'ok' || !ticket.id) throw new Error(`Push provider rejected delivery (${response.status})`);
        // 'sent' means accepted by Expo; it does not prove display on the device.
        await finish({ status: 'sent', provider_id: ticket.id, sent_at: new Date().toISOString(), last_error: null });
      }
      submitted++;
    } catch (e) {
      await finish({ status: delivery.attempts >= 6 ? 'failed' : 'pending', available_at: new Date(Date.now() + Math.min(3600, 30 * 2 ** delivery.attempts) * 1000).toISOString(), last_error: e instanceof Error ? e.message : 'Delivery failed' });
    }
  }));
  // Expo tickets acknowledge queueing. Check the later APNs/FCM receipt separately.
  try {
    const { data: sent, error: receiptQueryError } = await db.from('notification_deliveries')
      .select('id,provider_id,push_token,notification_id,sent_at').eq('channel','push').eq('status','sent')
      .is('receipt_checked_at',null).lte('sent_at',new Date(Date.now() - 15 * 60000).toISOString()).limit(100);
    if (receiptQueryError) throw receiptQueryError;
    const waiting = [];
    for (const delivery of sent || []) {
      if (new Date(delivery.sent_at).getTime() < Date.now() - 24 * 3600000) {
        await db.from('notification_deliveries').update({ receipt_status: 'unavailable', receipt_checked_at: new Date().toISOString() }).eq('id',delivery.id);
      } else if (delivery.provider_id) waiting.push(delivery);
    }
    if (waiting.length) {
      const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
      const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(expoToken ? { Authorization: `Bearer ${expoToken}` } : {}) },
        body: JSON.stringify({ ids: waiting.map(d => d.provider_id) }), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Push receipt provider unavailable');
      const result = await response.json();
      for (const delivery of waiting) {
        const receipt = result.data?.[delivery.provider_id];
        if (!receipt || !['ok','error'].includes(receipt.status)) continue;
        await db.from('notification_deliveries').update({ receipt_status: receipt.status, receipt_checked_at: new Date().toISOString(), ...(receipt.status === 'error' ? { status: 'failed', last_error: `Push receipt: ${receipt.details?.error || 'provider rejection'}` } : {}) }).eq('id',delivery.id);
        if (receipt.details?.error === 'DeviceNotRegistered') {
          const { data: recipient } = await db.from('notifications').select('user_id').eq('id',delivery.notification_id).single();
          if (recipient) await db.from('push_devices').delete().eq('token',delivery.push_token).eq('user_id',recipient.user_id);
        }
      }
    }
  } catch { console.error('Unable to check push receipts; will retry on the next dispatch'); }
  const unacknowledged = results.filter(result => result.status === 'rejected').length;
  if (unacknowledged) console.error('Some delivery acknowledgements failed; leases will recover');
  return Response.json({ processed: data?.length || 0, submitted, unacknowledged }, { status: unacknowledged ? 503 : 200 });
});
