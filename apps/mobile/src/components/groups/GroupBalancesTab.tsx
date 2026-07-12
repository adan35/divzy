import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatMoney, type PublicUserDto } from '@divzy/shared';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  MoneyText,
  SectionHeader,
  SkeletonList,
} from '@/components/ui';
import { errorMessage, useGroupBalances } from '@/lib/hooks';
import { fontSize, spacing, useTheme } from '@/theme';

export interface GroupBalancesTabProps {
  groupId: string;
  /** When on, show the minimal transfer set; when off, exact pairwise debts. */
  simplifyDebts: boolean;
  currentUserId: string;
}

interface TransferRow {
  key: string;
  from: PublicUserDto;
  to: PublicUserDto;
  amount: number;
  currency: string;
}

/**
 * Balances view of a group: each member's net position per currency, then
 * the payment list (suggested settlements or exact pairwise debts) with a
 * one-tap "Record" that prefills the settle screen.
 */
export function GroupBalancesTab({ groupId, simplifyDebts, currentUserId }: GroupBalancesTabProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, error, isLoading, isError, isRefetching, refetch } = useGroupBalances(groupId);

  if (isLoading) {
    return <SkeletonList rows={6} style={styles.skeleton} />;
  }
  if (isError || !data) {
    return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  }

  const transfers: TransferRow[] = (simplifyDebts ? data.suggestions : data.pairwise).map(
    (t, index) => ({
      key: `${t.currency}-${t.from.id}-${t.to.id}-${index}`,
      from: t.from,
      to: t.to,
      amount: t.amount,
      currency: t.currency,
    }),
  );

  const allSettled =
    transfers.length === 0 && data.members.every((m) => m.balances.every((b) => b.amount === 0));

  const displayName = (user: PublicUserDto, capitalized: boolean) =>
    user.id === currentUserId ? (capitalized ? 'You' : 'you') : user.name;

  const recordTransfer = (t: TransferRow) => {
    router.push({
      pathname: '/settle',
      params: {
        groupId,
        fromUserId: t.from.id,
        toUserId: t.to.id,
        amount: String(t.amount),
        currency: t.currency,
      },
    });
  };

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
      {allSettled ? (
        <EmptyState
          emoji="🎉"
          title="All settled up"
          hint="No one owes anything in this group."
        />
      ) : (
        <>
          <SectionHeader title="MEMBER BALANCES" style={styles.firstSection} />
          <Card padded={false} style={styles.card}>
            {data.members.map((member, index) => {
              const nonZero = member.balances.filter((b) => b.amount !== 0);
              return (
                <View
                  key={member.user.id}
                  style={[
                    styles.memberRow,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
                  ]}
                >
                  <Avatar name={member.user.name} color={member.user.avatarColor} size={36} />
                  <Text numberOfLines={1} style={[styles.memberName, { color: colors.ink }]}>
                    {displayName(member.user, true)}
                  </Text>
                  <View style={styles.memberBalances}>
                    {nonZero.length === 0 ? (
                      <Text style={[styles.settledText, { color: colors.ink3 }]}>settled up</Text>
                    ) : (
                      nonZero.map((b) => (
                        <MoneyText
                          key={b.currency}
                          amount={b.amount}
                          currency={b.currency}
                          signed
                          size={fontSize.sm}
                        />
                      ))
                    )}
                  </View>
                </View>
              );
            })}
          </Card>

          {transfers.length > 0 ? (
            <>
              <SectionHeader
                title={simplifyDebts ? 'SUGGESTED PAYMENTS' : 'WHO OWES WHOM'}
              />
              {transfers.map((t) => {
                const fromName = displayName(t.from, true);
                const toName = displayName(t.to, false);
                return (
                  <Card key={t.key} style={styles.transferCard}>
                    <View style={styles.transferRow}>
                      <View style={styles.transferBody}>
                        <Text style={[styles.transferText, { color: colors.ink }]}>
                          {fromName} {t.from.id === currentUserId ? 'pay' : 'pays'} {toName}
                        </Text>
                        <Text style={[styles.transferAmount, { color: colors.ink }]}>
                          {formatMoney(t.amount, t.currency)}
                        </Text>
                      </View>
                      <Button
                        title="Record"
                        size="sm"
                        variant="secondary"
                        icon="checkmark"
                        onPress={() => recordTransfer(t)}
                      />
                    </View>
                  </Card>
                );
              })}
              {simplifyDebts ? (
                <Text style={[styles.note, { color: colors.ink3 }]}>
                  Debts are simplified to the fewest payments that settle everyone.
                </Text>
              ) : null}
            </>
          ) : null}
        </>
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
  firstSection: {
    paddingTop: spacing.lg,
  },
  card: {
    paddingHorizontal: spacing.lg,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  memberName: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '500',
    marginLeft: spacing.md,
  },
  memberBalances: {
    alignItems: 'flex-end',
    marginLeft: spacing.md,
  },
  settledText: {
    fontSize: fontSize.sm,
  },
  transferCard: {
    marginBottom: spacing.md,
  },
  transferRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transferBody: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.md,
  },
  transferText: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  transferAmount: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  note: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
});
