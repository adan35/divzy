import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import {
  categoryInfo,
  formatMoney,
  LIMITS,
  type ExpenseDto,
  type ExpenseSplitDto,
} from '@divzy/shared';
import { Avatar, Badge, Button, Card, ErrorState, Skeleton, SkeletonList } from '@/components/ui';
import { InlineError } from '@/components/expense-editor';
import { apiUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateFull, formatRelative } from '@/lib/format';
import {
  errorMessage,
  useAddComment,
  useComments,
  useDeleteExpense,
  useExpense,
} from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

const SPLIT_TYPE_LABELS: Record<ExpenseDto['splitType'], string> = {
  EQUAL: 'Split equally',
  EXACT: 'Exact amounts',
  PERCENT: 'By percentage',
  SHARES: 'By shares',
  ADJUSTMENT: 'With adjustments',
  ITEMIZED: 'Itemized',
};

function splitDetail(expense: ExpenseDto, split: ExpenseSplitDto): string | null {
  switch (expense.splitType) {
    case 'PERCENT':
      return split.percentBps !== null ? `${(split.percentBps / 100).toFixed(split.percentBps % 100 === 0 ? 0 : 2)}%` : null;
    case 'SHARES':
      return split.shares !== null
        ? `${split.shares} ${split.shares === 1 ? 'share' : 'shares'}`
        : null;
    case 'ADJUSTMENT':
      return split.adjustment !== null && split.adjustment !== 0
        ? `${split.adjustment > 0 ? '+' : '−'}${formatMoney(Math.abs(split.adjustment), expense.currency)} adjustment`
        : null;
    default:
      return null;
  }
}

