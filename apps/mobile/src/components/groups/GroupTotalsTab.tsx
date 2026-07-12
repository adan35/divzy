import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { formatMoney, type ExpenseDto, type PublicUserDto } from '@divzy/shared';
import {
  Avatar,
  Card,
  EmptyState,
  ErrorState,
  SectionHeader,
  SkeletonList,
} from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/hooks';
import { fontSize, spacing, useTheme } from '@/theme';

/** Page through every (non-deleted) expense of the group. Hard cap keeps a pathological group from looping forever. */
async function fetchAllGroupExpenses(groupId: string): Promise<ExpenseDto[]> {
  const out: ExpenseDto[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await api.expenses.list({ groupId, limit: 100, cursor });
    out.push(...res.items);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return out;
}

interface CurrencyTotal {
  currency: string;
  total: number;
  count: number;
  byMember: Array<{ user: PublicUserDto; paid: number }>;
}

export interface GroupTotalsTabProps {
  groupId: string;
  currentUserId: string;
}

/**
 * Totals view: per-currency group spend and how much each member paid.
 * Built from the full expense list (settlements excluded — they move debt,
 * not spend).
 */
export function GroupTotalsTab({ groupId, currentUserId }: GroupTotalsTabProps) {
  const { colors } = useTheme();
  // Keyed under the ['expenses', ...] prefix so expense mutations/socket
  // events invalidate it per the CONTRACTS invalidation map.
  const { data, error, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['expenses', { groupId, view: 'totals' }],
    queryFn: () => fetchAllGroupExpenses(groupId),
    staleTime: 30_000,
  });

  const totals = useMemo<CurrencyTotal[]>(() => {
    if (!data) return [];
    const byCurrency = new Map<
      string,
      { total: number; count: number; members: Map<string, { user: PublicUserDto; paid: number }> }
    >();
    for (const expense of data) {
      let bucket = byCurrency.get(expense.currency);
      if (!bucket) {
        bucket = { total: 0, count: 0, members: new Map() };
        byCurrency.set(expense.currency, bucket);
      }
      bucket.total += expense.amount;
      bucket.count += 1;
      for (const payer of expense.payers) {
        const existing = bucket.members.get(payer.user.id);
        if (existing) {
          existing.paid += payer.amount;
        } else {
          bucket.members.set(payer.user.id, { user: payer.user, paid: payer.amount });
        }
      }
    }
    return [...byCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, bucket]) => ({
        currency,
        total: bucket.total,
        count: bucket.count,
        byMember: [...bucket.members.values()].sort((a, b) => b.paid - a.paid),
      }));
  }, [data]);

  if (isLoading) {
    return <SkeletonList rows={6} style={styles.skeleton} />;
  }
  if (isError || !data) {
    return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={colors.brand}
        />
      }
    >
      {totals.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="Nothing to total yet"
          hint="Totals appear once the group has expenses."
        />
      ) : (
        totals.map((t) => (
          <View key={t.currency}>
            <SectionHeader title={`${t.currency} TOTALS`} style={styles.section} />
            <Card style={styles.card}>
              <Text style={[styles.totalLabel, { color: colors.ink2 }]}>Total spent</Text>
              <Text style={[styles.totalValue, { color: colors.ink }]}>
                {formatMoney(t.total, t.currency)}
              </Text>
              <Text style={[styles.totalMeta, { color: colors.ink3 }]}>
                {t.count} {t.count === 1 ? 'expense' : 'expenses'}
              </Text>
              <View style={[styles.divider, { backgroundColor: colors.hairline }]} />
              {t.byMember.map((m) => (
                <View key={m.user.id} style={styles.memberRow}>
                  <Avatar name={m.user.name} color={m.user.avatarColor} size={30} />
                  <Text numberOfLines={1} style={[styles.memberName, { color: colors.ink }]}>
                    {m.user.id === currentUserId ? 'You' : m.user.name}
                  </Text>
                  <Text style={[styles.memberPaid, { color: colors.ink }]}>
                    {formatMoney(m.paid, t.currency)}
                  </Text>
                </View>
              ))}
              <Text style={[styles.paidNote, { color: colors.ink3 }]}>paid per member</Text>
            </Card>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  skeleton: {
    marginTop: spacing.lg,
  },
  section: {
    paddingTop: spacing.lg,
  },
  card: {
    marginBottom: spacing.sm,
  },
  totalLabel: {
    fontSize: fontSize.sm,
  },
  totalValue: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  totalMeta: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.md,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  memberName: {
    flex: 1,
    fontSize: fontSize.md,
    marginLeft: spacing.md,
  },
  memberPaid: {
    fontSize: fontSize.md,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  paidNote: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
});
