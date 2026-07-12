import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, ErrorState, Screen, SkeletonList } from '@/components/ui';
import { FriendRow } from '@/components/friends/FriendRow';
import { AddFriendModal } from '@/components/friends/AddFriendModal';
import { errorMessage, useFriends } from '@/lib/hooks';
import { fontSize, spacing, useTheme } from '@/theme';

export default function FriendsTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, error, isLoading, isError, isRefetching, refetch } = useFriends();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Screen>
      <FlatList
        data={data ?? []}
        keyExtractor={(friend) => friend.user.id}
        renderItem={({ item }) => (
          <FriendRow friend={item} onPress={() => router.push(`/friend/${item.user.id}`)} />
        )}
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.ink }]}>Friends</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add friend"
              onPress={() => setAddOpen(true)}
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
        }
        ListEmptyComponent={
          isLoading ? (
            <SkeletonList rows={7} style={styles.skeleton} />
          ) : isError ? (
            <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
          ) : (
            <EmptyState
              emoji="👥"
              title="No friends yet"
              hint="Add friends by email to split expenses outside of groups."
              actionLabel="Add a friend"
              onAction={() => setAddOpen(true)}
            />
          )
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
});
