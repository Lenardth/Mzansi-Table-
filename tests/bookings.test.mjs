import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Exercise the real migrations with PostgreSQL roles/RLS, without live users or messages.
test('booking roles, decisions and notification transactions', async t => {
 const db = new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth;
 create table auth.users(id uuid primary key, raw_user_meta_data jsonb, email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
 grant usage on schema public, auth to anon, authenticated, service_role;
 grant execute on function auth.uid() to anon, authenticated, service_role;
 `);
 await db.query('insert into auth.users values ($1,$2,$3)',['00000000-0000-0000-0000-000000000099',{name:'Existing host',role:'owner'},'existing@example.test']);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 await t.test('fresh setup restores an existing Auth account with its registered role', async () => {
  const restored = (await db.query("select name,role from public.profiles where id='00000000-0000-0000-0000-000000000099'")).rows[0];
  assert.deepEqual(restored,{name:'Existing host',role:'owner'});
 });
 const ids = { owner: '00000000-0000-0000-0000-000000000001', other: '00000000-0000-0000-0000-000000000002', client: '00000000-0000-0000-0000-000000000003', client2: '00000000-0000-0000-0000-000000000004' };
 for (const [name,id] of Object.entries(ids)) await db.query('insert into auth.users(id,raw_user_meta_data) values ($1,$2)',[id, { name, role: name.startsWith('client') ? 'client' : 'owner' }]);
 async function as(user, sql, params = []) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[user]]);
  try { return await db.query(sql,params); } finally { await db.exec('reset role'); }
 }
 const listing = (await db.query("insert into public.listings(owner_id,kind,title,location,capacity) values($1,'restaurant','Real restaurant','Johannesburg',3) returning id",[ids.owner])).rows[0].id;
 const when = '2099-10-20T18:00:00Z';
 const book = async (client, guests = 2) => (await as(client,"select public.request_booking($1,$2,$3,'Birthday') as id",[listing,when,guests])).rows[0].id;
 let first, second;
 await t.test('account roles prevent business booking and client business listing creation',async () => {
  await assert.rejects(as('client',"insert into public.listings(owner_id,kind,title,location,capacity) values($1,'restaurant','Bad','Here',4)",[ids.client]),/row-level security/);
  await assert.rejects(as('other','select public.request_booking($1,$2,1,\'\')',[listing,when]),/client account/);
  await assert.rejects(as('client',"update public.profiles set role='owner'"),/permission denied/);
 });
 await t.test('request creates notifications atomically and rejects duplicates',async () => {
  first = await book('client'); second = await book('client2');
  const rows = (await as('owner','select * from public.bookings')).rows;
  assert.equal(rows.length,2); assert.equal(rows[0].client_name,'client');
  assert.equal((await as('other','select * from public.bookings')).rows.length,0);
  assert.equal((await as('client','select * from public.bookings')).rows.length,1);
  assert.equal((await db.query('select * from public.notifications')).rows.length,4);
  await assert.rejects(book('client'),/already have/);
  assert.equal((await db.query('select * from public.notifications')).rows.length,4);
 });
 await t.test('only the host can approve and direct writes cannot bypass decisions',async () => {
  await assert.rejects(as('client',"select public.respond_booking($1,'accepted','Hacked')",[first]),/Only the listing host/);
  await assert.rejects(as('other',"select public.respond_booking($1,'accepted','Hacked')",[first]),/Only the listing host/);
  await assert.rejects(as('client',"update public.bookings set status='accepted'"),/permission denied/);
  await as('client',"select public.register_push_device('ExpoPushToken[device_123]')");
  await as('owner',"select public.respond_booking($1,'accepted','We will prepare your table.')",[first]);
  const booking = (await as('client','select * from public.bookings')).rows[0];
  assert.equal(booking.status,'accepted'); assert.equal(booking.host_feedback,'We will prepare your table.'); assert.ok(booking.responded_at);
  const notification = (await as('client',"select * from public.notifications where title='Booking approved'")).rows[0];
  assert.match(notification.body,/We will prepare your table/);
  const deliveries = (await db.query('select * from public.notification_deliveries where notification_id=$1',[notification.id])).rows;
  assert.deepEqual(deliveries.map(d=>d.channel).sort(),['email','push']);
 });
 await t.test('capacity failures and repeated responses produce no extra notifications',async () => {
  const before = (await db.query('select count(*) from public.notifications')).rows[0].count;
  await assert.rejects(as('owner',"select public.respond_booking($1,'accepted','Welcome')",[second]),/Not enough capacity/);
  await assert.rejects(as('owner',"select public.respond_booking($1,'accepted','Again')",[first]),/pending booking/);
  assert.equal((await db.query('select count(*) from public.notifications')).rows[0].count,before);
  assert.equal((await as('client2','select status from public.bookings')).rows[0].status,'pending');
 });
 await t.test('rejections require feedback and clients see the saved reason',async () => {
  await assert.rejects(as('owner',"select public.respond_booking($1,'declined','  ')",[second]),/reason for rejection/);
  await as('owner',"select public.respond_booking($1,'declined','Fully booked. Please try 20:00.')",[second]);
  assert.equal((await as('client2','select host_feedback from public.bookings')).rows[0].host_feedback,'Fully booked. Please try 20:00.');
  assert.match((await as('client2',"select body from public.notifications where title='Booking rejected'")).rows[0].body,/Please try 20:00/);
 });
 await t.test('inbox permissions prevent reading, forging, or editing other users notifications',async () => {
  const own = (await as('client','select * from public.notifications')).rows;
  assert.ok(own.every(n=>n.user_id === ids.client));
  assert.equal((await as('other','select * from public.notifications')).rows.length,0);
  await assert.rejects(as('client',"update public.notifications set body='Fake approval'"),/permission denied/);
  await assert.rejects(as('client',"select public.queue_notification($1,$2,'Forged','Approval')",[ids.client,first]),/permission denied/);
  assert.equal((await as('client2','update public.notifications set read_at=now() where id=$1 returning id',[own[0].id])).rows.length,0);
  assert.equal((await as('client','update public.notifications set read_at=now() where id=$1 returning id',[own[0].id])).rows.length,1);
  await assert.rejects(as('client','select * from public.notification_deliveries'),/permission denied/);
  await assert.rejects(as('client','select public.claim_notification_deliveries(20)'),/permission denied/);
 });
 await t.test('only the booking client can cancel, preserving approval feedback',async () => {
  await assert.rejects(as('client2',"select public.respond_booking($1,'cancelled','')",[first]),/Cannot cancel/);
  await as('client',"select public.respond_booking($1,'cancelled','')",[first]);
  const row = (await as('client','select * from public.bookings')).rows[0];
  assert.equal(row.status,'cancelled'); assert.equal(row.host_feedback,'We will prepare your table.');
  assert.equal((await as('owner',"select * from public.notifications where title='Booking cancelled'")).rows.length,1);
 });
 await t.test('clients manage only events they created, outside the business portal',async () => {
  const event = (await db.query("insert into public.listings(owner_id,kind,title,location,capacity,starts_at) values($1,'event','Dinner event','Here',5,$2) returning id",[ids.client,when])).rows[0].id;
  const booking = (await as('client2',"select public.request_booking($1,$2,1,'') as id",[event,when])).rows[0].id;
  await assert.rejects(as('owner',"select public.respond_booking($1,'accepted','')",[booking]),/Only the listing host/);
  await as('client',"select public.respond_booking($1,'accepted','See you there')",[booking]);
 });
 await t.test('device reassignment and unregister cannot affect another user device',async () => {
  await assert.rejects(as('client',"select public.register_push_device('invalid')"),/check constraint/);
  await as('client2',"select public.register_push_device('ExpoPushToken[device_123]')");
  await as('client',"select public.unregister_push_device('ExpoPushToken[device_123]')");
  assert.equal((await db.query('select user_id from public.push_devices')).rows[0].user_id,ids.client2);
  await as('client2',"select public.unregister_push_device('ExpoPushToken[device_123]')");
  assert.equal((await db.query('select * from public.push_devices')).rows.length,0);
 });
 await t.test('delivery leases prevent overlapping workers from claiming the same job',async () => {
  await db.exec('set role service_role');
  const jobs = (await db.query('select * from public.claim_notification_deliveries(2)')).rows;
  assert.equal(jobs.length,2); assert.ok(jobs.every(j=>j.lease_id && j.attempts===1));
  const next = (await db.query('select * from public.claim_notification_deliveries(2)')).rows;
  assert.ok(next.every(j=>!jobs.some(previous=>previous.id===j.id)));
  await db.exec('reset role');
  await db.query("update public.notification_deliveries set leased_at=now()-interval '6 minutes' where id=$1",[jobs[0].id]);
  const recovered = (await db.query('select * from public.claim_notification_deliveries(50)')).rows.find(j=>j.id===jobs[0].id);
  assert.ok(recovered); assert.notEqual(recovered.lease_id,jobs[0].lease_id); assert.equal(recovered.attempts,2);
 });
 await db.close();
});
