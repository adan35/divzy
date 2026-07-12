import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { formatMoney, LIMITS, type PublicUserDto, type SplitType } from '@divzy/shared';
import { AmountInput, Avatar, Button, Input, SegmentedControl, Stepper } from '@/components/ui';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';
import {
  bpsToPercentText,
  evaluateSplit,
  firstName,
  nextItemKey,
  percentTextToBps,
  type SplitItemRow,
  type SplitState,
} from './split-state';

// ---------------------------------------------------------------------------
// PercentInput — UI percent text <-> integer basis points
// ---------------------------------------------------------------------------

function PercentInput({
  value,
  onChange,
  accessibilityLabel,
}: {
  value: number | null;
  onChange: (bps: number | null) => void;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  const [text, setText] = useState(() => bpsToPercentText(value));
  const [focused, setFocused] = useState(false);
  const lastEmitted = useRef<number | null>(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(bpsToPercentText(value));
    }
  }, [value]);

  const handleChange = (raw: string) => {
    const normalized = raw.replace(/,/g, '.');
    if (!/^\d{0,3}(?:\.\d{0,2})?$/.test(normalized)) return;
    const parsed = percentTextToBps(normalized);
    if (parsed !== null && parsed > 10000) return;
    setText(normalized);
    lastEmitted.current = parsed;
    onChange(parsed);
  };

  return (
    <View
      style={[
        styles.percentField,
        {
          backgroundColor: colors.surface,
          borderColor: focused ? colors.brand : colors.hairline,
        },
      ]}
    >
      <TextInput
        value={text}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="decimal-pad"
        inputMode="decimal"
        placeholder="0"
        placeholderTextColor={colors.ink3}
        accessibilityLabel={accessibilityLabel}
        style={[styles.percentInput, { color: colors.ink }]}
      />
      <Text style={[styles.percentSuffix, { color: colors.ink3 }]}>%</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Remaining indicator for EXACT / PERCENT (must reach exactly zero)
// ---------------------------------------------------------------------------

function RemainingLine({
  remaining,
  format,
}: {
  remaining: number;
  format: (v: number) => string;
}) {
  const { colors } = useTheme();
  if (remaining === 0) {
    return <Text style={[styles.remaining, { color: colors.pos }]}>All assigned ✓</Text>;
  }
  return (
    <Text style={[styles.remaining, { color: remaining > 0 ? colors.warning : colors.neg }]}>
      {format(Math.abs(remaining))} {remaining > 0 ? 'left to assign' : 'over'}
    </Text>
  );
}

const SPLIT_OPTIONS: ReadonlyArray<{ value: SplitType; label: string }> = [
  { value: 'EQUAL', label: '=' },
  { value: 'EXACT', label: '1.23' },
  { value: 'PERCENT', label: '%' },
  { value: 'SHARES', label: 'shares' },
  { value: 'ADJUSTMENT', label: '±' },
  { value: 'ITEMIZED', label: 'items' },
];

// ---------------------------------------------------------------------------
// SplitEditor
// ---------------------------------------------------------------------------

export interface SplitEditorProps {
  members: PublicUserDto[];
  meId: string;
  /** Expense total in minor units (null while unentered). */
  amount: number | null;
  currency: string;
  value: SplitState;
  onChange: (next: SplitState) => void;
}

/**
 * Split-type segmented control + per-mode participant editors + a live
 * per-person preview computed with the shared split engine on every change —
 * the exact math the server runs.
 */
export function SplitEditor({ members, meId, amount, currency, value, onChange }: SplitEditorProps) {
  const { colors } = useTheme();
  const memberById = new Map(members.map((m) => [m.id, m]));
  const selectedSet = new Set(value.selectedIds);
  const evaluation = evaluateSplit(value, amount);

  // Local +/- sign per member for ADJUSTMENT mode (sign survives while the
  // amount box is empty). Initialized from prefilled negative adjustments.
  const [signs, setSigns] = useState<Record<string, 1 | -1>>(() => {
    const initial: Record<string, 1 | -1> = {};
    for (const [id, adj] of Object.entries(value.adjustments)) {
      if (adj !== null && adj < 0) initial[id] = -1;
    }
    return initial;
  });

  const set = (patch: Partial<SplitState>) => onChange({ ...value, ...patch });

  const setSplitType = (splitType: SplitType) => {
    if (splitType === 'ITEMIZED' && value.items.length === 0) {
      set({
        splitType,
        items: [
          { key: nextItemKey(), name: '', amount: null, participantIds: [...value.selectedIds] },
        ],
      });
      return;
    }
    set({ splitType });
  };

  const toggleMember = (id: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    const next = selectedSet.has(id)
      ? value.selectedIds.filter((x) => x !== id)
      : [...value.selectedIds, id];
    set({ selectedIds: next });
  };

  const updateItem = (key: string, patch: Partial<SplitItemRow>) => {
    set({ items: value.items.map((row) => (row.key === key ? { ...row, ...patch } : row)) });
  };

  const toggleItemParticipant = (key: string, userId: string) => {
    set({
      items: value.items.map((row) => {
        if (row.key !== key) return row;
        const has = row.participantIds.includes(userId);
        return {
          ...row,
          participantIds: has
            ? row.participantIds.filter((x) => x !== userId)
            : [...row.participantIds, userId],
        };
      }),
    });
  };

  const memberName = (id: string) => {
    if (id === meId) return 'You';
    return memberById.get(id)?.name ?? 'Former member';
  };

  // Running indicators for the modes that must reach exactly zero.
  const exactAssigned = value.selectedIds.reduce(
    (acc, id) => acc + (value.exactAmounts[id] ?? 0),
    0,
  );
  const percentAssigned = value.selectedIds.reduce(
    (acc, id) => acc + (value.percentBps[id] ?? 0),
    0,
  );
  const itemsAssigned = value.items.reduce((acc, row) => acc + (row.amount ?? 0), 0);
  const fee = amount !== null ? amount - itemsAssigned : null;

  const selectedMembers = members.filter((m) => selectedSet.has(m.id));

  const rightControl = (member: PublicUserDto) => {
    switch (value.splitType) {
      case 'EQUAL':
      case 'ITEMIZED':
        return null;
      case 'EXACT':
        return (
          <AmountInput
            size="md"
            currency={currency}
            value={value.exactAmounts[member.id] ?? null}
            onChange={(v) => set({ exactAmounts: { ...value.exactAmounts, [member.id]: v } })}
            containerStyle={styles.exactField}
          />
        );
      case 'PERCENT':
        return (
          <PercentInput
            value={value.percentBps[member.id] ?? null}
            onChange={(bps) => set({ percentBps: { ...value.percentBps, [member.id]: bps } })}
            accessibilityLabel={`Percentage for ${member.name}`}
          />
        );
      case 'SHARES': {
        const shares = value.shares[member.id] ?? 1;
        return (
          <Stepper
            value={shares}
            min={0}
            max={LIMITS.MAX_PARTICIPANTS * 100}
            onChange={(next) => set({ shares: { ...value.shares, [member.id]: next } })}
          />
        );
      }
      case 'ADJUSTMENT': {
        const stored = value.adjustments[member.id] ?? null;
        const sign: 1 | -1 = signs[member.id] ?? (stored !== null && stored < 0 ? -1 : 1);
        return (
          <View style={styles.adjustmentRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                sign === 1
                  ? `Switch to subtracting from ${member.name}'s share`
                  : `Switch to adding to ${member.name}'s share`
              }
              onPress={() => {
                Haptics.selectionAsync().catch(() => undefined);
                const nextSign: 1 | -1 = sign === 1 ? -1 : 1;
                setSigns((s) => ({ ...s, [member.id]: nextSign }));
                if (stored !== null && stored !== 0) {
                  set({
                    adjustments: { ...value.adjustments, [member.id]: Math.abs(stored) * nextSign },
                  });
                }
              }}
              style={({ pressed }) => [
                styles.signButton,
                {
                  borderColor: colors.hairline,
                  backgroundColor: pressed ? colors.surface2 : colors.surface,
                },
              ]}
            >
              <Text style={[styles.signText, { color: colors.ink }]}>
                {sign === 1 ? '+' : '−'}
              </Text>
            </Pressable>
            <AmountInput
              size="md"
              currency={currency}
              value={stored === null ? null : Math.abs(stored)}
              onChange={(v) =>
                set({
                  adjustments: {
                    ...value.adjustments,
                    [member.id]: v === null ? null : v * sign,
                  },
                })
              }
              containerStyle={styles.adjustmentField}
            />
          </View>
        );
      }
    }
  };

  return (
    <View style={styles.root}>
      <SegmentedControl options={SPLIT_OPTIONS} value={value.splitType} onChange={setSplitType} />

      {value.splitType === 'ADJUSTMENT' ? (
        <Text style={[styles.modeHint, { color: colors.ink3 }]}>
          Enter + or − amounts per person — the rest splits equally.
        </Text>
      ) : null}

      {/* Participant checkbox list */}
      <View style={[styles.memberList, { borderColor: colors.hairline }]}>
        {members.map((member, index) => {
          const checked = selectedSet.has(member.id);
          return (
            <View
              key={member.id}
              style={[
                styles.memberRow,
                index > 0 && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={`Include ${member.name}`}
                onPress={() => toggleMember(member.id)}
                hitSlop={8}
                style={styles.memberToggle}
              >
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={checked ? colors.brand : colors.ink3}
                />
                <Avatar
                  name={member.name}
                  color={member.avatarColor}
                  size={28}
                  style={[styles.memberAvatar, !checked && styles.dimmed]}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.memberName, { color: colors.ink }, !checked && styles.dimmed]}
                >
                  {member.id === meId ? 'You' : member.name}
                </Text>
              </Pressable>
              {checked ? rightControl(member) : null}
            </View>
          );
        })}
      </View>

      {value.splitType === 'EXACT' && amount !== null ? (
        <RemainingLine
          remaining={amount - exactAssigned}
          format={(v) => formatMoney(v, currency)}
        />
      ) : null}
      {value.splitType === 'PERCENT' ? (
        <RemainingLine
          remaining={10000 - percentAssigned}
          format={(v) => `${bpsToPercentText(v) || '0'}%`}
        />
      ) : null}

      {/* Itemized rows */}
      {value.splitType === 'ITEMIZED' ? (
        <View style={styles.itemsBlock}>
          {value.items.map((row) => (
            <View key={row.key} style={[styles.itemCard, { borderColor: colors.hairline }]}>
              <View style={styles.itemTopRow}>
                <Input
                  value={row.name}
                  maxLength={LIMITS.DESCRIPTION_MAX}
                  placeholder="Item name"
                  accessibilityLabel="Item name"
                  onChangeText={(text) => updateItem(row.key, { name: text })}
                  containerStyle={styles.itemNameField}
                />
                <AmountInput
                  size="md"
                  currency={currency}
                  value={row.amount}
                  onChange={(v) => updateItem(row.key, { amount: v })}
                  containerStyle={styles.itemAmountField}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove item ${row.name || ''}`.trim()}
                  onPress={() => set({ items: value.items.filter((r) => r.key !== row.key) })}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.itemDelete,
                    pressed && { backgroundColor: withAlpha(colors.danger, 0.12) },
                  ]}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
              <View style={styles.chipWrap}>
                {selectedMembers.map((member) => {
                  const active = row.participantIds.includes(member.id);
                  return (
                    <Pressable
                      key={member.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${active ? 'Remove' : 'Add'} ${member.name} ${active ? 'from' : 'to'} this item`}
                      onPress={() => toggleItemParticipant(row.key, member.id)}
                      style={[
                        styles.personChip,
                        {
                          backgroundColor: active
                            ? withAlpha(colors.brand, 0.14)
                            : colors.surface2,
                        },
                      ]}
                    >
                      <Avatar name={member.name} color={member.avatarColor} size={18} />
                      <Text
                        style={[
                          styles.personChipText,
                          { color: active ? colors.brand : colors.ink3 },
                        ]}
                      >
                        {member.id === meId ? 'You' : firstName(member.name)}
                      </Text>
                    </Pressable>
                  );
                })}
                {selectedMembers.length === 0 ? (
                  <Text style={[styles.chipHint, { color: colors.ink3 }]}>
                    Select people above to assign this item.
                  </Text>
                ) : null}
              </View>
            </View>
          ))}

          <View style={styles.itemsFooter}>
            <Button
              title="Add item"
              icon="add"
              variant="secondary"
              size="sm"
              onPress={() =>
                set({
                  items: [
                    ...value.items,
                    {
                      key: nextItemKey(),
                      name: '',
                      amount: null,
                      participantIds: [...value.selectedIds],
                    },
                  ],
                })
              }
            />
            {amount !== null && fee !== null ? (
              <Text
                style={[
                  styles.itemsTotal,
                  { color: fee < 0 ? colors.neg : colors.ink3 },
                ]}
              >
                {fee < 0
                  ? `Items ${formatMoney(itemsAssigned, currency)} — ${formatMoney(-fee, currency)} over the total`
                  : fee > 0
                    ? `Items ${formatMoney(itemsAssigned, currency)} · tax/tip ${formatMoney(fee, currency)}`
                    : `Items ${formatMoney(itemsAssigned, currency)}`}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.modeHint, { color: colors.ink3 }]}>
            Total minus items = tax/tip, split proportionally.
          </Text>
        </View>
      ) : null}

      {/* Live preview — same math as the server */}
      {evaluation.computed ? (
        <View style={[styles.preview, { backgroundColor: colors.surface2 }]}>
          <Text style={[styles.previewLabel, { color: colors.ink3 }]}>PREVIEW</Text>
          {evaluation.computed.map((split) => {
            const user = memberById.get(split.userId);
            return (
              <View key={split.userId} style={styles.previewRow}>
                <View style={styles.previewUser}>
                  {user ? <Avatar name={user.name} color={user.avatarColor} size={20} /> : null}
                  <Text numberOfLines={1} style={[styles.previewName, { color: colors.ink }]}>
                    {memberName(split.userId)}
                  </Text>
                </View>
                <Text style={[styles.previewOwes, { color: colors.ink2 }]}>
                  owes{' '}
                  <Text style={[styles.previewAmount, { color: colors.ink }]}>
                    {formatMoney(split.amount, currency)}
                  </Text>
                </Text>
              </View>
            );
          })}
        </View>
      ) : evaluation.error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.evaluationError, { color: colors.danger }]}
        >
          {evaluation.error}
        </Text>
      ) : evaluation.hint ? (
        <Text style={[styles.modeHint, { color: colors.ink3 }]}>{evaluation.hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  modeHint: {
    fontSize: fontSize.sm,
  },
  memberList: {
    borderWidth: 1,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.md,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  memberToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  memberAvatar: {
    marginLeft: spacing.sm + 2,
  },
  memberName: {
    fontSize: fontSize.md,
    marginLeft: spacing.sm,
    flexShrink: 1,
  },
  dimmed: {
    opacity: 0.45,
  },
  exactField: {
    width: 118,
  },
  percentField: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 92,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm + 2,
  },
  percentInput: {
    flex: 1,
    fontSize: fontSize.md,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    paddingVertical: spacing.xs,
  },
  percentSuffix: {
    fontSize: fontSize.md,
    marginLeft: 2,
  },
  adjustmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  signButton: {
    width: 36,
    height: 40,
    borderWidth: 1,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  adjustmentField: {
    width: 104,
  },
  remaining: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'right',
  },
  itemsBlock: {
    gap: spacing.md,
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: radii.xl,
    padding: spacing.md,
    gap: spacing.sm + 2,
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemNameField: {
    flex: 1,
    minWidth: 0,
  },
  itemAmountField: {
    width: 108,
  },
  itemDelete: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.full,
    paddingVertical: 3,
    paddingLeft: 3,
    paddingRight: spacing.sm + 2,
    gap: spacing.xs + 1,
  },
  personChipText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  chipHint: {
    fontSize: fontSize.xs,
  },
  itemsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  itemsTotal: {
    flex: 1,
    fontSize: fontSize.sm,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  preview: {
    borderRadius: radii.xl,
    padding: spacing.md,
    gap: spacing.sm,
  },
  previewLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  previewUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    minWidth: 0,
  },
  previewName: {
    fontSize: fontSize.sm,
    flexShrink: 1,
  },
  previewOwes: {
    fontSize: fontSize.sm,
  },
  previewAmount: {
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  evaluationError: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
