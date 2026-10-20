import { SymbolView, type SymbolViewProps } from 'expo-symbols';

const symbols = {
 discover: { ios: 'safari', android: 'explore', web: 'explore' },
 dashboard: { ios: 'square.grid.2x2', android: 'dashboard', web: 'dashboard' },
 bookings: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
 requests: { ios: 'tray.and.arrow.down', android: 'inbox', web: 'inbox' },
 events: { ios: 'party.popper', android: 'celebration', web: 'celebration' },
 create: { ios: 'plus.circle', android: 'add_circle', web: 'add_circle' },
 notifications: { ios: 'bell', android: 'notifications', web: 'notifications' },
 profile: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
 restaurant: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
 experience: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
 all: { ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' },
 pending: { ios: 'clock', android: 'schedule', web: 'schedule' },
 accepted: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
 declined: { ios: 'xmark.circle', android: 'cancel', web: 'cancel' },
 cancelled: { ios: 'minus.circle', android: 'do_not_disturb_on', web: 'do_not_disturb_on' },
 refresh: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
} satisfies Record<string, SymbolViewProps['name']>;
export type AppIconName = keyof typeof symbols;
export function AppIcon({ name, size = 22, color = '#104c33' }: { name: AppIconName; size?: number; color?: string }) {
 return <SymbolView name={symbols[name]} size={size} tintColor={color} weight="medium" style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
