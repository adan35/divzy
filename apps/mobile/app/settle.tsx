import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  formatMoney,
  LIMITS,
  SETTLEMENT_METHODS,
  type PublicUserDto,
  type SettlementMethod,
} from '@divzy/shared';
import {
  AmountInput,
  Avatar,
  Button,
  CurrencyPicker,
  Input,
  Skeleton,
} from '@/components/ui';
import { DateField, InlineError, ModalHeader } from '@/components/expense-editor';
import { useAuth } from '@/lib/auth';
import { errorMessage, useCreateSettlement, useFriends, useGroup } from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

function defaultDateIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).toISOString();
}

// ---------------------------------------------------------------------------
// Party picker field (modal list)
// ---------------------------------------------------------------------------

function PartyField({
  label,
  users,
  value,
  meId,
  onChange,
}: {
  label: string;
  users: PublicUserDto[];
  value: string;
  meId: string;
  onChange: (userId: string) => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = users.find((u) => u.id === value);

  return (
    <View style={styles.partyField}>
      <Text style={[styles.fieldLabel, { color: colors.ink2 }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected ? (selected.id === meId ? 'You' : selected.name) : 'choose a person'}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.partyButton,
          {
            backgroundColor: pressed ? colors.surface2 : colors.surface,
            borderColor: colors.hairline,
          },
        ]}
      >
        {selected ? (
          <Avatar name={selected.name} color={selected.avatarColor} size={24} />
        ) : (
          <Ionicons name="person-circle-outline" size={24} color={colors.ink3} />
        )}
        <Text numberOfLines={1} style={[styles.partyText, { color: selected ? colors.ink : colors.ink3 }]}>
          {selected ? (selected.id === meId ? 'You' : selected.name) : 'Choose…'}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.ink3} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView
          edges={['top', 'left', 'right', 'bottom']}
          style={[styles.modal, { backgroundColor: colors.page }]}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.ink }]}>{label}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setOpen(false)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.modalClose,
                { backgroundColor: pressed ? colors.surface2 : 'transparent' },
              ]}
            >
              <Ionicons name="close" size={22} color={colors.ink2} />
            </Pressable>
          </View>
          <FlatList
            data={users}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
            )}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Haptics.selectionAsync().catch(() => undefined);
                  onChange(item.id);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.modalRow,
                  pressed && { backgroundColor: colors.surface2 },
                ]}
              >
                <Avatar name={item.name} color={item.avatarColor} size={36} />
                <Text numberOfLines={1} style={[styles.modalRowName, { color: colors.ink }]}>
                  {item.name}
                  {item.id === meId ? <Text style={{ color: colors.ink3 }}> (you)</Text> : null}
                </Text>
                {item.id === value ? (
                  <Ionicons name="checkmark" size={20} color={colors.brand} />
                ) : null}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * Record a payment between two people — from a suggestion (prefilled via
 * params) or from scratch. Params: groupId?, friendId?, fromUserId?,
 * toUserId?, amount? (minor units), currency?.
 */
