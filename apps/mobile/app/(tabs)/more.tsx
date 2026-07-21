import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, ListItem, Screen } from '@/components/ui';
import { fontSize, spacing, useTheme } from '@/theme';

/**
 * WI-026 — one-tap-from-tab-bar overflow menu. Lifted verbatim from the
 * MORE section that previously lived in account.tsx (now removed there to
 * avoid two competing "more" surfaces).
 */
export default function MoreTab() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <Screen scroll>
      <Text style={[styles.title, { color: colors.ink }]}>More</Text>

      <Card padded={false} style={styles.listCard}>
        <ListItem
          title="Recurring expenses"
          subtitle="Rent, subscriptions and other repeating bills"
          icon="repeat-outline"
          chevron
          onPress={() => router.push('/recurring')}
        />
        <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
        <ListItem
          title="Analytics"
          subtitle="Where your money goes"
          icon="bar-chart-outline"
          chevron
          onPress={() => router.push('/analytics')}
        />
        <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
        <ListItem
          title="Activity"
          subtitle="Everything that happened across your groups"
          icon="pulse-outline"
          chevron
          onPress={() => router.push('/activity')}
        />
        <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
        <ListItem
          title="Notifications"
          subtitle="Choose what you get push and email alerts for"
          icon="notifications-outline"
          chevron
          onPress={() => router.push('/notification-preferences')}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  listCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 56,
  },
});
