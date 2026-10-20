import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { AppIcon, type AppIconName } from '@/components/app-icon';
import { supabase } from '@/lib/supabase';
import { enablePushAlerts, disablePushAlerts, watchPushAlerts } from '@/lib/push-notifications';

type Role = 'client' | 'owner';
type Profile = { id: string; name: string; role: Role };
type Listing = { id: string; owner_id: string; title: string; description: string; location: string; kind: 'restaurant' | 'event' | 'experience'; capacity: number; starts_at: string | null };
type Booking = { id: string; listing_id: string; client_id: string; starts_at: string; guests: number; note: string; status: 'pending' | 'accepted' | 'declined' | 'cancelled'; host_feedback: string; client_name: string; responded_at: string | null };
type Notification = { id: string; title: string; body: string; read_at: string | null; created_at: string; booking_id: string };
type Tab = 'Discover' | 'Dashboard' | 'Bookings' | 'Requests' | 'Events' | 'Create' | 'Notifications' | 'Profile';
const formatTime = (v: string) => new Date(v).toLocaleString();
function Field({ label, value, onChange, secret = false, multiline = false }: { label: string; value: string; onChange: (v: string) => void; secret?: boolean; multiline?: boolean }) {
 return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} secureTextEntry={secret} multiline={multiline} autoCapitalize="none" style={[s.input, multiline && { minHeight: 90 }]} /></View>;
}
function Button({ title, onPress, disabled = false, secondary = false, icon }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; icon?: AppIconName }) {
 return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button, secondary && s.secondary, disabled && { opacity: 0.45 }]}>{icon && <AppIcon name={icon} size={19} color={secondary ? '#104c33' : 'white'} />}<Text style={[s.buttonText, secondary && { color: '#104c33' }]}>{title}</Text></Pressable>;
}
export default function RestaurantApp() {
 const [session, setSession] = useState<Session | null>(null);
 const [ready, setReady] = useState(false);
 const [profile, setProfile] = useState<Profile | null>(null);
 const [listings, setListings] = useState<Listing[]>([]);
 const [bookings, setBookings] = useState<Booking[]>([]);
 const [notifications, setNotifications] = useState<Notification[]>([]);
 const [feedback, setFeedback] = useState<Record<string, string>>({});
 const [bookingFilter, setBookingFilter] = useState('all');
 const initializedUser = useRef<string | null>(null);
 const [tab, setTab] = useState<Tab>('Discover');
 const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
 const [name, setName] = useState(''); const [role, setRole] = useState<Role>('client');
 const [verification, setVerification] = useState<'email' | 'recovery' | null>(null);
 const [verificationCode, setVerificationCode] = useState('');
 const [recovering, setRecovering] = useState(false);
 const [newPassword, setNewPassword] = useState('');
 const [repeatPassword, setRepeatPassword] = useState('');
 const [signup, setSignup] = useState(false); const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState(''); const [error, setError] = useState('');
 const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all');
 const [selected, setSelected] = useState<Listing | null>(null);
 const [date, setDate] = useState(''); const [guests, setGuests] = useState('1'); const [note, setNote] = useState('');
 const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
 const [location, setLocation] = useState(''); const [kind, setKind] = useState<Listing['kind']>('event');
 const [starts, setStarts] = useState(''); const [capacity, setCapacity] = useState('');
 const generation = useRef(0);
 const userId = session?.user.id;
 const run = async (work: () => Promise<void>) => {
  if (busy) return;
  setBusy(true); setError(''); setMessage('');
  try { await work(); } catch (e) { setError(e instanceof Error ? e.message : (e as { message?: string })?.message || 'Unable to complete this action. Please try again.'); }
  finally { setBusy(false); }
 };
 const load = async (id: string, version: number) => {
  if (!supabase) return;
  const [p, l, b, n] = await Promise.all([
   supabase.from('profiles').select('*').eq('id', id).single(),
   supabase.from('listings').select('*').order('created_at', { ascending: false }),
   supabase.from('bookings').select('*').order('created_at', { ascending: false }),
   supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
  ]);
  if (version !== generation.current) return;
  if (p.error || l.error || b.error || n.error) throw p.error || l.error || b.error || n.error;
  setProfile(p.data); setListings(l.data || []); setBookings(b.data || []); setNotifications(n.data || []);
  if (initializedUser.current !== id) { initializedUser.current = id; setTab(p.data.role === 'owner' ? 'Dashboard' : 'Discover'); }
 };
 const refresh = async () => { if (userId) await load(userId, generation.current); };
 useEffect(() => {
  if (!supabase) { setReady(true); return; }
  let active = true;
  supabase.auth.getSession().then(({ data, error: e }) => {
   if (active) { if (e) setError(e.message); setSession(data.session); setReady(true); }
  }).catch(e => { if (active) { setError(String(e)); setReady(true); } });
  const { data } = supabase.auth.onAuthStateChange((_event, next) => { if (active) { setSession(next); setReady(true); } });
  return () => { active = false; data.subscription.unsubscribe(); };
 }, []);
 useEffect(() => {
  const version = ++generation.current;
  initializedUser.current = null; setProfile(null); setListings([]); setBookings([]); setNotifications([]); setFeedback({}); setSelected(null); setTab('Discover'); setError(''); setMessage('');
  if (!userId) return;
  const sync = () => load(userId, version).catch(e => { if (version === generation.current) setError(e.message || 'Could not load your account.'); });
  void sync();
  const timer = setInterval(() => { if (AppState.currentState === 'active') void sync(); }, 15000);
  const subscription = AppState.addEventListener('change', state => { if (state === 'active') void sync(); });
  return () => { clearInterval(timer); subscription.remove(); };
 }, [userId]);
 useEffect(() => {
  if (!userId) return;
  return watchPushAlerts(() => { setSelected(null); setTab('Notifications'); void refresh().catch(() => {}); }, () => { void refresh().catch(() => {}); });
 }, [userId]);
 const parseDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) throw new Error('Use YYYY-MM-DD HH:MM for the local date and time.');
  const d = new Date(value.replace(' ', 'T') + ':00');
  const pad = (n: number) => String(n).padStart(2, '0');
  const roundtrip = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (!Number.isFinite(d.getTime()) || roundtrip !== value || d.getTime() <= Date.now()) throw new Error('Choose a valid future date and time.');
  return d.toISOString();
 };
 const positive = (value: string) => { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error('Enter a whole number between 1 and 10,000.'); return n; };
 const authenticate = () => run(async () => {
  if (!supabase) return;
  if (!email.trim() || password.length < 8) throw new Error('Enter your email and a password of at least 8 characters.');
  if (signup) {
   if (!name.trim() || name.trim().length > 100) throw new Error('Enter your name (up to 100 characters).');
   const { data, error: e } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim(), role } } });
   if (e) throw e;
   if (!data.session) { setVerification('email'); setVerificationCode(''); setMessage('Check your email and enter the confirmation code here.'); }
  } else { const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (e) { if (e.code === 'email_not_confirmed') { setVerification('email'); setVerificationCode(''); } throw e; } }
  setPassword('');
 });
 const sendVerification = () => run(async () => {
  if (!email.trim()) throw new Error('Enter your email address.');
  const result = verification === 'recovery'
   ? await supabase!.auth.resetPasswordForEmail(email.trim())
   : await supabase!.auth.resend({ type: 'signup', email: email.trim() });
  if (result.error) throw result.error;
  setVerificationCode(''); setMessage('A new email has been requested. Use its latest code.');
 });
 const verifyEmailCode = () => run(async () => {
  const token = verificationCode.replace(/\s/g, '');
  if (!email.trim() || !/^\d{6,10}$/.test(token)) throw new Error('Enter your email and the numeric code from your latest email.');
  const { data, error: e } = await supabase!.auth.verifyOtp({ email: email.trim(), token, type: verification === 'recovery' ? 'recovery' : 'email' });
  if (e) throw e;
  if (!data.session) throw new Error('Verification did not create a session. Request a new code.');
  if (verification === 'recovery') { setRecovering(true); setNewPassword(''); setRepeatPassword(''); }
  setVerification(null); setVerificationCode(''); setPassword('');
 });
 const saveRecoveredPassword = () => run(async () => {
  if (newPassword.length < 8) throw new Error('Use a password with at least 8 characters.');
  if (newPassword !== repeatPassword) throw new Error('The passwords do not match.');
  const { error: e } = await supabase!.auth.updateUser({ password: newPassword });
  if (e) throw e;
  setRecovering(false); setNewPassword(''); setRepeatPassword(''); setMessage('Your password has been updated.');
 });
 const createListing = () => run(async () => {
  if (!supabase || !profile) return;
  if (!title.trim() || !location.trim()) throw new Error('Enter a title and location.');
  const actualKind = profile.role === 'client' ? 'event' : kind;
  const { error: e } = await supabase.from('listings').insert({ owner_id: profile.id, title: title.trim(), description: description.trim(), location: location.trim(), kind: actualKind, capacity: positive(capacity), starts_at: actualKind === 'event' ? parseDate(starts) : null });
  if (e) throw e;
  setTitle(''); setDescription(''); setLocation(''); setCapacity(''); setStarts('');
  await refresh(); setTab(profile.role === 'owner' ? 'Dashboard' : 'Discover'); setMessage('Published. Clients can now request a booking.');
 });
 const request = () => run(async () => {
  if (!supabase || !selected) return;
  const count = positive(guests); if (count > selected.capacity) throw new Error('Guest count exceeds the capacity.');
  const { error: e } = await supabase.rpc('request_booking', { p_listing: selected.id, p_starts: selected.starts_at || parseDate(date), p_guests: count, p_note: note.trim() });
  if (e) throw e;
  setSelected(null); setNote(''); setDate(''); setGuests('1'); await refresh(); setBookingFilter('pending'); setTab('Bookings'); setMessage('Request sent. Your booking is pending host acceptance.');
 });
 const respond = (id: string, status: string) => run(async () => {
  const { error: e } = await supabase!.rpc('respond_booking', { p_booking: id, p_status: status, p_feedback: status === 'cancelled' ? '' : (feedback[id] || '').trim() });
  if (e) throw e;
  setFeedback(current => { const next = { ...current }; delete next[id]; return next; });
  await refresh(); setMessage(status === 'accepted' ? 'Booking approved. The client has been notified.' : status === 'declined' ? 'Booking rejected. Your feedback has been sent to the client inbox.' : 'Booking cancelled. The host has been notified.');
 });
 const hostBookings = bookings.filter(b => listings.some(l => l.id === b.listing_id && l.owner_id === userId));
 const ownBookings = bookings.filter(b => b.client_id === userId);
 const isBusiness = profile?.role === 'owner';
 const tabs: Tab[] = isBusiness ? ['Dashboard','Requests','Create','Notifications','Profile'] : ['Discover','Bookings','Events','Create','Notifications','Profile'];
 const labels: Partial<Record<Tab,string>> = { Requests: 'Requests', Events: 'My events', Create: isBusiness ? 'Publish' : 'New event', Notifications: 'Inbox' };
 const tabIcons: Record<Tab, AppIconName> = { Discover: 'discover', Dashboard: 'dashboard', Bookings: 'bookings', Requests: 'requests', Events: 'events', Create: 'create', Notifications: 'notifications', Profile: 'profile' };
 const kindIcons: Record<string, AppIconName> = { all: 'all', restaurant: 'restaurant', event: 'events', experience: 'experience' };
 const unread = notifications.filter(n => !n.read_at).length;
 const signOut = () => run(async () => { await disablePushAlerts(); const { error: e } = await supabase!.auth.signOut(); if(e) throw e; setPassword(''); });
 const changeTab = (next: Tab) => { if (!tabs.includes(next)) return; if (next === 'Bookings') setBookingFilter('all'); if (next === 'Requests' || next === 'Events') setBookingFilter('pending'); setSelected(null); setTab(next); setError(''); setMessage(''); };
 return <SafeAreaView style={s.safe}><View style={s.app}>
  <View style={s.header}><Image source={require('../../assets/brand/logo-header.png')} style={s.brandLogo} resizeMode="contain" accessibilityLabel="Mzansi Table" /><Text style={s.subtitle}>{isBusiness ? 'Business & host portal' : profile ? 'Your table. Your people.' : 'Good food brings us together.'}</Text></View>
  <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
   {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
   {message ? <Text accessibilityLiveRegion="polite" style={s.notice}>{message}</Text> : null}
   {!ready ? <ActivityIndicator /> : !supabase ? <View style={s.card}><Text style={s.heading}>Connect your Supabase project</Text><Text style={s.text}>The app needs its database connection before you can create an account or book. Add the project URL and publishable key to the environment and apply the included database migration.</Text></View>  : recovering && session ? <View style={s.card}><Text style={s.heading}>Choose a new password</Text><Field label="New password" value={newPassword} onChange={setNewPassword} secret /><Field label="Repeat new password" value={repeatPassword} onChange={setRepeatPassword} secret /><Button title="Save new password" disabled={busy} onPress={saveRecoveredPassword} /></View> : !session && verification ? <View style={s.card}><Text style={s.heading}>{verification === 'recovery' ? 'Verify your recovery code' : 'Confirm your email'}</Text><Text style={s.muted}>Enter the code from your latest email. You can stay in this app to finish verification.</Text><Field label="Email" value={email} onChange={setEmail} /><Field label="Email verification code" value={verificationCode} onChange={setVerificationCode} /><Button title="Verify code" disabled={busy} onPress={verifyEmailCode} /><Button title="Send a new code" secondary disabled={busy} onPress={sendVerification} /><Button title="Back to sign in" secondary disabled={busy} onPress={() => { setVerification(null); setSignup(false); setError(''); setMessage(''); setVerificationCode(''); }} /></View> : !session ? <View style={s.card}>
    <Text style={s.heading}>{signup ? 'Create your account' : 'Welcome back'}</Text>
    {signup && <><Field label="Your name" value={name} onChange={setName} /><Text style={s.label}>Account type</Text><View style={s.row}>{(['client', 'owner'] as Role[]).map(r => <Button key={r} title={r === 'client' ? 'Client' : 'Business / host'} secondary={role !== r} onPress={() => setRole(r)} />)}</View><Text style={s.muted}>{role === 'client' ? 'Book tables and experiences, create events, and manage your event requests.' : 'Publish restaurants, events, and experiences, and accept bookings.'}</Text></>}
    <Field label="Email" value={email} onChange={setEmail} /><Field label="Password" value={password} onChange={setPassword} secret />
    <Button title={signup ? 'Create account' : 'Sign in'} onPress={authenticate} disabled={busy} />
    <Button title={signup ? 'Already registered? Sign in' : 'New here? Create an account'} secondary onPress={() => { setSignup(!signup); setError(''); setMessage(''); }} disabled={busy} />
    {!signup && <Button title="Confirm an existing account" secondary disabled={busy} onPress={() => { setVerification('email'); setVerificationCode(''); setError(''); setMessage('Use the code from your confirmation email, or request a new email.'); }} />}
    {!signup && <Button title="Send password reset email" secondary disabled={busy} onPress={() => void run(async () => { if (!email.trim()) throw new Error('Enter your email first.'); const { error: e } = await supabase!.auth.resetPasswordForEmail(email.trim()); if (e) throw e; setVerification('recovery'); setVerificationCode(''); setMessage('Check your email for the recovery code.'); })} />}
   </View> : !profile ? <View style={s.card}><Text style={s.text}>Loading your account. If this continues, check that the database migration has been applied.</Text><Button title="Retry" onPress={() => void run(refresh)} disabled={busy} /><Button title="Sign out" secondary onPress={signOut} /></View> : <>
    {tab === 'Discover' && !isBusiness && !selected && <>
     <Text style={s.heading}>Find your next gathering</Text><Field label="Search by name or location" value={query} onChange={setQuery} />
     <View style={s.filters}>{['all','restaurant','event','experience'].map(f => <Pressable accessibilityRole="button" key={f} onPress={() => setFilter(f)} style={[s.chip, filter === f && s.activeChip]}><AppIcon name={kindIcons[f]} size={18} color={filter === f ? 'white' : '#104c33'} /><Text style={filter === f ? { color: 'white' } : s.text}>{f}</Text></Pressable>)}</View>
     {listings.filter(l => (!l.starts_at || new Date(l.starts_at).getTime() > Date.now()) && (filter === 'all' || l.kind === filter) && `${l.title} ${l.location}`.toLowerCase().includes(query.toLowerCase())).map(l => <View key={l.id} style={s.card}><Text style={s.tag}>{l.kind.toUpperCase()}{l.owner_id === userId ? ' · YOUR LISTING' : ''}</Text><Text style={s.heading}>{l.title}</Text><Text style={s.text}>{l.location}</Text>{l.description ? <Text style={s.muted}>{l.description}</Text> : null}<Text style={s.muted}>{l.starts_at ? formatTime(l.starts_at) : 'Choose a date and time'} · Capacity {l.capacity}</Text>{l.owner_id !== userId && profile.role === 'client' && <Button icon="bookings" title="Request a booking" disabled={busy} onPress={() => { setSelected(l); setDate(''); setNote(''); setGuests('1'); }} />}</View>)}
     {!listings.length && <Text style={s.muted}>No listings yet. Create the first event or business listing.</Text>}
     {!!listings.length && !listings.some(l => (!l.starts_at || new Date(l.starts_at).getTime() > Date.now()) && (filter === 'all' || l.kind === filter) && `${l.title} ${l.location}`.toLowerCase().includes(query.toLowerCase())) && <Text style={s.muted}>No matching listings.</Text>}
    </>}
    {selected && <View style={s.card}><Button title="Back to discovery" secondary onPress={() => setSelected(null)} /><Text style={s.heading}>{selected.title}</Text><Text style={s.text}>{selected.location}</Text>{selected.starts_at ? <Text style={s.text}>{formatTime(selected.starts_at)}</Text> : <Field label="Local date and time (YYYY-MM-DD HH:MM)" value={date} onChange={setDate} />}<Field label="Number of guests" value={guests} onChange={setGuests} /><Field label="Booking note (optional)" value={note} onChange={setNote} multiline /><Text style={s.muted}>Your host must accept the request before the booking is confirmed.</Text><Button icon="bookings" title="Send booking request" disabled={busy} onPress={request} /></View>}
    {tab === 'Dashboard' && isBusiness && <>
     <Text style={s.heading}>Welcome, {profile.name}</Text>
     <View style={s.card}><Text style={s.heading}>{hostBookings.filter(b => b.status === 'pending' && new Date(b.starts_at).getTime() > Date.now()).length} pending requests</Text><Text style={s.muted}>Review each request, approve available places, or reject with feedback.</Text><Button title="Review booking requests" onPress={() => changeTab('Requests')} /></View>
     <Text style={s.heading}>Your business listings</Text>
     {listings.filter(l => l.owner_id === userId).map(l => <View key={l.id} style={s.card}><Text style={s.tag}>{l.kind.toUpperCase()}</Text><Text style={s.heading}>{l.title}</Text><Text style={s.text}>{l.location}</Text><Text style={s.muted}>Capacity {l.capacity}{l.starts_at ? ` · ${formatTime(l.starts_at)}` : ''}</Text></View>)}
     {!listings.some(l => l.owner_id === userId) && <Text style={s.muted}>Publish your first listing to start receiving bookings.</Text>}
     <Button title="Publish a restaurant, event or experience" onPress={() => changeTab('Create')} />
    </>}
    {((tab === 'Bookings' && !isBusiness) || (tab === 'Requests' && isBusiness) || (tab === 'Events' && !isBusiness)) && <>
     <Text style={s.heading}>{tab === 'Bookings' ? 'My bookings' : tab === 'Events' ? 'My event requests' : 'Incoming booking requests'}</Text>
     <Text style={s.muted}>{tab === 'Bookings' ? 'Track approvals, read host feedback, or cancel a booking.' : 'Only requests for listings you own appear here. Rejections require a reason for the client.'}</Text>
     <View style={s.filters}>{['pending','accepted','declined','cancelled','all'].map(f => <Pressable key={f} accessibilityRole="button" onPress={() => setBookingFilter(f)} style={[s.chip, bookingFilter === f && s.activeChip]}><AppIcon name={f === 'all' ? 'all' : f as AppIconName} size={17} color={bookingFilter === f ? 'white' : '#104c33'} /><Text style={bookingFilter === f ? { color: 'white' } : s.text}>{f === 'accepted' ? 'approved' : f === 'declined' ? 'rejected' : f}</Text></Pressable>)}</View>
     {(tab === 'Bookings' ? ownBookings : hostBookings).filter(b => bookingFilter === 'all' || b.status === bookingFilter).map(b => {
      const l = listings.find(item => item.id === b.listing_id); const host = l?.owner_id === userId;
      const future = new Date(b.starts_at).getTime() > Date.now();
      return <View key={b.id} style={s.card}><View style={[s.statusBadge, { backgroundColor: b.status === 'accepted' ? '#e0eddf' : b.status === 'pending' ? '#fff0d6' : b.status === 'declined' ? '#ffe8e0' : '#eeece6' }]}><AppIcon name={b.status} size={17} color={b.status === 'declined' ? '#a43116' : b.status === 'pending' ? '#8a5c17' : '#104c33'} /><Text style={s.tag}>{b.status === 'accepted' ? 'APPROVED' : b.status === 'declined' ? 'REJECTED' : b.status.toUpperCase()}{!future ? ' · PAST' : ''}</Text></View><Text style={s.heading}>{l?.title || 'Listing unavailable'}</Text>{host && <Text style={s.text}>Client: {b.client_name}</Text>}<Text style={s.text}>{formatTime(b.starts_at)} · {b.guests} guests</Text><Text style={s.muted}>Reference: {b.id.slice(0,8)}</Text>{b.note ? <Text style={s.text}>Client note: {b.note}</Text> : null}{b.host_feedback ? <Text style={s.notice}>Host feedback: {b.host_feedback}</Text> : null}{b.responded_at && <Text style={s.muted}>Updated {formatTime(b.responded_at)}</Text>}
      {future && host && b.status === 'pending' && <><Field label="Feedback to client (required to reject)" value={feedback[b.id] || ''} onChange={v => setFeedback(current => ({ ...current, [b.id]: v }))} multiline /><View style={s.row}><Button icon="accepted" title="Approve booking" disabled={busy} onPress={() => respond(b.id,'accepted')} /><Button icon="declined" title="Reject booking" secondary disabled={busy || !feedback[b.id]?.trim()} onPress={() => respond(b.id,'declined')} /></View></>}
      {future && b.client_id === userId && ['pending','accepted'].includes(b.status) && <Button icon="cancelled" title="Cancel booking" secondary disabled={busy} onPress={() => respond(b.id,'cancelled')} />}
      </View>;
     })}
     {!(tab === 'Bookings' ? ownBookings : hostBookings).some(b => bookingFilter === 'all' || b.status === bookingFilter) && <Text style={s.muted}>No {bookingFilter === 'all' ? '' : bookingFilter} bookings.</Text>}
    </>}
    {tab === 'Notifications' && <><Text style={s.heading}>Booking notifications</Text><Text style={s.muted}>Approvals, rejections, feedback, and cancellations are saved here.</Text>{notifications.some(n => !n.read_at) && <Button title="Mark all as read" secondary disabled={busy} onPress={() => void run(async () => { const { error: e } = await supabase!.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId!).is('read_at',null); if(e) throw e; await refresh(); })} />}{!notifications.length && <Text style={s.muted}>No notifications yet.</Text>}{notifications.map(n => <View key={n.id} style={s.card}><Text style={s.tag}>{n.read_at ? 'READ' : 'NEW'} · {formatTime(n.created_at)}</Text><Text style={s.heading}>{n.title}</Text><Text style={s.text}>{n.body}</Text>{!n.read_at && <Button title="Mark as read" secondary disabled={busy} onPress={() => void run(async () => { const { error: e } = await supabase!.from('notifications').update({ read_at: new Date().toISOString() }).eq('id',n.id); if(e) throw e; await refresh(); })} />}</View>)}</>}
    {tab === 'Create' && <View style={s.card}><Text style={s.heading}>{profile.role === 'client' ? 'Create an event' : 'Publish a listing'}</Text>{profile.role === 'owner' && <View style={s.filters}>{(['restaurant','event','experience'] as const).map(k => <Button key={k} title={k} secondary={kind !== k} onPress={() => setKind(k)} />)}</View>}<Field label="Title" value={title} onChange={setTitle} /><Field label="Description" value={description} onChange={setDescription} multiline /><Field label="Location / address" value={location} onChange={setLocation} /><Field label="Capacity per time slot" value={capacity} onChange={setCapacity} />{(profile.role === 'client' || kind === 'event') && <Field label="Local event date and time (YYYY-MM-DD HH:MM)" value={starts} onChange={setStarts} />}<Text style={s.muted}>You will receive booking requests here. Accept requests to confirm places. Restaurant and experience capacity applies to each exact requested time.</Text><Button title="Publish" disabled={busy} onPress={createListing} /></View>}
    {tab === 'Profile' && <View style={s.card}><Text style={s.heading}>{profile.name}</Text><Text style={s.text}>{session.user.email}</Text><Text style={s.tag}>{profile.role === 'client' ? 'CLIENT & EVENT ORGANIZER' : 'BUSINESS OWNER / HOST'}</Text><Text style={s.muted}>Your listings: {listings.filter(l => l.owner_id === userId).length}</Text><Field label="New password (at least 8 characters)" value={password} onChange={setPassword} secret /><Button title="Update password" secondary disabled={busy} onPress={() => void run(async () => { if (password.length < 8) throw new Error('Use at least 8 characters.'); const { error: e } = await supabase!.auth.updateUser({ password }); if (e) throw e; setPassword(''); setMessage('Password updated.'); })} /><Text style={s.heading}>Phone push alerts</Text><Text style={s.muted}>Get booking updates on your phone, even when the app is closed.</Text><Button icon="notifications" title="Enable push alerts" disabled={busy} onPress={() => void run(async () => { await enablePushAlerts(); setMessage('Push alerts enabled for this phone.'); })} /><Button title="Disable push alerts on this phone" secondary disabled={busy} onPress={() => void run(async () => { await disablePushAlerts(); setMessage('Push alerts disabled for this phone.'); })} /><Button title="Sign out" disabled={busy} onPress={signOut} /></View>}
   </>}
   {busy && <ActivityIndicator color="#104c33" />}
  </ScrollView>
  {session && profile && <><View style={s.refresh}><Button icon="refresh" title="Refresh" secondary disabled={busy} onPress={() => void run(refresh)} /></View><View style={s.nav}>{tabs.map(t => <Pressable accessibilityRole="tab" accessibilityLabel={t === 'Notifications' ? `Inbox, ${unread} unread` : labels[t] || t} accessibilityState={{ selected: tab === t }} key={t} style={s.navItem} onPress={() => changeTab(t)}><View style={[s.navIcon, tab === t && s.navIconActive]}><AppIcon name={tabIcons[t]} size={23} color={tab === t ? '#104c33' : '#777b72'} />{t === 'Notifications' && unread > 0 && <View style={s.unreadBadge}><Text style={s.unreadText}>{unread > 9 ? '9+' : unread}</Text></View>}</View><Text numberOfLines={1} style={[s.navLabel, tab === t && { color: '#104c33', fontWeight: '800' }]}>{labels[t] || t}</Text></Pressable>)}</View></>}
 </View></SafeAreaView>;
}
const s = StyleSheet.create({
 safe: { flex: 1, backgroundColor: '#faf6ee' }, app: { flex: 1, width: '100%', maxWidth: 680, alignSelf: 'center' },
 header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16, backgroundColor: '#104c33', alignItems: 'flex-start', gap: 0 }, brandLogo: { width: '100%', maxWidth: 330, aspectRatio: 3 }, brand: { color: 'white', fontSize: 24, fontWeight: '800' }, subtitle: { color: '#dceedd', fontSize: 13 },
 content: { padding: 20, gap: 16, paddingBottom: 30 }, card: { backgroundColor: '#fffcf7', borderWidth: 1, borderColor: '#e8dfd1', borderRadius: 16, padding: 20, gap: 14 },
 heading: { fontSize: 23, fontWeight: '700', color: '#18201a' }, text: { color: '#18201a', fontSize: 15, lineHeight: 23 }, muted: { color: '#686b62', fontSize: 13, lineHeight: 21 },
 field: { gap: 7 }, label: { color: '#104c33', fontSize: 13, fontWeight: '700' }, input: { borderWidth: 1, borderColor: '#d9d3c6', borderRadius: 10, backgroundColor: 'white', padding: 14, color: '#18201a', fontSize: 15 },
 button: { flexDirection: 'row', gap: 8, backgroundColor: '#e3430b', padding: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, flexShrink: 1 }, buttonText: { flexShrink: 1, textAlign: 'center', color: 'white', fontSize: 14, fontWeight: '700' }, secondary: { backgroundColor: '#ede9df' },
 row: { flexDirection: 'row', gap: 10 }, filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 20, backgroundColor: '#ede9df' }, activeChip: { backgroundColor: '#104c33' },
 tag: { color: '#104c33', fontSize: 11, fontWeight: '800', letterSpacing: 1 }, error: { color: '#9b2008', backgroundColor: '#ffe8e0', padding: 14, borderRadius: 10 }, notice: { color: '#104c33', backgroundColor: '#dceedd', padding: 14, borderRadius: 10 },
 statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 }, navIcon: { width: 44, height: 32, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, navIconActive: { backgroundColor: '#e0eadc' }, navLabel: { color: '#777b72', fontSize: 10, marginTop: 4 }, unreadBadge: { position: 'absolute', top: -3, right: 0, backgroundColor: '#e3430b', minWidth: 15, height: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }, unreadText: { color: 'white', fontSize: 9, fontWeight: '800' }, nav: { flexDirection: 'row', paddingVertical: 7, backgroundColor: '#fffcf7', borderTopWidth: 1, borderColor: '#e8dfd1' }, navItem: { flex: 1, minHeight: 56, paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center' }, refresh: { paddingHorizontal: 20, paddingVertical: 8 },
});
