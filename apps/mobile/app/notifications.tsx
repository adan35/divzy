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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { NotificationDto } from '@divzy/shared';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import {
  errorMessage,
  useClearAllNotifications,
  useClearNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsList,
} from '@/lib/hooks';
import { canClearAllNotifications } from '@/lib/notificationHeaderActions';
import { fontSize, radii, spacing, useTheme } from '@/theme';

function dataString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Notification center: unread markers, tap-through navigation, mark-all-read. */
export default function NotificationsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const listQuery = useNotificationsList();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const clearNotification = useClearNotification();
  const clearAll = useClearAllNotifications();

  const notifications = useMemo(
    () => (listQuery.data?.pages ?? []).flatMap((page) => page.items),
    [listQuery.data],
  );
  const hasUnread = notifications.some((n) => n.readAt === null);

  const openNotification = (notification: NotificationDto) => {
    if (notification.readAt === null) {
      markRead.mutate(notification.id);
    }
    const expenseId = dataString(notification.data, 'expenseId');
    const groupId = dataString(notification.data, 'groupId');
    if (expenseId) {
      router.push({ pathname: '/expense/[id]', params: { id: expenseId } });
    } else if (groupId) {
      router.push({ pathname: '/group/[id]', params: { id: groupId } });
    }
  };

  // WI-056 — clear is independent of the row's own tap-to-mark-read+navigate:
  // this is its own Pressable nested inside the row's, so RN's responder
  // negotiation gives it the touch first and `openNotification` never fires
  // for a clear tap (no mark-read, no navigation — spec-WI-056 §4).
  const handleClear = (notification: NotificationDto) => {
    if (clearNotification.isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    clearNotification.mutate(notification.id);
  };

  const handleMarkAll = () => {
    if (!hasUnread || markAllRead.isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    markAllRead.mutate(undefined, {
      onSuccess: () =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => undefined,
        ),
    });
  };

  // WI-065 — independent of hasUnread: an all-read-but-uncleared list must
  // still be clearable (see canClearAllNotifications).
  const handleClearAll = () => {
    if (!canClearAllNotifications(notifications.length, clearAll.isPending)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    clearAll.mutate(undefined, {
      onSuccess: () =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => undefined,
        ),
    });
  };

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.page }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>Notifications</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mark all notifications as read"
          disabled={!hasUnread || markAllRead.isPending}
          onPress={handleMarkAll}
          hitSlop={8}
        >
          {({ pressed }) => (
            <Text
              style={[
                styles.markAll,
                {
                  color:
                    !hasUnread || markAllRead.isPending
                      ? colors.ink3
                      : pressed
                        ? colors.brandHover
                        : colors.brand,
                },
              ]}
            >
              Mark all read
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear all notifications"
          disabled={!canClearAllNotifications(notifications.length, clearAll.isPending)}
          onPress={handleClearAll}
          hitSlop={8}
        >
          {({ pressed }) => (
            <Text
              style={[
                styles.markAll,
                {
                  color: !canClearAllNotifications(notifications.length, clearAll.isPending)
                    ? colors.ink3
                    : pressed
                      ? colors.ink
                      : colors.ink2,
                },
              ]}
            >
              Clear all
            </Text>
          )}
        </Pressable>
      </View>

      {listQuery.isLoading ? (
        <SkeletonList rows={8} avatar={false} style={styles.gutters} />
      ) : listQuery.isError ? (
        <ErrorState
          message={errorMessage(listQuery.error)}
          onRetry={() => void listQuery.refetch()}
        />
      ) : notifications.length === 0 ? (
        <EmptyState
          emoji="🔔"
          title="You are all caught up"
          hint="New activity on your expenses and groups shows up here."
        />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={listQuery.isRefetching && !listQuery.isFetchingNextPage}
              onRefresh={() => void listQuery.refetch()}
              tintColor={colors.ink3}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
              void listQuery.fetchNextPage();
            }
          }}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
          )}
          ListFooterComponent={
            listQuery.isFetchingNextPage ? (
              <ActivityIndicator
                size="small"
                color={colors.ink3}
                style={styles.footerSpinner}
              />
            ) : null
          }
          renderItem={({ item }) => {
            const unread = item.readAt === null;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${unread ? 'Unread: ' : ''}${item.title}`}
                onPress={() => openNotification(item)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: colors.surface2 },
                ]}
              >
                <View style={styles.dotColumn}>
                  {unread ? (
                    <View style={[styles.unreadDot, { backgroundColor: colors.brand }]} />
                  ) : null}
                </View>
                <View style={styles.rowBody}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.rowTitle,
                      { color: colors.ink, fontWeight: unread ? '700' : '600' },
                    ]}
                  >
                    {item.title}
                  </Text>
                  <Text numberOfLines={2} style={[styles.rowText, { color: colors.ink2 }]}>
                    {item.body}
                  </Text>
                  <Text style={[styles.rowTime, { color: colors.ink3 }]}>
                    {formatRelative(item.createdAt)}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear notification"
                  onPress={() => handleClear(item)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.clearButton,
                    { backgroundColor: pressed ? colors.surface2 : 'transparent' },
                  ]}
                >
                  <Ionicons name="close" size={16} color={colors.ink3} />
                </Pressable>
                <Ionicons name="chevron-forward" size={16} color={colors.ink3} />
              </Pressable>
            );
          }}
        />
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  backButton: {
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
  markAll: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    paddingHorizontal: spacing.sm,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.lg + 18,
  },
  footerSpinner: {
    paddingVertical: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderRadius: radii.md,
  },
  dotColumn: {
    width: 10,
    alignItems: 'center',
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: fontSize.md,
  },
  rowText: {
    fontSize: fontSize.sm,
    marginTop: 1,
    lineHeight: 18,
  },
  rowTime: {
    fontSize: fontSize.xs,
    marginTop: 3,
  },
});