/** Expense detail: full breakdown, receipt, notes, and comments. */
export default function ExpenseDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user: me } = useAuth();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const expenseId = firstParam(params.id);

  const expenseQuery = useExpense(expenseId, expenseId.length > 0);
  const commentsQuery = useComments(expenseId, expenseId.length > 0);
  const addComment = useAddComment();
  const deleteExpense = useDeleteExpense();
  const [commentText, setCommentText] = useState('');

  const expense = expenseQuery.data;
  const isDeleted = !!expense?.deletedAt;

  const nameOf = (userId: string, fallback: string): string =>
    me && userId === me.id ? 'You' : fallback;

  const confirmDelete = () => {
    if (!expense) return;
    Alert.alert(
      'Delete expense?',
      `“${expense.description}” will be removed from everyone's balances.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteExpense.mutate(
              { expenseId: expense.id, groupId: expense.groupId },
              {
                onSuccess: () => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                    () => undefined,
                  );
                  router.back();
                },
                onError: (err) => Alert.alert('Could not delete', errorMessage(err)),
              },
            ),
        },
      ],
    );
  };

  const submitComment = () => {
    const body = commentText.trim();
    if (!body || !expense || addComment.isPending) return;
    addComment.mutate(
      { expenseId: expense.id, body },
      {
        onSuccess: () => {
          setCommentText('');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
        },
      },
    );
  };

  const category = expense ? categoryInfo(expense.category) : null;
  const receiptIsPdf = !!expense?.receiptUrl && /\.pdf(\?.*)?$/i.test(expense.receiptUrl);
  const itemsTotal = expense?.items.reduce((acc, item) => acc + item.amount, 0) ?? 0;
  const taxTip = expense ? expense.amount - itemsTotal : 0;

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.page }]}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerButton,
              { backgroundColor: pressed ? colors.surface2 : 'transparent' },
            ]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.ink }]}>Expense</Text>
          <View style={styles.headerActions}>
            {expense && !isDeleted ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit expense"
                  onPress={() =>
                    router.push({ pathname: '/expense/new', params: { expenseId: expense.id } })
                  }
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.headerButton,
                    { backgroundColor: pressed ? colors.surface2 : 'transparent' },
                  ]}
                >
                  <Ionicons name="pencil-outline" size={20} color={colors.ink2} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete expense"
                  disabled={deleteExpense.isPending}
                  onPress={confirmDelete}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.headerButton,
                    {
                      backgroundColor: pressed ? colors.surface2 : 'transparent',
                      opacity: deleteExpense.isPending ? 0.4 : 1,
                    },
                  ]}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
              </>
            ) : null}
          </View>
        </View>

        {expenseQuery.isLoading ? (
          <View style={styles.gutters}>
            <View style={styles.heroSkeleton}>
              <Skeleton width={56} height={56} radius={28} />
              <Skeleton width="60%" height={22} style={styles.skeletonGap} />
              <Skeleton width={120} height={30} style={styles.skeletonGap} />
            </View>
            <SkeletonList rows={4} />
          </View>
        ) : expenseQuery.isError || !expense ? (
          <ErrorState
            message={errorMessage(expenseQuery.error)}
            onRetry={() => void expenseQuery.refetch()}
          />
        ) : (
          <>
            <ScrollView
              style={styles.root}
              contentContainerStyle={[styles.gutters, styles.content]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={expenseQuery.isRefetching || commentsQuery.isRefetching}
                  onRefresh={() => {
                    void expenseQuery.refetch();
                    void commentsQuery.refetch();
                  }}
                  tintColor={colors.ink3}
                />
              }
            >
              {isDeleted ? (
                <View style={[styles.deletedBanner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  <Text style={[styles.deletedText, { color: colors.danger }]}>
                    This expense was deleted.
                  </Text>
                </View>
              ) : null}

              {/* Hero */}
              <View style={styles.hero}>
                <View style={[styles.heroEmoji, { backgroundColor: colors.surface2 }]}>
                  <Text style={styles.heroEmojiText}>{category?.emoji}</Text>
                </View>
                <Text style={[styles.heroDescription, { color: colors.ink }]}>
                  {expense.description}
                </Text>
                <Text style={[styles.heroAmount, { color: colors.ink }]}>
                  {formatMoney(expense.amount, expense.currency)}
                </Text>
                <Text style={[styles.heroMeta, { color: colors.ink3 }]}>
                  {category?.label} · {formatDateFull(expense.date)}
                  {expense.group ? ` · ${expense.group.emoji} ${expense.group.name}` : ''}
                </Text>
                <Badge label={SPLIT_TYPE_LABELS[expense.splitType]} tone="neutral" style={styles.heroBadge} />
              </View>

              {/* Payers */}
              <Card padded={false} style={styles.sectionCard}>
                <Text style={[styles.sectionTitle, { color: colors.ink3 }]}>PAID BY</Text>
                {expense.payers.map((payer) => (
                  <View key={payer.user.id} style={styles.personRow}>
                    <Avatar name={payer.user.name} color={payer.user.avatarColor} size={32} />
                    <Text numberOfLines={1} style={[styles.personName, { color: colors.ink }]}>
                      {nameOf(payer.user.id, payer.user.name)}
                    </Text>
                    <Text style={[styles.personAmount, { color: colors.ink }]}>
                      {formatMoney(payer.amount, expense.currency)}
                    </Text>
                  </View>
                ))}
              </Card>

              {/* Splits */}
              <Card padded={false} style={styles.sectionCard}>
                <Text style={[styles.sectionTitle, { color: colors.ink3 }]}>SPLIT</Text>
                {expense.splits.map((split) => {
                  const detail = splitDetail(expense, split);
                  return (
                    <View key={split.user.id} style={styles.personRow}>
                      <Avatar name={split.user.name} color={split.user.avatarColor} size={32} />
                      <View style={styles.personBody}>
                        <Text numberOfLines={1} style={[styles.personName, { color: colors.ink }]}>
                          {nameOf(split.user.id, split.user.name)}
                        </Text>
                        {detail ? (
                          <Text style={[styles.personDetail, { color: colors.ink3 }]}>{detail}</Text>
                        ) : null}
                      </View>
                      <Text style={[styles.personAmount, { color: colors.ink }]}>
                        {formatMoney(split.amount, expense.currency)}
                      </Text>
                    </View>
                  );
                })}
              </Card>

              {/* Items */}
              {expense.splitType === 'ITEMIZED' && expense.items.length > 0 ? (
                <Card padded={false} style={styles.sectionCard}>
                  <Text style={[styles.sectionTitle, { color: colors.ink3 }]}>ITEMS</Text>
                  {expense.items.map((item) => (
                    <View key={item.id} style={styles.personRow}>
                      <View style={styles.personBody}>
                        <Text numberOfLines={1} style={[styles.personName, { color: colors.ink }]}>
                          {item.name}
                        </Text>
                        <Text style={[styles.personDetail, { color: colors.ink3 }]}>
                          {item.participantIds.length}{' '}
                          {item.participantIds.length === 1 ? 'person' : 'people'}
                        </Text>
                      </View>
                      <Text style={[styles.personAmount, { color: colors.ink }]}>
                        {formatMoney(item.amount, expense.currency)}
                      </Text>
                    </View>
                  ))}
                  {taxTip > 0 ? (
                    <View style={[styles.personRow, styles.taxRow, { borderTopColor: colors.hairline }]}>
                      <Text style={[styles.personDetail, { color: colors.ink3, flex: 1 }]}>
                        Tax / tip / fees
                      </Text>
                      <Text style={[styles.personAmount, { color: colors.ink2 }]}>
                        {formatMoney(taxTip, expense.currency)}
                      </Text>
                    </View>
                  ) : null}
                </Card>
              ) : null}

              {/* Receipt */}
              {expense.receiptUrl ? (
                receiptIsPdf ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open receipt PDF"
                    onPress={() => {
                      Linking.openURL(apiUrl(expense.receiptUrl!)).catch(() =>
                        Alert.alert('Could not open the receipt.'),
                      );
                    }}
                    style={({ pressed }) => [
                      styles.pdfRow,
                      {
                        borderColor: colors.hairline,
                        backgroundColor: pressed ? colors.surface2 : colors.surface,
                      },
                    ]}
                  >
                    <Ionicons name="document-text-outline" size={20} color={colors.ink2} />
                    <Text style={[styles.pdfText, { color: colors.ink }]}>Receipt (PDF)</Text>
                    <Ionicons name="open-outline" size={18} color={colors.ink3} />
                  </Pressable>
                ) : (
                  <Image
                    source={{ uri: apiUrl(expense.receiptUrl) }}
                    style={[styles.receiptImage, { backgroundColor: colors.surface2 }]}
                    contentFit="cover"
                    accessibilityLabel="Receipt image"
                  />
                )
              ) : null}

              {/* Notes */}
              {expense.notes ? (
                <Card style={styles.notesCard}>
                  <Text style={[styles.sectionTitle, { color: colors.ink3 }]}>NOTES</Text>
                  <Text style={[styles.notesText, { color: colors.ink2 }]}>{expense.notes}</Text>
                </Card>
              ) : null}

              {/* Provenance footer */}
              <Text style={[styles.provenance, { color: colors.ink3 }]}>
                Added by {nameOf(expense.createdBy.id, expense.createdBy.name)} ·{' '}
                {formatRelative(expense.createdAt)}
                {expense.updatedBy && expense.updatedAt !== expense.createdAt
                  ? ` · edited by ${nameOf(expense.updatedBy.id, expense.updatedBy.name)} ${formatRelative(expense.updatedAt)}`
                  : ''}
              </Text>

              {/* Comments */}
              <View style={styles.commentsBlock}>
                <Text style={[styles.commentsTitle, { color: colors.ink2 }]}>
                  Comments{expense.commentCount > 0 ? ` (${expense.commentCount})` : ''}
                </Text>
                {commentsQuery.isLoading ? (
                  <SkeletonList rows={2} />
                ) : commentsQuery.isError ? (
                  <View style={styles.commentsError}>
                    <InlineError message={errorMessage(commentsQuery.error)} />
                    <Button
                      title="Try again"
                      variant="secondary"
                      size="sm"
                      onPress={() => void commentsQuery.refetch()}
                    />
                  </View>
                ) : (commentsQuery.data ?? []).length === 0 ? (
                  <Text style={[styles.noComments, { color: colors.ink3 }]}>
                    💬 No comments yet — say something about this expense.
                  </Text>
                ) : (
                  (commentsQuery.data ?? []).map((comment) => (
                    <View key={comment.id} style={styles.commentRow}>
                      <Avatar
                        name={comment.author.name}
                        color={comment.author.avatarColor}
                        size={30}
                      />
                      <View style={[styles.commentBubble, { backgroundColor: colors.surface2 }]}>
                        <View style={styles.commentMeta}>
                          <Text style={[styles.commentAuthor, { color: colors.ink }]}>
                            {nameOf(comment.author.id, comment.author.name)}
                          </Text>
                          <Text style={[styles.commentTime, { color: colors.ink3 }]}>
                            {formatRelative(comment.createdAt)}
                          </Text>
                        </View>
                        <Text style={[styles.commentBody, { color: colors.ink2 }]}>
                          {comment.body}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
                {addComment.isError ? (
                  <InlineError message={errorMessage(addComment.error)} />
                ) : null}
              </View>
            </ScrollView>

            {/* Comment input row */}
            <View
              style={[
                styles.commentInputRow,
                { borderTopColor: colors.hairline, backgroundColor: colors.page },
              ]}
            >
              <TextInput
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Add a comment…"
                placeholderTextColor={colors.ink3}
                maxLength={LIMITS.COMMENT_MAX}
                multiline
                accessibilityLabel="Add a comment"
                style={[
                  styles.commentInput,
                  {
                    color: colors.ink,
                    backgroundColor: colors.surface,
                    borderColor: colors.hairline,
                  },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send comment"
                disabled={commentText.trim().length === 0 || addComment.isPending}
                onPress={submitComment}
                style={({ pressed }) => [
                  styles.sendButton,
                  {
                    backgroundColor:
                      commentText.trim().length === 0 || addComment.isPending
                        ? colors.surface2
                        : pressed
                          ? colors.brandHover
                          : colors.brand,
                  },
                ]}
              >
                <Ionicons
                  name="arrow-up"
                  size={20}
                  color={
                    commentText.trim().length === 0 || addComment.isPending
                      ? colors.ink3
                      : colors.onBrand
                  }
                />
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
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
  headerButton: {
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
  headerActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  heroSkeleton: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  skeletonGap: {
    marginTop: spacing.md,
  },
  content: {
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  deletedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  deletedText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  hero: {
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  heroEmoji: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmojiText: {
    fontSize: 26,
  },
  heroDescription: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  heroAmount: {
    fontSize: fontSize.hero,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: spacing.xs,
  },
  heroMeta: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.xs + 2,
  },
  heroBadge: {
    marginTop: spacing.sm + 2,
  },
  sectionCard: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.6,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    gap: spacing.md,
  },
  personBody: {
    flex: 1,
    minWidth: 0,
  },
  personName: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  personDetail: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  personAmount: {
    fontSize: fontSize.md,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  taxRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pdfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm + 2,
  },
  pdfText: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  receiptImage: {
    width: '100%',
    height: 220,
    borderRadius: radii.xl,
  },
  notesCard: {
    gap: spacing.xs,
  },
  notesText: {
    fontSize: fontSize.md,
    lineHeight: 21,
  },
  provenance: {
    fontSize: fontSize.xs,
    textAlign: 'center',
  },
  commentsBlock: {
    gap: spacing.md,
  },
  commentsTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  commentsError: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  noComments: {
    fontSize: fontSize.sm,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 2,
  },
  commentBubble: {
    flex: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  commentAuthor: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  commentTime: {
    fontSize: fontSize.xs,
  },
  commentBody: {
    fontSize: fontSize.md,
    marginTop: 2,
    lineHeight: 20,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  commentInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm + 2,
    fontSize: fontSize.md,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
