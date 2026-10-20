import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function TabLayout() {
  return <SafeAreaProvider><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false }} /></SafeAreaProvider>;
}
