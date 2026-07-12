import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  formatMoney,
  LIMITS,
  RECURRENCE_FREQUENCIES,
  type CreateRecurringInput,
  type ExpenseCategory,
  type RecurrenceFrequency,
  type RecurringExpenseDto,
} from '@divzy/shared';
import {
  AmountInput,
  Button,
  Card,
  CurrencyPicker,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  SkeletonList,
} from '@/components/ui';
import {
  CategoryPicker,
  ContextPicker,
  DateField,
  InlineError,
  ModalHeader,
  RECURRING_DATE_PRESETS,
  type ContextMode,
} from '@/components/expense-editor';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import {
  errorMessage,
  useCreateRecurring,
  useDeleteRecurring,
  useFriends,
  useGroup,
  useGroups,
  useRecurring,
  useUpdateRecurring,
} from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

function frequencyLabel(frequency: RecurrenceFrequency): string {
  return RECURRENCE_FREQUENCIES.find((f) => f.key === frequency)?.label ?? frequency;
}

function defaultStartIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).toISOString();
}

/** Recurring expenses: cards with pause/delete plus a simple create flow. */
export default function RecurringScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const listQuery = useRecurring();
  const updateRecurring = useUpdateRecurring();
  const deleteRecurring = useDeleteRecurring();
  const [createOpen, setCreateOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const items = listQuery.data ?? [];

  const toggleActive = (item: RecurringExpenseDto, active: boolean) => {
    setTogglingId(item.id);
    updateRecurring.mutate(
      { recurringId: item.id, input: { active } },
      {
        onSuccess: () =>
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          ),
        onError: (err) => Alert.alert('Could not update', errorMessage(err)),
        onSettled: () => setTogglingId(null),
      },
    );
  };

  const confirmDelete = (item: RecurringExpenseDto) => {
    Alert.alert(
      'Delete recurring expense?',
      `“${item.description}” will stop posting. Already-posted expenses stay.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteRecurring.mutate(item.id, {
              onSuccess: () =>
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                  () => undefined,
                ),
              onError: (err) => Alert.alert('Could not delete', errorMessage(err)),
            }),
        },
      ],
    );
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
            styles.headerButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>Recurring</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New recurring expense"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
            setCreateOpen(true);
          }}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
          ]}
        >
          <Ionicons name="add" size={26} color={colors.brand} />
        </Pressable>
      </View>

      {listQuery.isLoading ? (
        <SkeletonList rows={5} avatar={false} style={styles.gutters} />
      ) : listQuery.isError ? (
        <ErrorState
          message={errorMessage(listQuery.error)}
          onRetry={() => void listQuery.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          emoji="🔁"
          title="Nothing recurring yet"
          hint="Rent, subscriptions, weekly groceries — set them once and Divzy posts them on schedule."
          actionLabel="Set one up"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.gutters, styles.listContent]}
          refreshControl={
            <RefreshControl
              refreshing={listQuery.isRefetching}
              onRefresh={() => void listQuery.refetch()}
              tintColor={colors.ink3}
            />
          }
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.cardTop}>
                <Text numberOfLines={1} style={[styles.cardTitle, { color: colors.ink }]}>
                  {item.description}
                </Text>
                <Text style={[styles.cardAmount, { color: colors.ink }]}>
                  {formatMoney(item.amount, item.currency)}
                </Text>
              </View>
              <Text numberOfLines={1} style={[styles.cardMeta, { color: colors.ink3 }]}>
                {item.group ? `${item.group.emoji} ${item.group.name}` : 'Outside a group'} ·{' '}
                {frequencyLabel(item.frequency)}
              </Text>
              <Text style={[styles.cardMeta, { color: item.active ? colors.ink2 : colors.ink3 }]}>
                {item.active
                  ? `Next posts ${formatDate(item.nextRunAt)}${item.endDate ? ` · until ${formatDate(item.endDate)}` : ''}`
                  : 'Paused'}
              </Text>
              <View style={[styles.cardActions, { borderTopColor: colors.hairline }]}>
                <View style={styles.switchGroup}>
                  <Switch
                    value={item.active}
                    disabled={togglingId === item.id}
                    onValueChange={(next) => toggleActive(item, next)}
                    trackColor={{ false: colors.surface2, true: withAlpha(colors.brand, 0.5) }}
                    thumbColor={item.active ? colors.brand : colors.ink3}
                    accessibilityLabel={`${item.description} active`}
                  />
                  <Text style={[styles.switchLabel, { color: colors.ink2 }]}>
                    {item.active ? 'Active' : 'Paused'}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.description}`}
                  onPress={() => confirmDelete(item)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.deleteButton,
                    pressed && { backgroundColor: withAlpha(colors.danger, 0.12) },
                  ]}
                >
                  <Ionicons name="trash-outline" size={19} color={colors.danger} />
                </Pressable>
              </View>
            </Card>
          )}
        />
      )}

      <CreateRecurringModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void listQuery.refetch();
        }}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Create flow — simplified but valid CreateRecurringInput: paid by you,
