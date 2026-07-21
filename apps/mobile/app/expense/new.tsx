import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  LIMITS,
  type CreateExpenseInput,
  type ExpenseCategory,
  type ExpenseDto,
  type PublicUserDto,
  type UpdateExpenseInput,
} from '@divzy/shared';
import {
  AmountInput,
  Button,
  CurrencyPicker,
  ErrorState,
  Input,
  Skeleton,
  SkeletonList,
} from '@/components/ui';
import {
  buildPayers,
  CategoryPicker,
  ContextPicker,
  createDefaultPayerState,
  createDefaultSplitState,
  DateField,
  evaluateSplit,
  InlineError,
  ModalHeader,
  PayerSelector,
  payerStateFromExpense,
  ReceiptPicker,
  SplitEditor,
  splitStateFromExpense,
  type ContextMode,
  type PayerState,
  type SplitState,
} from '@/components/expense-editor';
import { useAuth } from '@/lib/auth';
import {
  errorMessage,
  useCreateExpense,
  useExpense,
  useFriends,
  useGroup,
  useGroups,
  useUpdateExpense,
} from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme } from '@/theme';

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

function defaultDateIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).toISOString();
}

/**
 * Expense editor modal — create + edit, all 6 split types, multi-payer,
 * itemized rows, receipt upload, live per-person preview via the shared
 * computeSplits (the exact server math).
 * Params: groupId? | friendId? | expenseId? (edit mode).
 */
export default function ExpenseEditorScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    groupId?: string | string[];
    friendId?: string | string[];
    expenseId?: string | string[];
  }>();
  const groupId = firstParam(params.groupId);
  const friendId = firstParam(params.friendId);
  const expenseId = firstParam(params.expenseId);

  const expenseQuery = useExpense(expenseId ?? '', !!expenseId);

  let body: React.ReactNode;
  if (expenseId) {
    if (expenseQuery.isLoading) {
      body = (
        <View style={styles.gutters}>
          <ModalHeader title="Edit expense" />
          <View style={styles.loadingBlocks}>
            <Skeleton height={46} radius={radii.lg} />
            <Skeleton height={60} radius={radii.lg} />
            <SkeletonList rows={3} />
          </View>
        </View>
      );
    } else if (expenseQuery.isError || !expenseQuery.data) {
      body = (
        <View style={styles.gutters}>
          <ModalHeader title="Edit expense" />
          <ErrorState
            message={errorMessage(expenseQuery.error)}
            onRetry={() => void expenseQuery.refetch()}
          />
        </View>
      );
    } else {
      body = <EditorForm key={expenseQuery.data.id} expense={expenseQuery.data} />;
    }
  } else {
    body = <EditorForm groupId={groupId} friendId={friendId} />;
  }

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.page }]}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

interface EditorFormProps {
  groupId?: string;
  friendId?: string;
  expense?: ExpenseDto;
}

