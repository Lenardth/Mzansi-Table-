import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../supabase/functions/dispatch-booking-notifications/index.ts',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{ compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(options = {}) {
 const job = { id: 'job-1', notification_id: 'notification-1', channel: 'push', push_token: 'ExpoPushToken[phone_1]', attempts: 1, lease_id: 'lease-1', status: 'sending', ...options.job };
 const rows = {
  notifications: [{ id: 'notification-1', user_id: 'user-1', booking_id: 'booking-1', title: 'Booking approved', body: 'Your table is confirmed. Host feedback: Welcome.' }],
  notification_deliveries: options.noJobs ? [] : [job],
  push_devices: options.noDevice ? [] : [{ token: 'ExpoPushToken[phone_1]', user_id: 'user-1' }],
 };
 if (options.receipt) rows.notification_deliveries.push({ id:'receipt-job', notification_id:'notification-1', channel:'push', push_token:'ExpoPushToken[phone_1]', status:'sent', provider_id:'old-ticket', sent_at: new Date(Date.now()-20*60000).toISOString(), receipt_checked_at:null });
 const calls = []; let claims = 0;
 function query(table) {
  let action = 'select', values, filters = [], maximum = Infinity;
  const builder = {
   select() { return this; }, update(v) { action='update'; values=v; return this; }, delete() { action='delete'; return this; },
   eq(k,v) { filters.push(r=>r[k]===v); return this; }, is(k,v) { filters.push(r=>r[k]===v || (v===null && r[k]===undefined)); return this; },
   lte(k,v) { filters.push(r=>r[k] && r[k]<=v); return this; }, limit(v) { maximum=v; return this; },
   single() { return execute(true); }, maybeSingle() { return execute(true); },
   then(resolve,reject) { return execute(false).then(resolve,reject); },
  };
  async function execute(single) {
   const matches = rows[table].filter(r=>filters.every(f=>f(r))).slice(0,maximum);
   if (options.ackError && action === 'update' && table === 'notification_deliveries') return { data: null, error: { message: 'Database temporarily unavailable' } };
   if (action==='update') matches.forEach(r=>Object.assign(r,values));
   if (action==='delete') rows[table] = rows[table].filter(r=>!matches.includes(r));
   return { data: single ? matches[0] || null : matches, error: null };
  }
  return builder;
 }
 const db = {
  from:query,
  rpc:async () => { claims++; return { data: options.noJobs ? [] : [{...job}], error: options.claimError ? { code:'database-unavailable' } : null }; },
  auth: { admin: { getUserById: async id => { assert.equal(id,'user-1'); return { data: { user: { email:'client@example.test', email_confirmed_at: options.unverified ? null : '2026-01-01' } },error:null }; } } },
 };
 let handler;
 const env = { NOTIFICATION_DISPATCH_SECRET:'dispatcher-secret', SUPABASE_URL:'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'server-only', ...(options.emailConfigured ? {RESEND_API_KEY:'resend-secret',BOOKING_EMAIL_FROM:'Bookings <bookings@example.test>'} : {}), ...options.env };
 const context = { exports:{}, require: () => ({ createClient:() => db }), Request, Response, AbortSignal, Date, console:{error(){}}, Deno: { env: { get:key=>env[key] }, serve: fn=>{handler=fn;} }, fetch:async (url,init) => {
  calls.push({url,init});
  if(options.networkError) throw new Error('Provider timeout');
  return new Response(JSON.stringify(options.result || (url.includes('getReceipts') ? {data:{'old-ticket':{status:'error',details:{error:'DeviceNotRegistered'}}}} : url.includes('resend') ? {id:'email-id'} : {data:{status:'ok',id:'push-ticket'}})),{status:options.providerStatus || 200});
 } };
 vm.runInNewContext(compiled,context);
 return { rows,calls,job,claims:()=>claims, invoke: (secret='dispatcher-secret',method='POST')=>handler(new Request('https://example.test/dispatch',{method,headers:{'x-dispatch-secret':secret}})) };
}
test('dispatcher requires its server secret before touching the queue',async()=>{
 const app=setup(); assert.equal((await app.invoke('wrong-secret')).status,401); assert.equal(app.claims(),0);
 assert.equal((await app.invoke('dispatcher-secret','GET')).status,405); assert.equal(app.claims(),0);
});
test('queue failure returns a retriable service error',async()=>{
 assert.equal((await setup({claimError:true}).invoke()).status,503);
});
test('push submission records Expo acceptance, not assumed device delivery',async()=>{
 const app=setup(); const result=await app.invoke(); assert.equal(result.status,200); assert.equal(app.calls.length,1);
 const body=JSON.parse(app.calls[0].init.body); assert.equal(body.to,'ExpoPushToken[phone_1]'); assert.equal(body.data.bookingId,'booking-1');
 assert.equal(app.job.status,'sent'); assert.equal(app.job.provider_id,'push-ticket'); assert.equal(app.job.receipt_status,undefined);
});
test('signed-out or reassigned device is skipped without sending',async()=>{
 const app=setup({noDevice:true}); await app.invoke(); assert.equal(app.calls.length,0); assert.equal(app.job.status,'skipped');
});
test('unregistered push device is removed without retrying',async()=>{
 const app=setup({result:{data:{status:'error',details:{error:'DeviceNotRegistered'}}}}); await app.invoke();
 assert.equal(app.job.status,'skipped'); assert.equal(app.rows.push_devices.length,0);
});
test('network failure retries with backoff, then stops at six attempts',async()=>{
 const app=setup({networkError:true}); await app.invoke(); assert.equal(app.job.status,'pending'); assert.ok(Date.parse(app.job.available_at)>Date.now());
 const exhausted=setup({networkError:true,job:{attempts:6}}); await exhausted.invoke(); assert.equal(exhausted.job.status,'failed');
});
test('unconfigured email does not exhaust retries or call a provider',async()=>{
 const app=setup({job:{channel:'email'}}); await app.invoke(); assert.equal(app.calls.length,0); assert.equal(app.job.status,'pending'); assert.equal(app.job.attempts,0);
});
test('email uses a verified Auth recipient and stable idempotency key',async()=>{
 const app=setup({emailConfigured:true,job:{channel:'email'}}); await app.invoke(); assert.equal(app.job.status,'sent');
 const request=app.calls[0]; assert.equal(request.init.headers['Idempotency-Key'],'booking/job-1');
 const body=JSON.parse(request.init.body); assert.deepEqual(body.to,['client@example.test']); assert.equal(body.subject,'Booking approved'); assert.match(body.text,/Welcome/);
});
test('unverified email addresses do not receive booking emails',async()=>{
 const app=setup({emailConfigured:true,unverified:true,job:{channel:'email'}}); await app.invoke(); assert.equal(app.job.status,'skipped'); assert.equal(app.calls.length,0);
});
test('provider errors are retried rather than reported as sent',async()=>{
 const app=setup({emailConfigured:true,job:{channel:'email'},providerStatus:429,result:{message:'Rate limit'}}); await app.invoke();
 assert.equal(app.job.status,'pending'); assert.match(app.job.last_error,/429/);
});
test('later push receipt failures are recorded and invalid devices removed',async()=>{
 const app=setup({noJobs:true,receipt:true}); await app.invoke();
 const row=app.rows.notification_deliveries[0]; assert.equal(row.receipt_status,'error'); assert.equal(row.status,'failed'); assert.equal(app.rows.push_devices.length,0);
});

test('failed delivery acknowledgements return 503 and leave the lease recoverable',async()=>{
 const app=setup({ackError:true}); const response=await app.invoke();
 assert.equal(response.status,503); assert.equal((await response.json()).unacknowledged,1); assert.equal(app.job.status,'sending');
});
