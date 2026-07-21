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
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorState,
  MoneyText,
  Skeleton,
  SkeletonList,
} from '@/components/ui';
import { ExpenseSplitChart } from '@/components/analytics/ExpenseSplitChart';
import { InlineError } from '@/components/expense-editor';
import { apiUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateFull, formatRelative } from '@/lib/format';
import { formatHistoryChangeLine, formatHistoryKindLine } from '@/lib/expenseHistoryCopy';
import { errorMessage, useAddComment, useComments, useExpense, useExpenseHistory } from '@/lib/hooks';
import { useExpenseActions } from '@/hooks/useExpenseActions';
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
  const historyQuery = useExpenseHistory(expenseId, expenseId.length > 0);
  const addComment = useAddComment();
  const { editExpense, confirmDelete, isDeleting, restoreExpense, isRestoring } =
    useExpenseActions(expenseId, {
      onDeleted: () => router.back(),
      // WI-054b — the now-active expense stays on screen; no back navigation.
    });
  const [commentText, setCommentText] = useState('');

  const expense = expenseQuery.data;
  const isDeleted = !!expense?.deletedAt;

  const nameOf = (userId: string, fallback: string): string =>
    me && userId === me.id ? 'You' : fallback;

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

  // WI-058 — the surviving non-redundant mechanics text (PERCENT/SHARES/
  // ADJUSTMENT raw input), reusing splitDetail() verbatim; empty for
  // EQUAL/EXACT/ITEMIZED and for any split with a null mechanic field.
  const splitDetails = expense
    ? expense.splits
        .map((split) => ({
          id: split.user.id,
          label: nameOf(split.user.id, split.user.name),
          detail: splitDetail(expense, split),
        }))
        .filter((row): row is { id: string; label: string; detail: string } => row.detail !== null)
    : [];

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
                  onPress={editExpense}
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
                  disabled={isDeleting}
                  onPress={confirmDelete}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.headerButton,
                    {
                      backgroundColor: pressed ? colors.surface2 : 'transparent',
                      opacity: isDeleting ? 0.4 : 1,
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
                  refreshing={
                    expenseQuery.isRefetching ||
                    commentsQuery.isRefetching ||
                    historyQuery.isRefetching
                  }
                  onRefresh={() => {
                    void expenseQuery.refetch();
                    void commentsQuery.refetch();
                    void historyQuery.refetch();
                  }}
                  tintColor={colors.ink3}
                />
              }
            >
              {isDeleted ? (
                <View style={[styles.deletedBanner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  <Text style={[styles.deletedText, styles.deletedTextGrow, { color: colors.danger }]}>
                    This expense was deleted.
                  </Text>
                  {/* WI-054b — visible only on a soft-deleted expense; any
                      viewer who can see the expense may restore it (no
                      creator/admin gate, mirrors Edit/Delete's own gating). */}
                  <Button
                    title="Restore"
                    variant="secondary"
                    size="sm"
                    loading={isRestoring}
                    onPress={restoreExpense}
                  />
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
                {/* WI-068 §9.2 — display-type tabular amount header. */}
                <MoneyText
                  amount={expense.amount}
                  currency={expense.currency}
                  colored={false}
                  size={fontSize.hero}
                  weight="700"
                  style={styles.heroAmount}
                />
                {expense.convertedAmount !== undefined ? (
                  <View style={styles.heroConvertedRow}>
                    <Text style={[styles.heroConverted, { color: colors.ink3 }]}>≈ </Text>
                    <MoneyText
                      amount={expense.convertedAmount}
                      currency={expense.convertedCurrency!}
                      colored={false}
                      size={fontSize.md}
                      weight="400"
                      style={[styles.heroConverted, { color: colors.ink3 }]}
                    />
                    {expense.isApproximateRate ? (
                      <Text
                        accessibilityLabel="Approximate — today's rate; the rate on this expense's date isn't available"
                        style={[styles.heroApprox, { color: colors.warning }]}
                      >
                        approx.
                      </Text>
                    ) : null}
                  </View>
                ) : null}
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
                    <Avatar
                      name={payer.user.name}
                      color={payer.user.avatarColor}
                      avatarUrl={payer.user.avatarUrl}
                      size={32}
                    />
                    <Text numberOfLines={1} style={[styles.personName, { color: colors.ink }]}>
                      {nameOf(payer.user.id, payer.user.name)}
                    </Text>
                    <MoneyText
                      amount={payer.amount}
                      currency={expense.currency}
                      colored={false}
                      size={fontSize.md}
                      weight="600"
                    />
                  </View>
                ))}
              </Card>

              {/* Split breakdown chart (analytics-owned, WI-039) — the sole
                  source of per-person amount/percent (WI-058: the hand-rolled
                  per-person list that used to sit above this card was removed
                  as a duplicate). */}
              <Card padded={false} style={styles.sectionCard}>
                <Text style={[styles.sectionTitle, { color: colors.ink3 }]}>SPLIT</Text>
                <ExpenseSplitChart
                  currency={expense.currency}
                  splits={expense.splits}
                  totalAmount={expense.amount}
                  viewerUserId={me?.id}
                />
              </Card>

              {/* Split details — the non-redundant splitType-specific mechanics
                  text (PERCENT/SHARES/ADJUSTMENT input) that the chart doesn't
                  carry. No avatar, no amount: those live on the chart above
                  (WI-058). Renders nothing for EQUAL/EXACT/ITEMIZED. */}
              {splitDetails.length > 0 ? (
                <Card padded={false} style={styles.sectionCard}>
                  <Text style={[styles.sectionTitle, { color: colors.ink3 }]}>SPLIT DETAILS</Text>
                  {splitDetails.map((row) => (
                    <Text key={row.id} style={[styles.personDetail, styles.splitDetailRow, { color: colors.ink3 }]}>
                      {row.label} · {row.detail}
                    </Text>
                  ))}
                </Card>
              ) : null}

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
                      <MoneyText
                        amount={item.amount}
                        currency={expense.currency}
                        colored={false}
                        size={fontSize.md}
                        weight="600"
                      />
                    </View>
                  ))}
                  {taxTip > 0 ? (
                    <View style={[styles.personRow, styles.taxRow, { borderTopColor: colors.hairline }]}>
                      <Text style={[styles.personDetail, { color: colors.ink3, flex: 1 }]}>
                        Tax / tip / fees
                      </Text>
                      <MoneyText
                        amount={taxTip}
                        currency={expense.currency}
                        colored={false}
                        size={fontSize.md}
                        weight="600"
                        style={{ color: colors.ink2 }}
                      />
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

              {/* History */}
              <Card style={styles.historyCard}>
                <Text style={[styles.sectionTitle, { color: colors.ink3 }]}>HISTORY</Text>
                {historyQuery.isLoading ? (
                  <SkeletonList rows={2} />
                ) : historyQuery.isError ? (
                  <View style={styles.commentsError}>
                    <InlineError message={errorMessage(historyQuery.error)} />
                    <Button
                      title="Try again"
                      variant="secondary"
                      size="sm"
                      onPress={() => void historyQuery.refetch()}
                    />
                  </View>
                ) : (historyQuery.data ?? []).length === 0 ? (
                  <Text style={[styles.noComments, { color: colors.ink3 }]}>No history yet.</Text>
                ) : (
                  (historyQuery.data ?? []).map((revision) => (
                    <View key={revision.id} style={styles.historyRow}>
                      <Avatar
                        name={revision.actor.name}
                        color={revision.actor.avatarColor}
                        avatarUrl={revision.actor.avatarUrl}
                        size={30}
                      />
                      <View style={styles.historyBody}>
                        <View style={styles.commentMeta}>
                          <Text style={[styles.commentAuthor, { color: colors.ink }]}>
                            {nameOf(revision.actor.id, revision.actor.name)}
                          </Text>
                          <Text style={[styles.commentTime, { color: colors.ink3 }]}>
                            {formatRelative(revision.createdAt)}
                          </Text>
                        </View>
                        {revision.kind === 'CREATED' ? (
                          <Text style={[styles.historyLine, { color: colors.ink2 }]}>
                            {formatHistoryKindLine(revision.kind)}
                          </Text>
                        ) : (
                          revision.changes.map((change, index) => (
                            <Text
                              key={`${revision.id}-${change.field}-${index}`}
                              style={[styles.historyLine, { color: colors.ink2 }]}
                            >
                              {formatHistoryChangeLine(change, SPLIT_TYPE_LABELS)}
                            </Text>
                          ))
                        )}
                      </View>
                    </View>
                  ))
                )}
              </Card>

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
                        avatarUrl={comment.author.avatarUrl}
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
  deletedTextGrow: {
    flex: 1,
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
    marginTop: spacing.xs,
  },
  heroConvertedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  heroConverted: {
    fontSize: fontSize.md,
    fontVariant: ['tabular-nums'],
  },
  heroApprox: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    marginLeft: spacing.xs,
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
  splitDetailRow: {
    paddingVertical: spacing.xs + 2,
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
  historyCard: {
    gap: spacing.md,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 2,
  },
  historyBody: {
    flex: 1,
    minWidth: 0,
  },
  historyLine: {
    fontSize: fontSize.sm,
    marginTop: 2,
    lineHeight: 19,
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
