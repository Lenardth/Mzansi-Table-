import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const storageKey = 'mzansi-push-device';
const supported = () => Platform.OS !== 'web' && Constants.appOwnership !== 'expo' && Device.isDevice;
type SavedDevice = { token: string; userId: string };
async function savedDevice(): Promise<SavedDevice | null> {
  if (!supported()) return null;
  const stored = await AsyncStorage.getItem(storageKey);
  return stored ? JSON.parse(stored) : null;
}
async function notificationsModule() {
  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
  return Notifications;
}
export async function enablePushAlerts() {
  if (Platform.OS === 'web') throw new Error('Phone push alerts are available in the iOS and Android app. Booking updates also appear in your inbox.');
  if (Constants.appOwnership === 'expo') throw new Error('Push alerts need the Mzansi Table development or production app. Expo Go does not support remote push alerts.');
  if (!Device.isDevice) throw new Error('Enable push alerts on a physical phone.');
  if (!supabase) throw new Error('Sign in first.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in first.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  if (!projectId) throw new Error('This build needs an Expo EAS project ID before push alerts can be enabled.');
  const Notifications = await notificationsModule();
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('bookings', { name: 'Booking updates', importance: Notifications.AndroidImportance.HIGH });
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Push alerts were not enabled. Allow notifications in your phone settings and try again.');
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const { error } = await supabase.rpc('register_push_device', { p_token: token });
  if (error) throw error;
  await AsyncStorage.setItem(storageKey, JSON.stringify({ token, userId: session.user.id }));
}
export async function disablePushAlerts() {
  if (!supabase) return;
  const saved = await savedDevice();
  if (!saved) return;
  const { error } = await supabase.rpc('unregister_push_device', { p_token: saved.token });
  if (error) throw error;
  await AsyncStorage.removeItem(storageKey);
}
// Import only in a native build, keeping Expo Go and server rendering usable.
export function watchPushAlerts(onOpen: () => void, onReceive: () => void) {
  let closed = false;
  const subscriptions: { remove: () => void }[] = [];
  if (supported()) void (async () => {
    const Notifications = await notificationsModule();
    if (closed) return;
    subscriptions.push(Notifications.addNotificationResponseReceivedListener(() => {
      onOpen(); void Notifications.clearLastNotificationResponseAsync();
    }));
    subscriptions.push(Notifications.addNotificationReceivedListener(onReceive));
    const last = await Notifications.getLastNotificationResponseAsync();
    if (last && !closed) { onOpen(); await Notifications.clearLastNotificationResponseAsync(); }
    const saved = await savedDevice();
    const { data } = await supabase!.auth.getSession();
    const permission = await Notifications.getPermissionsAsync();
    if (!closed && saved?.userId === data.session?.user.id && permission.status === 'granted') await enablePushAlerts();
  })().catch(() => { /* In-app inbox remains available if phone setup fails. */ });
  return () => { closed = true; subscriptions.forEach(s => s.remove()); };
}
