import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { BalanceFilter } from '@divzy/shared';
import { EmptyState, ErrorState, Screen, SegmentedControl, SkeletonList } from '@/components/ui';
import { FriendRow } from '@/components/friends/FriendRow';
import { FriendsBalanceSummary } from '@/components/friends/FriendsBalanceSummary';
import { AddFriendModal } from '@/components/friends/AddFriendModal';
import { applyFriendsFilter, friendsFilterEmptyMessage } from '@/lib/friendsListFilter';
import { errorMessage, useFriends } from '@/lib/hooks';
import { fontSize, spacing, useTheme } from '@/theme';

const BALANCE_FILTER_OPTIONS: ReadonlyArray<{ label: string; value: BalanceFilter }> = [
  { label: 'All', value: 'none' },
  { label: 'Outstanding', value: 'outstanding' },
  { label: 'You owe', value: 'youOwe' },
  { label: 'Owed you', value: 'owedYou' },
];

export default function FriendsTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, error, isLoading, isError, isRefetching, refetch } = useFriends();
  const [addOpen, setAddOpen] = useState(false);
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('none');

  const friends = data ?? [];
  const filtered = useMemo(
    () => applyFriendsFilter(friends, balanceFilter),
    [friends, balanceFilter],
  );
  const isFilteredEmpty = friends.length > 0 && filtered.length === 0;

  return (
    <Screen>
      <FlatList
        data={filtered}
        keyExtractor={(friend) => friend.user.id}
        renderItem={({ item }) => (
          <FriendRow friend={item} onPress={() => router.push(`/friend/${item.user.id}`)} />
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <Text style={[styles.title, { color: colors.ink }]}>Friends</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add friend"
                onPress={() => setAddOpen(true)}
                // WI-068 §12 — 38pt box + hitSlop clears the 44pt touch floor.
                hitSlop={4}
                style={({ pressed }) => [
                  styles.addButton,
                  {
                    backgroundColor: pressed ? colors.surface2 : colors.surface,
                    borderColor: colors.hairline,
                  },
                ]}
              >
                <Ionicons name="person-add-outline" size={19} color={colors.brand} />
              </Pressable>
            </View>
            {friends.length > 0 ? (
              <>
                {/*
                  WI-049 — always computed from the full unfiltered `friends`
                  array (never `filtered`), so the WI-037 balance-direction
                  filter below never affects these totals (spec-WI-049 §2.2).
                */}
                <FriendsBalanceSummary friends={friends} />
                <SegmentedControl<BalanceFilter>
                  options={BALANCE_FILTER_OPTIONS}
                  value={balanceFilter}
                  onChange={setBalanceFilter}
                  style={styles.filterControl}
                />
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <SkeletonList rows={7} style={styles.skeleton} />
          ) : isError ? (
            <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
          ) : friends.length === 0 ? (
            <EmptyState
              emoji="👥"
              title="No friends yet"
              hint="Add friends by email to split expenses outside of groups."
              actionLabel="Add a friend"
              onAction={() => setAddOpen(true)}
            />
          ) : isFilteredEmpty ? (
            <Text style={[styles.filteredEmpty, { color: colors.ink3 }]}>
              {friendsFilterEmptyMessage(balanceFilter)}
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
      <AddFriendModal visible={addOpen} onClose={() => setAddOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
  },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeleton: {
    marginTop: spacing.sm,
  },
  filterControl: {
    marginBottom: spacing.lg,
  },
  filteredEmpty: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    paddingVertical: spacing.xl,
  },
});
