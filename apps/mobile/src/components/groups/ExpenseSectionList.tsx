import { useMemo, type ReactElement } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { format, parseISO } from 'date-fns';
import type { ExpenseDto } from '@divzy/shared';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui';
import { errorMessage, useExpensesInfinite, type ExpenseFilters } from '@/lib/hooks';
import { fontSize, spacing, useTheme } from '@/theme';
import { ExpenseRow } from './ExpenseRow';

type Row =
  | { kind: 'month'; key: string; label: string }
  | { kind: 'expense'; expense: ExpenseDto };

export interface ExpenseSectionListProps {
  filters: ExpenseFilters;
  currentUserId: string;
  /** Rendered above the list (and above the empty state). */
  header?: ReactElement | null;
  emptyEmoji?: string;
  emptyTitle?: string;
  emptyHint?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}

/**
 * Infinite expense list grouped under month headers ("July 2026"), with
 * pull-to-refresh, skeleton first load, error state and empty state.
 * Rows open the expense detail screen.
 */
export function ExpenseSectionList({
  filters,
  currentUserId,
  header = null,
  emptyEmoji = '🧾',
  emptyTitle = 'No expenses yet',
  emptyHint = 'Add an expense to start tracking who owes what.',
  emptyActionLabel,
  onEmptyAction,
}: ExpenseSectionListProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const {
    data,
    error,
    isLoading,
    isError,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useExpensesInfinite(filters);

  const rows = useMemo<Row[]>(() => {
    const expenses = data?.pages.flatMap((page) => page.items) ?? [];
    const out: Row[] = [];
    let currentMonth = '';
    for (const expense of expenses) {
      let monthKey: string;
      let monthLabel: string;
      try {
        const date = parseISO(expense.date);
        monthKey = format(date, 'yyyy-MM');
        monthLabel = format(date, 'MMMM yyyy');
      } catch {
        monthKey = 'unknown';
        monthLabel = 'Earlier';
      }
      if (monthKey !== currentMonth) {
        currentMonth = monthKey;
        out.push({ kind: 'month', key: `month-${monthKey}`, label: monthLabel });
      }
      out.push({ kind: 'expense', expense });
    }
    return out;
  }, [data]);

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => (row.kind === 'month' ? row.key : row.expense.id)}
      renderItem={({ item }) =>
        item.kind === 'month' ? (
          <Text style={[styles.monthHeader, { color: colors.ink2 }]}>{item.label}</Text>
        ) : (
          <ExpenseRow
            expense={item.expense}
            currentUserId={currentUserId}
            onPress={() => router.push(`/expense/${item.expense.id}`)}
          />
        )
      }
      ListHeaderComponent={header}
      ListEmptyComponent={
        isLoading ? (
          <SkeletonList rows={6} style={styles.skeleton} />
        ) : isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        ) : (
          <EmptyState
            emoji={emptyEmoji}
            title={emptyTitle}
            hint={emptyHint}
            actionLabel={emptyActionLabel}
            onAction={onEmptyAction}
          />
        )
      }
      ListFooterComponent={
        isFetchingNextPage ? (
          <View style={styles.footer}>
            <ActivityIndicator size="small" color={colors.ink3} />
          </View>
        ) : null
      }
      refreshControl={
        <RefreshControl
          refreshing={isRefetching && !isFetchingNextPage}
          onRefresh={() => void refetch()}
          tintColor={colors.brand}
        />
      }
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      }}
      onEndReachedThreshold={0.4}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  monthHeader: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    letterSpacing: 0.2,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  skeleton: {
    marginTop: spacing.lg,
  },
  footer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
