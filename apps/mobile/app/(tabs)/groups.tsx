import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { GroupSummaryDto } from '@divzy/shared';
import { EmptyState, ErrorState, FAB, Screen, SkeletonList } from '@/components/ui';
import { GroupCard } from '@/components/groups/GroupCard';
import { errorMessage, useGroups } from '@/lib/hooks';
import { fontSize, spacing, useTheme } from '@/theme';

type Row =
  | { kind: 'group'; group: GroupSummaryDto }
  | { kind: 'archived-header'; count: number };

export default function GroupsTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, error, isLoading, isError, isRefetching, refetch } = useGroups();
  const [showArchived, setShowArchived] = useState(false);

  const { rows, isEmpty } = useMemo(() => {
    const groups = data ?? [];
    const active = groups
      .filter((g) => g.archivedAt === null)
      .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
    const archived = groups
      .filter((g) => g.archivedAt !== null)
      .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));

    const out: Row[] = active.map((group) => ({ kind: 'group' as const, group }));
    if (archived.length > 0) {
      out.push({ kind: 'archived-header', count: archived.length });
      if (showArchived) {
        out.push(...archived.map((group) => ({ kind: 'group' as const, group })));
      }
    }
    return { rows: out, isEmpty: groups.length === 0 };
  }, [data, showArchived]);

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
              <Text style={[styles.archivedLabel, { color: colors.ink2 }]}>
                Archived ({item.count})
              </Text>
            </Pressable>
          )
        }
        ListHeaderComponent={
          <Text style={[styles.title, { color: colors.ink }]}>Groups</Text>
        }
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
  skeleton: {
    marginTop: spacing.sm,
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