// split equally (EQUAL) among the group's members / you + the friend.
// ---------------------------------------------------------------------------

function CreateRecurringModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { colors } = useTheme();
  const { user: me } = useAuth();
  const groupsQuery = useGroups();
  const friendsQuery = useFriends();
  const createRecurring = useCreateRecurring();

  const [mode, setMode] = useState<ContextMode>('group');
  const [pickedGroupId, setPickedGroupId] = useState('');
  const [pickedFriendId, setPickedFriendId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState(me?.defaultCurrency ?? 'USD');
  const currencyTouched = useRef(false);
  const [category, setCategory] = useState<ExpenseCategory>('GENERAL');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('MONTHLY');
  const [startDate, setStartDate] = useState(defaultStartIso());

  const ctxGroupId = mode === 'group' && pickedGroupId ? pickedGroupId : undefined;
  const ctxFriendId = mode === 'friend' && pickedFriendId ? pickedFriendId : undefined;
  const groupQuery = useGroup(ctxGroupId ?? '', visible && !!ctxGroupId);
  const loadedGroup =
    ctxGroupId && groupQuery.data?.id === ctxGroupId ? groupQuery.data : undefined;
  const friendUser = ctxFriendId
    ? friendsQuery.data?.find((f) => f.user.id === ctxFriendId)?.user
    : undefined;

  // Reset the form each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setMode('group');
    setPickedGroupId('');
    setPickedFriendId('');
    setDescription('');
    setAmount(null);
    setCurrency(me?.defaultCurrency ?? 'USD');
    currencyTouched.current = false;
    setCategory('GENERAL');
    setFrequency('MONTHLY');
    setStartDate(defaultStartIso());
    createRecurring.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [visible]);

  // Currency follows the picked group until chosen explicitly.
  useEffect(() => {
    if (currencyTouched.current) return;
    if (loadedGroup?.currency) setCurrency(loadedGroup.currency);
    else if (me?.defaultCurrency) setCurrency(me.defaultCurrency);
  }, [loadedGroup?.currency, me?.defaultCurrency]);

  const participantIds = useMemo<string[]>(() => {
    if (ctxGroupId) return loadedGroup?.members.map((m) => m.user.id) ?? [];
    if (ctxFriendId && me && friendUser) return [me.id, friendUser.id];
    return [];
  }, [ctxGroupId, ctxFriendId, loadedGroup, friendUser, me]);

  const contextChosen = !!ctxGroupId || !!ctxFriendId;
  const membersReady = participantIds.length > 0;
  const canSave =
    !!me &&
    contextChosen &&
    membersReady &&
    description.trim().length > 0 &&
    amount !== null &&
    amount > 0 &&
    !createRecurring.isPending;

  const handleCreate = () => {
    if (!canSave || !me || amount === null) return;
    const input: CreateRecurringInput = {
      groupId: ctxGroupId ?? null,
      description: description.trim(),
      amount,
      currency,
      category,
      splitType: 'EQUAL',
      payers: [{ userId: me.id, amount }],
      participants: participantIds.map((userId) => ({ userId })),
      frequency,
      startDate,
    };
    createRecurring.mutate(input, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => undefined,
        );
        onCreated();
      },
    });
  };

  const activeGroups = (groupsQuery.data ?? []).filter((g) => g.archivedAt === null);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        edges={['top', 'left', 'right', 'bottom']}
        style={[styles.root, { backgroundColor: colors.page }]}
      >
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.gutters}>
            <ModalHeader
              title="New recurring expense"
              subtitle="Posts automatically on schedule"
              closeDisabled={createRecurring.isPending}
              onClose={onClose}
            />
          </View>
          <ScrollView
            style={styles.root}
            contentContainerStyle={[styles.gutters, styles.modalContent]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ContextPicker
              mode={mode}
              onModeChange={setMode}
              groups={activeGroups}
              friends={friendsQuery.data ?? []}
              groupsLoading={groupsQuery.isLoading}
              friendsLoading={friendsQuery.isLoading}
              selectedGroupId={pickedGroupId}
              selectedFriendId={pickedFriendId}
              onSelectGroup={setPickedGroupId}
              onSelectFriend={setPickedFriendId}
            />

            <Input
              label="Description"
              value={description}
              onChangeText={setDescription}
              placeholder="Rent, Netflix, cleaning service…"
              maxLength={LIMITS.DESCRIPTION_MAX}
            />

            <View style={styles.amountRow}>
              <AmountInput
                label="Amount"
                currency={currency}
                value={amount}
                onChange={setAmount}
                containerStyle={styles.amountField}
              />
              <CurrencyPicker
                label="Currency"
                value={currency}
                onChange={(code) => {
                  currencyTouched.current = true;
                  setCurrency(code);
                }}
                containerStyle={styles.currencyField}
              />
            </View>

            <View>
              <Text style={[styles.fieldLabel, { color: colors.ink2 }]}>Category</Text>
              <CategoryPicker value={category} onChange={setCategory} />
            </View>

            <View>
              <Text style={[styles.fieldLabel, { color: colors.ink2 }]}>Repeats</Text>
              <View style={styles.chipRow}>
                {RECURRENCE_FREQUENCIES.map((option) => {
                  const active = option.key === frequency;
                  return (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => undefined);
                        setFrequency(option.key);
                      }}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          borderColor: active ? colors.brand : colors.hairline,
                          backgroundColor: active
                            ? withAlpha(colors.brand, 0.1)
                            : pressed
                              ? colors.surface2
                              : colors.surface,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color: active ? colors.brand : colors.ink2,
                            fontWeight: active ? '600' : '500',
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <DateField
              label="First occurrence"
              value={startDate}
              onChange={setStartDate}
              presets={RECURRING_DATE_PRESETS}
            />

            {contextChosen ? (
              ctxGroupId && groupQuery.isLoading ? (
                <Skeleton height={44} radius={radii.lg} />
              ) : ctxGroupId && groupQuery.isError ? (
                <InlineError message={errorMessage(groupQuery.error)} />
              ) : membersReady ? (
                <View style={[styles.summaryCard, { backgroundColor: colors.surface2 }]}>
                  <Ionicons name="repeat" size={18} color={colors.brand} />
                  <Text style={[styles.summaryText, { color: colors.ink2 }]}>
                    Each occurrence is paid by you and split equally between{' '}
                    {participantIds.length}{' '}
                    {participantIds.length === 1 ? 'person' : 'people'}. You can edit any posted
                    expense afterwards.
                  </Text>
                </View>
              ) : null
            ) : (
              <Text style={[styles.hintText, { color: colors.ink3 }]}>
                Choose a group or friend above — the expense will be split equally with them.
              </Text>
            )}

            {createRecurring.isError ? (
              <InlineError message={errorMessage(createRecurring.error)} />
            ) : null}

            <Button
              title="Create recurring expense"
              size="lg"
              fullWidth
              loading={createRecurring.isPending}
              disabled={!canSave}
              onPress={handleCreate}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
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
  listContent: {
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  card: {
    gap: spacing.xs,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  cardAmount: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cardMeta: {
    fontSize: fontSize.sm,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
    paddingTop: spacing.sm + 2,
  },
  switchGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  switchLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  amountRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  amountField: {
    flex: 1,
    minWidth: 0,
  },
  currencyField: {
    width: 150,
  },
  fieldLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.xs + 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 1,
  },
  chipText: {
    fontSize: fontSize.sm,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  summaryText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  hintText: {
    fontSize: fontSize.sm,
  },
});