export default function SettleUpScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user: me } = useAuth();
  const params = useLocalSearchParams<{
    groupId?: string | string[];
    friendId?: string | string[];
    fromUserId?: string | string[];
    toUserId?: string | string[];
    amount?: string | string[];
    currency?: string | string[];
  }>();
  const groupId = firstParam(params.groupId);
  const friendId = firstParam(params.friendId);
  const prefillFrom = firstParam(params.fromUserId);
  const prefillTo = firstParam(params.toUserId);
  const prefillCurrency = firstParam(params.currency);
  const prefillAmount = useMemo(() => {
    const raw = firstParam(params.amount);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }, [params.amount]);

  const groupQuery = useGroup(groupId ?? '', !!groupId);
  const friendsQuery = useFriends();
  const createSettlement = useCreateSettlement();

  const group = groupId ? groupQuery.data : undefined;

  const candidates = useMemo<PublicUserDto[]>(() => {
    if (groupId) return group?.members.map((m) => m.user) ?? [];
    const list: PublicUserDto[] = [];
    if (me) list.push({ id: me.id, name: me.name, avatarColor: me.avatarColor });
    for (const f of friendsQuery.data ?? []) list.push(f.user);
    return list;
  }, [groupId, group, me, friendsQuery.data]);

  const [fromUserId, setFromUserId] = useState(prefillFrom ?? me?.id ?? '');
  const [toUserId, setToUserId] = useState(prefillTo ?? friendId ?? '');
  const [amount, setAmount] = useState<number | null>(prefillAmount);
  const [currency, setCurrency] = useState(
    prefillCurrency ?? me?.defaultCurrency ?? 'USD',
  );
  const currencyTouched = useRef(!!prefillCurrency);
  const [method, setMethod] = useState<SettlementMethod>('CASH');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(defaultDateIso());

  // Fill blanks once async data (group members / friends) arrives.
  useEffect(() => {
    if (candidates.length === 0) return;
    setFromUserId((prev) => (prev === '' && me ? me.id : prev));
    setToUserId((prev) => {
      if (prev !== '') return prev;
      const firstOther = candidates.find((c) => c.id !== (fromUserId || me?.id));
      return firstOther?.id ?? prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to data arrival only
  }, [candidates.length, me?.id]);

  // Adopt the group currency when the group loads late (unless already chosen).
  useEffect(() => {
    if (currencyTouched.current || !group?.currency) return;
    setCurrency(group.currency);
  }, [group?.currency]);

  const nameOf = (userId: string): string => {
    if (me && userId === me.id) return 'you';
    return candidates.find((c) => c.id === userId)?.name ?? 'someone';
  };

  const partiesDiffer = fromUserId !== '' && toUserId !== '' && fromUserId !== toUserId;
  const meInvolved = !!me && (fromUserId === me.id || toUserId === me.id);
  const amountValid = amount !== null && amount > 0;

  const validationError =
    fromUserId && toUserId && !partiesDiffer
      ? 'The payer and the recipient must be different people.'
      : fromUserId && toUserId && !meInvolved
        ? 'You must be one of the two people in this payment.'
        : null;

  const canSave =
    partiesDiffer && meInvolved && amountValid && !createSettlement.isPending;

  const swapParties = () => {
    Haptics.selectionAsync().catch(() => undefined);
    setFromUserId(toUserId);
    setToUserId(fromUserId);
  };

  const handleSave = () => {
    if (!canSave || amount === null) return;
    createSettlement.mutate(
      {
        groupId: groupId ?? null,
        fromUserId,
        toUserId,
        amount,
        currency,
        method,
        date,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          router.back();
        },
      },
    );
  };

  const partiesLoading = groupId ? groupQuery.isLoading : friendsQuery.isLoading;
  const partiesError = groupId ? groupQuery.error : friendsQuery.error;

  const sentence =
    partiesDiffer && amountValid
      ? `${fromUserId === me?.id ? 'You pay' : `${nameOf(fromUserId)} pays`} ${
          toUserId === me?.id ? 'you' : nameOf(toUserId)
        } ${formatMoney(amount!, currency)}`
      : null;

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.page }]}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.gutters}>
          <ModalHeader
            title="Settle up"
            subtitle={group ? `${group.emoji} ${group.name}` : 'Record a payment'}
            closeDisabled={createSettlement.isPending}
          />
        </View>
        <ScrollView
          style={styles.root}
          contentContainerStyle={[styles.gutters, styles.content]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {partiesLoading ? (
            <View style={styles.loadingBlocks}>
              <Skeleton height={46} radius={radii.lg} />
              <Skeleton height={46} radius={radii.lg} />
              <Skeleton height={60} radius={radii.lg} />
            </View>
          ) : partiesError ? (
            <View style={styles.errorBlock}>
              <InlineError message={errorMessage(partiesError)} />
              <Button
                title="Try again"
                variant="secondary"
                size="sm"
                onPress={() =>
                  void (groupId ? groupQuery.refetch() : friendsQuery.refetch())
                }
              />
            </View>
          ) : candidates.length < 2 ? (
            <Text style={[styles.hint, { color: colors.ink3 }]}>
              {groupId
                ? 'This group needs at least two members to record a payment.'
                : 'Add a friend first — payments are recorded between two people.'}
            </Text>
          ) : (
            <>
              <View style={styles.partiesRow}>
                <PartyField
                  label="From (who paid)"
                  users={candidates}
                  value={fromUserId}
                  meId={me?.id ?? ''}
                  onChange={setFromUserId}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Swap payer and recipient"
                  onPress={swapParties}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.swapButton,
                    { backgroundColor: pressed ? colors.surface2 : 'transparent' },
                  ]}
                >
                  <Ionicons name="swap-horizontal" size={20} color={colors.brand} />
                </Pressable>
                <PartyField
                  label="To (who received)"
                  users={candidates}
                  value={toUserId}
                  meId={me?.id ?? ''}
                  onChange={setToUserId}
                />
              </View>

              {validationError ? (
                <Text style={[styles.validation, { color: colors.danger }]}>
                  {validationError}
                </Text>
              ) : null}

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
                <Text style={[styles.fieldLabel, { color: colors.ink2 }]}>Method</Text>
                <View style={styles.chipRow}>
                  {SETTLEMENT_METHODS.map((option) => {
                    const active = option.key === method;
                    return (
                      <Pressable
                        key={option.key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => undefined);
                          setMethod(option.key);
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

              <Input
                label="Note (optional)"
                value={note}
                onChangeText={setNote}
                placeholder="e.g. Venmo for the ski trip"
                maxLength={LIMITS.NOTES_MAX}
              />

              <DateField value={date} onChange={setDate} />

              {sentence ? (
                <View style={[styles.sentenceCard, { backgroundColor: colors.surface2 }]}>
                  <Ionicons name="cash-outline" size={18} color={colors.pos} />
                  <Text style={[styles.sentenceText, { color: colors.ink }]}>{sentence}</Text>
                </View>
              ) : null}

              {createSettlement.isError ? (
                <InlineError message={errorMessage(createSettlement.error)} />
              ) : null}

              <Button
                title="Record payment"
                size="lg"
                fullWidth
                loading={createSettlement.isPending}
                disabled={!canSave}
                onPress={handleSave}
              />
            </>
          )}
        </ScrollView>
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
  content: {
    paddingBottom: spacing.xxl + spacing.xl,
    gap: spacing.lg,
  },
  loadingBlocks: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  errorBlock: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  hint: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  partiesRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  partyField: {
    flex: 1,
    minWidth: 0,
  },
  fieldLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.xs + 2,
  },
  partyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  partyText: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  swapButton: {
    width: 36,
    height: 46,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validation: {
    fontSize: fontSize.sm,
    fontWeight: '600',
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
  sentenceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  sentenceText: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  modal: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.lg,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  modalRowName: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
});
