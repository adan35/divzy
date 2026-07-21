import { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import type { ActivityDto } from '@divzy/shared';
import { EmptyState, ErrorState, Screen, SectionHeader, SkeletonList } from '@/components/ui';
import { ActivityRow } from '@/components/groups/ActivityRow';
import { useAuth } from '@/lib/auth';
import { errorMessage, useActivityInfinite } from '@/lib/hooks';
import { fontSize, spacing, useTheme } from '@/theme';

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'activity'; activity: ActivityDto };

function dayLabel(iso: string): { key: string; label: string } {
  try {
    const date = parseISO(iso);
    const key = format(date, 'yyyy-MM-dd');
    if (isToday(date)) return { key, label: 'Today' };
    if (isYesterday(date)) return { key, label: 'Yesterday' };
    return {
      key,
      label: format(date, date.getFullYear() === new Date().getFullYear() ? 'EEEE, MMM d' : 'MMM d, yyyy'),
    };
  } catch {
    return { key: 'unknown', label: 'Earlier' };
  }
}

export default function ActivityScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();

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
  } = useActivityInfinite(null);

  const rows = useMemo<Row[]>(() => {
    const items = data?.pages.flatMap((page) => page.items) ?? [];
    const out: Row[] = [];
    let currentDay = '';
    for (const activity of items) {
      const { key, label } = dayLabel(activity.createdAt);
      if (key !== currentDay) {
        currentDay = key;
        out.push({ kind: 'day', key: `day-${key}`, label });
      }
      out.push({ kind: 'activity', activity });
    }
    return out;
  }, [data]);

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>Activity</Text>
        <View style={styles.headerButton} />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => (row.kind === 'day' ? row.key : row.activity.id)}
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            // WI-068 §9.2 — day separators styled as section labels
            // (uppercase, ink3, 12/600 tracking) rather than a bespoke style.
            <SectionHeader title={item.label} />
          ) : (
            <ActivityRow activity={item.activity} currentUserId={user?.id} />
          )
        }
        ListEmptyComponent={
          isLoading ? (
            <SkeletonList rows={8} style={styles.skeleton} />
          ) : isError ? (
            <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
          ) : (
            <EmptyState
              emoji="📣"
              title="No activity yet"
              hint="Expenses, payments and group changes will show up here."
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
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
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
    textAlign: 'center',
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  content: {
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  skeleton: {
    marginTop: spacing.lg,
  },
  footer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
