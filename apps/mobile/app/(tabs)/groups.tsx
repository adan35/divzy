import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import type { BalanceFilter, GroupSummaryDto } from '@divzy/shared';
import {
  EmptyState,
  ErrorState,
  FAB,
  Screen,
  SegmentedControl,
  SkeletonList,
} from '@/components/ui';
import { GroupCard } from '@/components/groups/GroupCard';
import { GroupSpendChart } from '@/components/groups/GroupSpendChart';
import { applyGroupFilters, groupsFilterEmptyMessage, splitArchived } from '@/lib/groupsListFilter';
import { errorMessage, useGroups, useUnarchiveGroup } from '@/lib/hooks';
import { fontSize, spacing, useTheme } from '@/theme';

type Row =
  | { kind: 'group'; group: GroupSummaryDto }
  | { kind: 'archived-header'; count: number };

const BALANCE_FILTER_OPTIONS: ReadonlyArray<{ label: string; value: BalanceFilter }> = [
  { label: 'All', value: 'none' },
  { label: 'Outstanding', value: 'outstanding' },
  { label: 'You owe', value: 'youOwe' },
  { label: 'Owed you', value: 'owedYou' },
];

// WI-028 — local device persistence (localStorage's mobile equivalent);
// deliberately no server-persisted preference (spec's explicit boundary
// choice — no auth dependency, no migration).
const UNSETTLED_ONLY_KEY = 'divzy.groups.unsettledOnly';

export default function GroupsTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, error, isLoading, isError, isRefetching, refetch } = useGroups();
  const unarchiveGroup = useUnarchiveGroup();
  const [showArchived, setShowArchived] = useState(false);
  const [unsettledOnly, setUnsettledOnly] = useState(false);
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('none');

  useEffect(() => {
    AsyncStorage.getItem(UNSETTLED_ONLY_KEY)
      .then((stored) => {
        if (stored === 'true') setUnsettledOnly(true);
      })
      .catch(() => undefined);
  }, []);

  const toggleUnsettledOnly = (value: boolean) => {
    setUnsettledOnly(value);
    AsyncStorage.setItem(UNSETTLED_ONLY_KEY, value ? 'true' : 'false').catch(() => undefined);
  };

  const { rows, isEmpty, isFilteredEmpty } = useMemo(() => {
    const groups = data ?? [];
    const filtered = applyGroupFilters(groups, { unsettledOnly, balanceFilter });
    const { active, archived } = splitArchived(filtered);

    const out: Row[] = active.map((group) => ({ kind: 'group' as const, group }));
    if (archived.length > 0) {
      out.push({ kind: 'archived-header', count: archived.length });
      if (showArchived) {
        out.push(...archived.map((group) => ({ kind: 'group' as const, group })));
      }
    }
    return {
      rows: out,
      isEmpty: groups.length === 0,
      isFilteredEmpty: groups.length > 0 && filtered.length === 0,
    };
  }, [data, showArchived, unsettledOnly, balanceFilter]);

  return (
    <Screen>
      <FlatList
        data={rows}
        keyExtractor={(row) => (row.kind === 'group' ? row.group.id : 'archived-header')}
        renderItem={({ item }) =>
          item.kind === 'group' ? (
            <GroupCard
              group={item.group}
              onPress={() => router.push(`/group/${item.group.id}`)}
              onUnarchive={
                item.group.archivedAt !== null
                  ? () => {
                      unarchiveGroup.mutate(item.group.id, {
                        onSuccess: () =>
                          Haptics.notificationAsync(
                            Haptics.NotificationFeedbackType.Success,
                          ).catch(() => undefined),
                      });
                    }
                  : undefined
              }
              unarchiving={
                unarchiveGroup.isPending && unarchiveGroup.variables === item.group.id
              }
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showArchived }}
              onPress={() => setShowArchived((v) => !v)}
              style={({ pressed }) => [styles.archivedToggle, pressed && styles.pressed]}
            >
              <Ionicons
                name={showArchived ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color={colors.ink3}
              />
              <Text style={[styles.archivedLabel, { color: colors.ink3 }]}>
                Archived ({item.count})
              </Text>
            </Pressable>
          )
        }
        ListHeaderComponent={
          <View>
            <Text style={[styles.title, { color: colors.ink }]}>Groups</Text>
            <SegmentedControl<BalanceFilter>
              options={BALANCE_FILTER_OPTIONS}
              value={balanceFilter}
              onChange={setBalanceFilter}
              style={styles.filterControl}
            />
            <View style={styles.unsettledRow}>
              <Text style={[styles.unsettledLabel, { color: colors.ink2 }]}>
                Unsettled only
              </Text>
              <Switch
                value={unsettledOnly}
                onValueChange={toggleUnsettledOnly}
                trackColor={{ false: colors.surface2, true: colors.brand }}
                thumbColor={colors.onBrand}
              />
            </View>
          </View>
        }
        ListFooterComponent={<GroupSpendChart style={styles.spendChart} />}
        ListEmptyComponent={
          isLoading ? (
            <SkeletonList rows={6} style={styles.skeleton} />
          ) : isError ? (
            <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
          ) : isEmpty ? (
            <EmptyState
              emoji="✈️"
              title="No groups yet"
              hint="Create a group for your trip, home or friends to split expenses together."
              actionLabel="Create a group"
              onAction={() => router.push('/group-form')}
            />
          ) : isFilteredEmpty ? (
            <Text style={[styles.filteredEmpty, { color: colors.ink3 }]}>
              {groupsFilterEmptyMessage(balanceFilter, unsettledOnly)}
            </Text>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={() => void refetch()}
            tintColor={colors.brand}
          />
        }
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      />
      <FAB onPress={() => router.push('/group-form')} accessibilityLabel="New group" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 96,
    flexGrow: 1,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  filterControl: {
    marginBottom: spacing.md,
  },
  unsettledRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.lg,
  },
  unsettledLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  spendChart: {
    marginTop: spacing.lg,
  },
  skeleton: {
    marginTop: spacing.sm,
  },
  filteredEmpty: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    paddingVertical: spacing.xl,
  },
  archivedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  archivedLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginLeft: spacing.xs,
  },
});
