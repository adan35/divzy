import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { PublicUserDto } from '@divzy/shared';
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
import { ManualRatePromptDialog } from '@/components/settle/ManualRatePromptDialog';
import { collectUnresolvedCurrencies } from '@/lib/convertedBalance';
import { errorMessage, useGroupBalances, useManualRatePrompt, useUpdateGroup } from '@/lib/hooks';
import { beforeAfterComparison, canRecordSuggestion } from '@/lib/settlements';
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
  const updateGroup = useUpdateGroup();

  // WI-013 — local optimistic mirror of the persisted `Group.simplifyDebts`
  // (spec-WI-013 "Toggle state & persistence"). Synced from the prop
  // whenever it's not mid-flight so the parent's own `useGroup` refetch (or
  // an edit made elsewhere, e.g. the group-form screen) stays authoritative;
  // while a toggle is pending, the optimistic value wins so the flip doesn't
  // visibly bounce back before the mutation resolves.
  const [localSimplify, setLocalSimplify] = useState(simplifyDebts);
  const [toggleError, setToggleError] = useState<string | null>(null);
  useEffect(() => {
    if (updateGroup.isPending) return;
    setLocalSimplify(simplifyDebts);
  }, [simplifyDebts, updateGroup.isPending]);

  // Hooks must run unconditionally (before the loading/error early returns).
  const unresolvedCurrencies = useMemo(
    () => (data ? collectUnresolvedCurrencies(data.members) : []),
    [data],
  );
  const { prompt: ratePrompt, dismiss: dismissRatePrompt } = useManualRatePrompt(
    unresolvedCurrencies,
    data?.viewerCurrency ?? null,
  );

  if (isLoading) {
    return <SkeletonList rows={6} style={styles.skeleton} />;
  }
  if (isError || !data) {
    return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  }

  const transfers: TransferRow[] = (localSimplify ? data.suggestions : data.pairwise).map(
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

  // WI-013 — "N payments -> M payments", always visible near the toggle
  // regardless of toggle position (spec-WI-013 "Before/after comparison");
  // `null` when the group is fully settled (no misleading badge).
  const comparison = beforeAfterComparison(data.pairwise.length, data.suggestions.length);

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

  // WI-013 — optimistic flip + PATCH /groups/:groupId {simplifyDebts}; on
  // failure, revert the optimistic flip and surface the message (existing
  // `errorMessage` pattern, spec-WI-013 "Toggle state & persistence"). Never
  // mutates any Expense/Payer/Split/Settlement row — only `Group.simplifyDebts`.
  const handleToggleSimplify = (next: boolean) => {
    setToggleError(null);
    setLocalSimplify(next);
    updateGroup.mutate(
      { groupId, input: { simplifyDebts: next } },
      {
        onError: (err) => {
          setLocalSimplify(!next);
          setToggleError(errorMessage(err));
        },
      },
    );
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
      <Card style={[styles.controlsCard, styles.firstSection]}>
        <View style={styles.simplifyRow}>
          <View style={styles.simplifyBody}>
            <Text style={[styles.simplifyTitle, { color: colors.ink }]}>Simplify debts</Text>
            <Text style={[styles.simplifyHint, { color: colors.ink3 }]}>
              Combine debts so the group settles with the fewest payments
            </Text>
          </View>
          <Switch
            accessibilityLabel="Simplify debts"
            value={localSimplify}
            onValueChange={handleToggleSimplify}
            disabled={updateGroup.isPending}
            trackColor={{ false: colors.surface2, true: colors.brand }}
            thumbColor={colors.onBrand}
          />
        </View>
        {comparison ? (
          <Text style={[styles.comparisonText, { color: colors.ink3 }]}>
            {comparison.before} {comparison.before === 1 ? 'payment' : 'payments'} →{' '}
            {comparison.after} {comparison.after === 1 ? 'payment' : 'payments'}
          </Text>
        ) : null}
        {toggleError ? (
          <Text style={[styles.toggleErrorText, { color: colors.danger }]}>{toggleError}</Text>
        ) : null}
      </Card>

      {allSettled ? (
        <EmptyState
          emoji="🎉"
          title="All settled up"
          hint="No one owes anything in this group."
        />
      ) : (
        <>
          <SectionHeader title="MEMBER BALANCES" />
          <Card padded={false} style={styles.card}>
            {data.members.map((member, index) => {
              const nonZero = member.balances.filter((b) => b.amount !== 0);
              // `convertedNet` is present exactly when balances.length > 0
              // (spec-WI-001) — a settled member keeps the plain "settled
              // up" string, never a special-cased "0.00" line.
              const convertedNet = member.convertedNet;
              return (
                <View
                  key={member.user.id}
                  style={[
                    styles.memberRow,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
                  ]}
                >
                  <Avatar
                    name={member.user.name}
                    color={member.user.avatarColor}
                    avatarUrl={member.user.avatarUrl}
                    size={36}
                  />
                  <Text numberOfLines={1} style={[styles.memberName, { color: colors.ink }]}>
                    {displayName(member.user, true)}
                  </Text>
                  <View style={styles.memberBalances}>
                    {nonZero.length === 0 ? (
                      <Text style={[styles.settledText, { color: colors.ink3 }]}>settled up</Text>
                    ) : convertedNet ? (
                      <>
                        <MoneyText
                          amount={convertedNet.amount}
                          currency={data.viewerCurrency}
                          signed
                          size={fontSize.sm}
                        />
                        {convertedNet.unresolved.map((u) => (
                          <View key={u.currency} style={styles.unresolvedRow}>
                            <MoneyText
                              amount={u.amount}
                              currency={u.currency}
                              colored={false}
                              size={fontSize.xs}
                              weight="500"
                              style={{ color: colors.ink3 }}
                            />
                            <Text style={[styles.unresolvedText, { color: colors.ink3 }]}>
                              {' '}
                              (unconverted)
                            </Text>
                          </View>
                        ))}
                      </>
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
                title={localSimplify ? 'SUGGESTED PAYMENTS' : 'WHO OWES WHOM'}
              />
              {transfers.map((t) => {
                const fromName = displayName(t.from, true);
                const toName = displayName(t.to, false);
                // WI-004/ADR-004 — disabled (not hidden) for suggestions the
                // viewer isn't a party to; server's 403 stays the real gate.
                const canRecord = canRecordSuggestion(currentUserId, t.from.id, t.to.id);
                return (
                  <Card key={t.key} style={styles.transferCard}>
                    <View style={styles.transferRow}>
                      <View style={styles.transferBody}>
                        <Text style={[styles.transferText, { color: colors.ink }]}>
                          {fromName} {t.from.id === currentUserId ? 'pay' : 'pays'} {toName}
                        </Text>
                        <MoneyText
                          amount={t.amount}
                          currency={t.currency}
                          colored={false}
                          size={fontSize.lg}
                          weight="700"
                          style={styles.transferAmount}
                        />
                      </View>
                      <Button
                        title="Record"
                        size="sm"
                        variant="secondary"
                        icon="checkmark"
                        disabled={!canRecord}
                        onPress={() => recordTransfer(t)}
                      />
                    </View>
                  </Card>
                );
              })}
              {localSimplify ? (
                <Text style={[styles.note, { color: colors.ink3 }]}>
                  Debts are simplified to the fewest payments that settle everyone.
                </Text>
              ) : null}
            </>
          ) : null}
        </>
      )}
      <ManualRatePromptDialog prompt={ratePrompt} onClose={dismissRatePrompt} />
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
    marginTop: spacing.lg,
  },
  card: {
    paddingHorizontal: spacing.lg,
  },
  controlsCard: {
    gap: spacing.xs,
  },
  simplifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  simplifyBody: {
    flex: 1,
    minWidth: 0,
  },
  simplifyTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  simplifyHint: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  comparisonText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  toggleErrorText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
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
  unresolvedRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },
  unresolvedText: {
    fontSize: fontSize.xs,
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
    marginTop: 2,
  },
  note: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
});