function EditorForm({ groupId, friendId, expense }: EditorFormProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const { user: me } = useAuth();
  const isEdit = !!expense;

  // -- Context resolution -----------------------------------------------------

  const needsPicker = !isEdit && !groupId && !friendId;
  const [pickerMode, setPickerMode] = useState<ContextMode>('group');
  const [pickedGroupId, setPickedGroupId] = useState('');
  const [pickedFriendId, setPickedFriendId] = useState('');

  const ctxGroupId = isEdit
    ? expense?.groupId ?? undefined
    : groupId ??
      (needsPicker && pickerMode === 'group' && pickedGroupId ? pickedGroupId : undefined);
  const ctxFriendId = isEdit
    ? undefined
    : friendId ??
      (needsPicker && pickerMode === 'friend' && pickedFriendId ? pickedFriendId : undefined);

  const groupsQuery = useGroups();
  const friendsQuery = useFriends();
  const groupQuery = useGroup(ctxGroupId ?? '', !!ctxGroupId);

  const loadedGroup =
    ctxGroupId && groupQuery.data?.id === ctxGroupId ? groupQuery.data : undefined;
  const friendUser = ctxFriendId
    ? friendsQuery.data?.find((f) => f.user.id === ctxFriendId)?.user
    : undefined;

  const members = useMemo<PublicUserDto[]>(() => {
    const map = new Map<string, PublicUserDto>();
    if (isEdit && expense) {
      // Everyone on the expense (payers ∪ splits) plus current group members.
      for (const p of expense.payers) map.set(p.user.id, p.user);
      for (const s of expense.splits) map.set(s.user.id, s.user);
      if (loadedGroup) for (const m of loadedGroup.members) map.set(m.user.id, m.user);
      return [...map.values()];
    }
    if (ctxGroupId) {
      if (loadedGroup) for (const m of loadedGroup.members) map.set(m.user.id, m.user);
      return [...map.values()];
    }
    if (ctxFriendId && me && friendUser) {
      map.set(me.id, {
        id: me.id,
        name: me.name,
        avatarColor: me.avatarColor,
        avatarUrl: me.avatarUrl,
      });
      map.set(friendUser.id, friendUser);
      return [...map.values()];
    }
    return [];
  }, [isEdit, expense, ctxGroupId, ctxFriendId, loadedGroup, friendUser, me]);

  // -- Field state ---------------------------------------------------------------

  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState<number | null>(expense?.amount ?? null);
  const [currency, setCurrency] = useState(expense?.currency ?? me?.defaultCurrency ?? 'USD');
  const currencyTouched = useRef(isEdit);
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'GENERAL');
  const [date, setDate] = useState(expense?.date ?? defaultDateIso());
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [notesOpen, setNotesOpen] = useState(!!expense?.notes);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(expense?.receiptUrl ?? null);
  const [splitState, setSplitState] = useState<SplitState | null>(() =>
    expense ? splitStateFromExpense(expense) : null,
  );
  const [payerState, setPayerState] = useState<PayerState | null>(() =>
    expense && me ? payerStateFromExpense(expense, me.id) : null,
  );

  // (Re)initialize payers + split whenever the member set resolves/changes in
  // create mode; in edit mode only fill gaps, never clobber in-progress edits.
  const membersKey = members
    .map((m) => m.id)
    .sort()
    .join(',');
  const initKey = useRef<string | null>(null);
  useEffect(() => {
    if (!me || members.length === 0) return;
    if (isEdit && expense) {
      setSplitState((prev) => prev ?? splitStateFromExpense(expense));
      setPayerState((prev) => prev ?? payerStateFromExpense(expense, me.id));
      return;
    }
    if (initKey.current === membersKey) return;
    initKey.current = membersKey;
    setSplitState(createDefaultSplitState(members.map((m) => m.id)));
    setPayerState(createDefaultPayerState(me.id));
  }, [membersKey, me, isEdit, expense, members]);

  // Default currency follows the context (group currency, else my default)
  // until the user picks one explicitly.
  const contextCurrency = ctxGroupId ? loadedGroup?.currency : me?.defaultCurrency;
  useEffect(() => {
    if (currencyTouched.current || !contextCurrency) return;
    setCurrency(contextCurrency);
  }, [contextCurrency]);

  // -- Derived validation ------------------------------------------------------

  const evaluation = useMemo(
    () => (splitState ? evaluateSplit(splitState, amount) : null),
    [splitState, amount],
  );
  const payersPayload = useMemo(
    () => (payerState ? buildPayers(payerState, amount) : null),
    [payerState, amount],
  );

  const involvementError = useMemo(() => {
    if (ctxGroupId || !me || !payersPayload || !evaluation?.computed) return null;
    const ids = new Set<string>();
    for (const p of payersPayload) ids.add(p.userId);
    for (const p of evaluation.participants) ids.add(p.userId);
    if (!ids.has(me.id)) {
      return 'You must be part of a non-group expense, as a payer or participant.';
    }
    if (ids.size < 2) return 'Share this expense with at least one other person.';
    return null;
  }, [ctxGroupId, me, payersPayload, evaluation]);

  const createMutation = useCreateExpense();
  const updateMutation = useUpdateExpense();
  const pending = createMutation.isPending || updateMutation.isPending;
  const saveError = createMutation.error ?? updateMutation.error;

  const contextChosen = isEdit || !!ctxGroupId || !!ctxFriendId;
  const ready = members.length > 0 && !!splitState && !!payerState;
  const canSave =
    ready &&
    contextChosen &&
    description.trim().length > 0 &&
    amount !== null &&
    amount > 0 &&
    !!evaluation?.computed &&
    !!payersPayload &&
    !involvementError &&
    !pending;

  // -- Submit --------------------------------------------------------------------

  const handleSave = () => {
    if (!canSave || !splitState || !evaluation?.computed || !payersPayload || amount === null) {
      return;
    }
    const core: UpdateExpenseInput = {
      description: description.trim(),
      amount,
      currency,
      category,
      date,
      splitType: splitState.splitType,
      payers: payersPayload,
      participants: evaluation.participants,
    };
    if (splitState.splitType === 'ITEMIZED' && evaluation.items) core.items = evaluation.items;
    const trimmedNotes = notes.trim();
    if (trimmedNotes) core.notes = trimmedNotes;
    if (receiptUrl) core.receiptUrl = receiptUrl;

    const onSuccess = () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      router.back();
    };

    if (isEdit && expense) {
      updateMutation.mutate({ expenseId: expense.id, input: core }, { onSuccess });
    } else {
      const input: CreateExpenseInput = { ...core, groupId: ctxGroupId ?? null };
      createMutation.mutate(input, { onSuccess });
    }
  };

  // -- UI --------------------------------------------------------------------------

  const contextLabel = isEdit
    ? expense?.group
      ? `${expense.group.emoji} ${expense.group.name}`
      : 'Shared outside a group'
    : loadedGroup
      ? `${loadedGroup.emoji} ${loadedGroup.name}`
      : friendUser
        ? `With ${friendUser.name}`
        : undefined;

  const activeGroups = (groupsQuery.data ?? []).filter((g) => g.archivedAt === null);
  const friends = friendsQuery.data ?? [];

  const contextError = ctxGroupId
    ? groupQuery.error
    : ctxFriendId
      ? friendsQuery.error ??
        (friendsQuery.isSuccess && !friendUser ? new Error('This friend could not be found.') : null)
      : null;

  return (
    <View style={styles.root}>
      <View style={styles.gutters}>
        <ModalHeader
          title={isEdit ? 'Edit expense' : 'Add expense'}
          subtitle={contextLabel}
          closeDisabled={pending}
        />
      </View>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.gutters, styles.content]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {needsPicker ? (
          <ContextPicker
            mode={pickerMode}
            onModeChange={setPickerMode}
            groups={activeGroups}
            friends={friends}
            groupsLoading={groupsQuery.isLoading}
            friendsLoading={friendsQuery.isLoading}
            selectedGroupId={pickedGroupId}
            selectedFriendId={pickedFriendId}
            onSelectGroup={setPickedGroupId}
            onSelectFriend={setPickedFriendId}
          />
        ) : null}

        <Input
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Dinner, taxi, groceries…"
          maxLength={LIMITS.DESCRIPTION_MAX}
          autoFocus={!isEdit}
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

        <DateField value={date} onChange={setDate} />

        <View>
          <Text style={[styles.sectionLabel, { color: colors.ink2 }]}>Category</Text>
          <CategoryPicker value={category} onChange={setCategory} groupId={ctxGroupId} />
        </View>

        {!contextChosen ? (
          <View style={[styles.placeholderBox, { borderColor: colors.hairline }]}>
            <Text style={[styles.placeholderText, { color: colors.ink3 }]}>
              Choose a group or friend above to set who paid and how to split.
            </Text>
          </View>
        ) : contextError ? (
          <View style={styles.contextErrorBlock}>
            <InlineError message={errorMessage(contextError)} />
            {ctxGroupId ? (
              <Button
                title="Try again"
                variant="secondary"
                size="sm"
                onPress={() => void groupQuery.refetch()}
              />
            ) : null}
          </View>
        ) : !ready || !splitState || !payerState || !me ? (
          <View style={styles.loadingBlocks}>
            <Skeleton height={46} radius={radii.lg} />
            <Skeleton height={150} radius={radii.xl} />
          </View>
        ) : (
          <>
            <View>
              <Text style={[styles.sectionLabel, { color: colors.ink2 }]}>Paid by</Text>
              <PayerSelector
                members={members}
                meId={me.id}
                amount={amount}
                currency={currency}
                value={payerState}
                onChange={setPayerState}
              />
            </View>

            <View>
              <Text style={[styles.sectionLabel, { color: colors.ink2 }]}>Split</Text>
              <SplitEditor
                members={members}
                meId={me.id}
                amount={amount}
                currency={currency}
                value={splitState}
                onChange={setSplitState}
              />
            </View>

            {involvementError ? (
              <Text style={[styles.involvementError, { color: colors.danger }]}>
                {involvementError}
              </Text>
            ) : null}
          </>
        )}

        {notesOpen ? (
          <Input
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything worth remembering…"
            maxLength={LIMITS.NOTES_MAX}
            multiline
          />
        ) : null}

        <View style={styles.attachmentsRow}>
          {!notesOpen ? (
            <Button
              title="Add notes"
              icon="document-text-outline"
              variant="secondary"
              size="sm"
              onPress={() => setNotesOpen(true)}
            />
          ) : null}
          <ReceiptPicker value={receiptUrl} onChange={setReceiptUrl} />
        </View>

        {saveError ? <InlineError message={errorMessage(saveError)} /> : null}

        <Button
          title={isEdit ? 'Save changes' : 'Save expense'}
          size="lg"
          fullWidth
          loading={pending}
          disabled={!canSave}
          onPress={handleSave}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  gutters: {
    paddingHorizontal: spacing.lg,
  },
  content: {
    paddingBottom: spacing.xxl + spacing.xl,
    gap: spacing.lg,
  },
  loadingBlocks: {
    gap: spacing.md,
    marginTop: spacing.md,
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
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.xs + 2,
  },
  placeholderBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radii.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  placeholderText: {
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  contextErrorBlock: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  involvementError: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  attachmentsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
});
