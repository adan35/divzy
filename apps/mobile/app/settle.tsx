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
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
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
  PressableScale,
  Skeleton,
  Toast,
} from '@/components/ui';
import { DateField, InlineError, ModalHeader } from '@/components/expense-editor';
import { ProofPicker } from '@/components/settle/ProofPicker';
import { useAuth } from '@/lib/auth';
import { WEB_BASE_URL } from '@/lib/api';
import { celebrate } from '@/lib/celebration';
import {
  errorMessage,
  useCreateSettlement,
  useFriends,
  useGroup,
  useGroupBalances,
} from '@/lib/hooks';
import {
  findDirectionalDebt,
  friendDirectionalDebts,
  friendHasNothingOutstanding,
  netReachableAmount,
  resolveSettleParties,
  settleCounterpartyId,
  withProofUrl,
} from '@/lib/settlements';
import { buildSettleShareLink, copySettleShareLink } from '@/lib/settleShareLink';
import { nextToastTriggerId, type ToastTone } from '@/lib/toast';
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
      {/* spec-WI-068 §9.2 — party cards get PressableScale (transform-only
          press feedback); the fixed surface background replaces the old
          pressed-tint toggle, since PressableScale.style can't be the
          `({pressed}) => …` function form (the scale IS the affordance). */}
      <PressableScale
        accessibilityLabel={`${label}: ${selected ? (selected.id === meId ? 'You' : selected.name) : 'choose a person'}`}
        onPress={() => setOpen(true)}
        style={[styles.partyButton, { backgroundColor: colors.surface, borderColor: colors.hairline }]}
      >
        {selected ? (
          <Avatar
            name={selected.name}
            color={selected.avatarColor}
            avatarUrl={selected.avatarUrl}
            size={24}
          />
        ) : (
          <Ionicons name="person-circle-outline" size={24} color={colors.ink3} />
        )}
        <Text numberOfLines={1} style={[styles.partyText, { color: selected ? colors.ink : colors.ink3 }]}>
          {selected ? (selected.id === meId ? 'You' : selected.name) : 'Choose…'}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.ink3} />
      </PressableScale>

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
                <Avatar
                  name={item.name}
                  color={item.avatarColor}
                  avatarUrl={item.avatarUrl}
                  size={36}
                />
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
  // WI-012 — group-scoped entry points' pre-submit clamp source (native
  // pairwise amount/currency only; never `convertedAmount`, ARCH invariant 5).
  const groupBalancesQuery = useGroupBalances(groupId ?? '', !!groupId);

  const group = groupId ? groupQuery.data : undefined;

  const candidates = useMemo<PublicUserDto[]>(() => {
    if (groupId) return group?.members.map((m) => m.user) ?? [];
    const list: PublicUserDto[] = [];
    if (me) {
      list.push({ id: me.id, name: me.name, avatarColor: me.avatarColor, avatarUrl: me.avatarUrl });
    }
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
  // WI-023 — optional payment-proof attachment (spec-WI-023 §6): two-step,
  // upload-then-create, identical to the expense editor's ReceiptPicker flow.
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  // WI-016 §B — Share affordance (QR + copy-link). Toast state mirrors the
  // existing group/[id].tsx GroupMenu copy-link pattern.
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone; id: number } | null>(
    null,
  );
  const toastSeq = useRef(0);
  const showToast = (message: string, tone: ToastTone) => {
    toastSeq.current = nextToastTriggerId(toastSeq.current);
    setToast({ message, tone, id: toastSeq.current });
  };

  // WI-024 / ADR-021 — resolve the effective parties as pure derived values
  // every render, instead of the deleted "fill blanks once async data
  // arrives" effect (its `firstOther` computation read `fromUserId` through a
  // stale closure omitted from its deps — the same defect class as the web
  // dialog's, and the WI-021 mid-interaction overwrite on this screen).
  // `fromUserId`/`toUserId` remain the user's explicit override (empty string
  // means "not overridden"); `resolveSettleParties` derives the effective
  // default from prefill/route params + `me` + whatever `candidates` currently
  // holds, so it is correct on first render, once async data arrives, and
  // after any manual override — with no stale window and nothing to skip or
  // clobber.
  const { resolvedFrom, resolvedTo } = resolveSettleParties(
    fromUserId,
    toUserId,
    me?.id,
    prefillFrom,
    prefillTo ?? friendId,
    candidates,
  );

  // Adopt the group currency when the group loads late (unless already chosen).
  useEffect(() => {
    if (currencyTouched.current || !group?.currency) return;
    setCurrency(group.currency);
  }, [group?.currency]);

  const nameOf = (userId: string): string => {
    if (me && userId === me.id) return 'you';
    return candidates.find((c) => c.id === userId)?.name ?? 'someone';
  };

  const partiesDiffer =
    resolvedFrom !== '' && resolvedTo !== '' && resolvedFrom !== resolvedTo;
  const meInvolved = !!me && (resolvedFrom === me.id || resolvedTo === me.id);
  const amountValid = amount !== null && amount > 0;
  const partiesResolved = partiesDiffer && meInvolved;

  const validationError =
    resolvedFrom && resolvedTo && !partiesDiffer
      ? 'The payer and the recipient must be different people.'
      : resolvedFrom && resolvedTo && !meInvolved
        ? 'You must be one of the two people in this payment.'
        : null;

  // ---------------------------------------------------------------------
  // WI-012 — bound "Record a payment" to the real outstanding balance.
  // Group-scoped (Revision 2, cycle 1 — defect-WI-012.md; ADR-010): full
  // pre-submit clamp off a net-position reachability ceiling
  // (`netReachableAmount`, sourced from useGroupBalances().members[].balances
  // — native per-currency nets, never convertedNet — ARCH invariant 5). This
  // replaced the original bilateral `data.pairwise` lookup, which incorrectly
  // rejected min-cash-flow `suggestSettlements` transfers in 3+-member debt
  // chains (the suggested pair can have no bilateral pairwise entry at all).
  // Non-group (friend detail / dashboard quick action, no groupId): a
  // zero-balance disable off the matching FriendDto, plus the same clamp
  // shape only when there's exactly one native leftover currency to clamp
  // against unambiguously; otherwise this falls through to the server's 400
  // surfaced inline at submit (createSettlement.isError below) — matching
  // spec-WI-012's "block-at-submit" allowance for that common same-currency
  // case. Either way, this client gate is affordance only, never the
  // enforcement point (the server re-derives and enforces the real bound;
  // for the group scope it now also uses this same net-reachability rule).
  // ---------------------------------------------------------------------
  const otherId = partiesResolved ? settleCounterpartyId(resolvedFrom, resolvedTo, me?.id ?? '') : null;
  const friend =
    !groupId && otherId ? friendsQuery.data?.find((f) => f.user.id === otherId) : undefined;
  const nonGroupLeftovers = friend?.balances.filter((b) => b.amount !== 0) ?? [];
  const nonGroupDebts =
    !groupId && otherId && nonGroupLeftovers.length === 1
      ? friendDirectionalDebts(nonGroupLeftovers, me?.id ?? '', otherId)
      : null;

  // ADR-011 (WI-013) — widen the group-scoped clamp to max(netCeiling,
  // bilateral), folding in the bilateral pairwise row for this pair/currency
  // (from the same `useGroupBalances` query) so a genuinely-owed unsimplified
  // debt opened from the Balances tab's "WHO OWES WHOM" list isn't wrongly
  // clamped to zero by the net ceiling alone. Superset of the WI-012
  // Revision 2 ceiling — every prior acceptance still passes.
  const groupCeiling =
    partiesResolved && groupId && groupBalancesQuery.data
      ? netReachableAmount(
          groupBalancesQuery.data.members,
          resolvedFrom,
          resolvedTo,
          currency,
          groupBalancesQuery.data.pairwise,
        )
      : null;

  const nonGroupDebt =
    partiesResolved && !groupId && nonGroupDebts
      ? findDirectionalDebt(nonGroupDebts, resolvedFrom, resolvedTo, currency)
      : undefined;

  const balanceBlocked = partiesResolved
    ? groupId
      ? groupCeiling !== null && groupCeiling <= 0
      : !!friend && friendHasNothingOutstanding(friend)
    : false;
  const owedCeiling = !balanceBlocked
    ? groupId
      ? groupCeiling
      : (nonGroupDebt?.amount ?? null)
    : null;
  const overAmount = owedCeiling !== null && amount !== null && amount > owedCeiling;

  const balanceMessage = balanceBlocked
    ? `Nothing outstanding with ${otherId ? nameOf(otherId) : 'this person'}${groupId ? ' in this group' : ''}`
    : overAmount && owedCeiling !== null
      ? `Only ${formatMoney(owedCeiling, currency)} is outstanding`
      : null;

  const canSave =
    partiesDiffer &&
    meInvolved &&
    amountValid &&
    !balanceBlocked &&
    !overAmount &&
    !createSettlement.isPending;

  const swapParties = () => {
    Haptics.selectionAsync().catch(() => undefined);
    setFromUserId(resolvedTo);
    setToUserId(resolvedFrom);
  };

  const handleSave = () => {
    if (!canSave || amount === null) return;
    createSettlement.mutate(
      // WI-023 — `withProofUrl` omits the key entirely when there's no
      // attachment, so "creating with no attachment" stays byte-for-byte
      // unchanged (spec-WI-023 AC). Cast: `proofUrl` isn't yet on
      // `CreateSettlementInput` in @divzy/shared as of this build — see the
      // dependency-gap note on `withProofUrl` (lib/settlements.ts) and the
      // build summary. Remove the cast once the backend PR lands the field.
      withProofUrl(
        {
          groupId: groupId ?? null,
          fromUserId: resolvedFrom,
          toUserId: resolvedTo,
          amount,
          currency,
          method,
          date,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        proofUrl,
      ) as Parameters<typeof createSettlement.mutate>[0],
      {
        onSuccess: () => {
          // spec-WI-068 §7 — celebrate() BEFORE router.back(): the
          // root-mounted CelebrationOverlay plays over the destination
          // screen, so navigating away doesn't kill the burst. The existing
          // success haptic is kept as the reduced-motion tactile channel
          // (AC-7c) regardless of whether the visual plays.
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          celebrate();
          router.back();
        },
      },
    );
  };

  const partiesLoading = groupId ? groupQuery.isLoading : friendsQuery.isLoading;
  const partiesError = groupId ? groupQuery.error : friendsQuery.error;

  const sentence =
    partiesDiffer && amountValid
      ? `${resolvedFrom === me?.id ? 'You pay' : `${nameOf(resolvedFrom)} pays`} ${
          resolvedTo === me?.id ? 'you' : nameOf(resolvedTo)
        } ${formatMoney(amount!, currency)}`
      : null;

  // WI-016 §B — once parties/amount/currency are resolved, the same
  // non-secret prefill the suggestion/friend entry points already pass
  // in-process can be shared as a Divzy link + client-side QR (ADR-013).
  // No server call, no new gating — `POST /settlements` remains the sole
  // authority; a non-party who opens this link still can't submit (WI-004,
  // unchanged `canSave`/`meInvolved` above).
  const shareLink =
    partiesDiffer && amountValid
      ? buildSettleShareLink(
          {
            fromUserId: resolvedFrom,
            toUserId: resolvedTo,
            amount: amount!,
            currency,
            groupId: groupId ?? null,
          },
          WEB_BASE_URL,
        )
      : null;

  const copyShareLink = async () => {
    if (!shareLink) return;
    const result = await copySettleShareLink(shareLink, {
      setClipboardText: Clipboard.setStringAsync,
      notifySuccess: () =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      onError: (err) => console.warn('[settle] copy share link failed', err),
    });
    showToast(result.message, result.tone);
  };

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
                  value={resolvedFrom}
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
                  value={resolvedTo}
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
                  disabled={balanceBlocked}
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

              {balanceMessage ? <InlineError message={balanceMessage} /> : null}

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

              <ProofPicker value={proofUrl} onChange={setProofUrl} />

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

              {shareLink ? (
                <View style={styles.shareSection}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={shareOpen ? 'Hide share link and QR code' : 'Share this payment as a link or QR code'}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => undefined);
                      setShareOpen((prev) => !prev);
                    }}
                    style={({ pressed }) => [
                      styles.shareToggle,
                      { backgroundColor: pressed ? colors.surface2 : 'transparent' },
                    ]}
                  >
                    <Ionicons name="qr-code-outline" size={18} color={colors.brand} />
                    <Text style={[styles.shareToggleText, { color: colors.brand }]}>
                      {shareOpen ? 'Hide share link' : 'Share'}
                    </Text>
                  </Pressable>

                  {shareOpen ? (
                    <View
                      style={[
                        styles.shareCard,
                        { backgroundColor: colors.surface2, borderColor: colors.hairline },
                      ]}
                    >
                      <View style={styles.qrWrap}>
                        <QRCode value={shareLink} size={160} />
                      </View>
                      <Text numberOfLines={2} style={[styles.shareLinkText, { color: colors.ink3 }]}>
                        {shareLink}
                      </Text>
                      <Button
                        title="Copy link"
                        variant="secondary"
                        size="sm"
                        onPress={() => void copyShareLink()}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {toast ? <Toast message={toast.message} tone={toast.tone} triggerId={toast.id} /> : null}
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
  shareSection: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  shareToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  shareToggleText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  shareCard: {
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  qrWrap: {
    backgroundColor: '#fff',
    padding: spacing.sm,
    borderRadius: radii.md,
  },
  shareLinkText: {
    fontSize: fontSize.sm,
    textAlign: 'center',
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
