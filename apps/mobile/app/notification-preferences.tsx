import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { NotificationCategory } from '@divzy/shared';
import { Badge, Card, ErrorState, SkeletonList } from '@/components/ui';
import {
  errorMessage,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/lib/hooks';
import { fontSize, spacing, useTheme, withAlpha } from '@/theme';

// Display copy for the 9 canonical categories (packages/shared/src/constants.ts
// NOTIFICATION_CATEGORIES — 6 buildable, 3 reserved/deferred). Presentational
// only; does not affect which categories exist or which are available.
const CATEGORY_COPY: Record<NotificationCategory, { title: string; hint: string }> = {
  EXPENSE_ADDED: { title: 'Expense added', hint: 'When someone adds a new expense' },
  EXPENSE_EDITED: { title: 'Expense edited', hint: 'When an expense you are part of is changed' },
  EXPENSE_DELETED: {
    title: 'Expense deleted',
    hint: 'When an expense you are part of is removed',
  },
  COMMENT: { title: 'Comments', hint: 'When someone comments on an expense' },
  PAYMENT_RECEIVED: { title: 'Payment received', hint: 'When someone records a payment to you' },
  GROUP_INVITE: { title: 'Group invites', hint: 'When you are added to a group' },
  EXPENSE_DUE: {
    title: 'Expense due reminders',
    hint: 'Reminders before a recurring expense is due',
  },
  MONTHLY_SUMMARY: { title: 'Monthly summary', hint: 'A recap of your spending each month' },
  PRODUCT_NEWS: { title: 'Product news', hint: 'Occasional updates about new Divzy features' },
};

type Channel = 'pushEnabled' | 'emailEnabled';

function Banner({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
      <Text style={[styles.bannerText, { color: colors.danger }]}>{text}</Text>
    </View>
  );
}

/**
 * WI-041 (auth's slice) — one row per canonical category, push + email
 * toggle each. Buildable categories are live; the 3 reserved/deferred
 * categories (`available: false`) render disabled with a "Coming soon"
 * badge — never hidden, never live.
 */
export default function NotificationPreferencesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const query = useNotificationPreferences();
  const updatePref = useUpdateNotificationPreferences();
  const [error, setError] = useState<string | null>(null);
  // Independent per-cell pending tracking — a category's push toggle being
  // in flight must never disable its own email toggle or any other row's
  // toggles (same one-control-independent-of-another principle as the
  // Account screen's separate mutation instances; a fixed 9x2 grid can't use
  // 18 separate hook instances since hooks can't be called in a loop, so
  // per-cell disabled state is tracked here instead of via mutation.isPending).
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      void query.refetch();
      // Only re-fetch on focus; refetch() itself is stable across renders.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const toggle = (category: NotificationCategory, channel: Channel, value: boolean) => {
    const key = `${category}:${channel}`;
    setError(null);
    setPendingKeys((prev) => new Set(prev).add(key));
    updatePref.mutate(
      { preferences: [{ category, [channel]: value }] },
      {
        onError: (err) => setError(errorMessage(err)),
        onSettled: () => {
          setPendingKeys((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        },
      },
    );
  };

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.page }]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>Notifications</Text>
        <View style={styles.headerButton} />
      </View>

      {query.isLoading ? (
        <SkeletonList rows={4} avatar={false} style={styles.gutters} />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.gutters} showsVerticalScrollIndicator={false}>
          {error ? <Banner text={error} /> : null}
          {(query.data?.categories ?? []).map((pref) => {
            const copy = CATEGORY_COPY[pref.category];
            const pushPending = pendingKeys.has(`${pref.category}:pushEnabled`);
            const emailPending = pendingKeys.has(`${pref.category}:emailEnabled`);
            return (
              <Card key={pref.category} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={[styles.title, { color: colors.ink }]}>{copy.title}</Text>
                  {!pref.available ? <Badge label="Coming soon" tone="neutral" /> : null}
                </View>
                <Text style={[styles.hint, { color: colors.ink3 }]}>{copy.hint}</Text>
                <View style={[styles.channelsRow, { borderTopColor: colors.hairline }]}>
                  <View style={styles.channel}>
                    <Text style={[styles.channelLabel, { color: colors.ink2 }]}>Push</Text>
                    <Switch
                      value={pref.available && pref.pushEnabled}
                      onValueChange={(v) => toggle(pref.category, 'pushEnabled', v)}
                      disabled={!pref.available || pushPending}
                      trackColor={{ false: colors.surface2, true: colors.brand }}
                      thumbColor={colors.onBrand}
                    />
                  </View>
                  <View style={styles.channel}>
                    <Text style={[styles.channelLabel, { color: colors.ink2 }]}>Email</Text>
                    <Switch
                      value={pref.available && pref.emailEnabled}
                      onValueChange={(v) => toggle(pref.category, 'emailEnabled', v)}
                      disabled={!pref.available || emailPending}
                      trackColor={{ false: colors.surface2, true: colors.brand }}
                      thumbColor={colors.onBrand}
                    />
                  </View>
                </View>
              </Card>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  gutters: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginLeft: spacing.xs,
  },
  banner: {
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  card: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  hint: {
    fontSize: fontSize.xs,
  },
  channelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
    paddingTop: spacing.sm + 2,
  },
  channel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // WI-068 §12 — 44pt touch target for the toggle row.
    minHeight: 44,
  },
  channelLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
});
