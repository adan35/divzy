import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { formatMoney, type PublicUserDto } from '@divzy/shared';
import { AmountInput, Avatar } from '@/components/ui';
import { fontSize, radii, spacing, useTheme } from '@/theme';
import type { PayerState } from './split-state';

export interface PayerSelectorProps {
  members: PublicUserDto[];
  meId: string;
  /** Expense total in minor units (null while unentered). */
  amount: number | null;
  currency: string;
  value: PayerState;
  onChange: (next: PayerState) => void;
}

/**
 * "Paid by" control: a modal sheet to pick a single payer or switch to
 * multiple-payers mode, which reveals per-member amount inputs with a live
 * "left to assign" indicator (must reach exactly zero).
 */
export function PayerSelector({
  members,
  meId,
  amount,
  currency,
  value,
  onChange,
}: PayerSelectorProps) {
  const { colors } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const memberById = new Map(members.map((m) => [m.id, m]));

  const displayName = (id: string) =>
    id === meId ? 'you' : memberById.get(id)?.name ?? 'Former member';

  // -- Multi-payer mode -------------------------------------------------------

  if (value.mode === 'multi') {
    const assigned = members.reduce((acc, m) => acc + (value.multiAmounts[m.id] ?? 0), 0);
    const remaining = amount !== null ? amount - assigned : null;
    return (
      <View style={[styles.multiCard, { borderColor: colors.hairline }]}>
        <View style={styles.multiHeader}>
          <Text style={[styles.multiTitle, { color: colors.ink2 }]}>Paid by multiple people</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange({ ...value, mode: 'single' })}
            hitSlop={8}
          >
            {({ pressed }) => (
              <Text
                style={[styles.linkText, { color: pressed ? colors.brandHover : colors.brand }]}
              >
                Single payer
              </Text>
            )}
          </Pressable>
        </View>
        {members.map((member) => (
          <View key={member.id} style={styles.multiRow}>
            <Avatar
              name={member.name}
              color={member.avatarColor}
              avatarUrl={member.avatarUrl}
              size={28}
            />
            <Text numberOfLines={1} style={[styles.multiName, { color: colors.ink }]}>
              {member.id === meId ? 'You' : member.name}
            </Text>
            <AmountInput
              size="md"
              currency={currency}
              value={value.multiAmounts[member.id] ?? null}
              onChange={(v) =>
                onChange({ ...value, multiAmounts: { ...value.multiAmounts, [member.id]: v } })
              }
              containerStyle={styles.multiAmount}
            />
          </View>
        ))}
        {remaining === null ? (
          <Text style={[styles.remainingMuted, { color: colors.ink3 }]}>
            Enter the expense amount to assign payments.
          </Text>
        ) : remaining === 0 ? (
          <Text style={[styles.remainingLine, { color: colors.pos }]}>All assigned ✓</Text>
        ) : (
          <Text
            style={[
              styles.remainingLine,
              { color: remaining > 0 ? colors.warning : colors.neg },
            ]}
          >
            {formatMoney(Math.abs(remaining), currency)}{' '}
            {remaining > 0 ? 'left to assign' : 'over'}
          </Text>
        )}
      </View>
    );
  }

  // -- Single-payer mode --------------------------------------------------------

  const selected = memberById.get(value.singleId);

  const pickSingle = (id: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    onChange({ ...value, mode: 'single', singleId: id });
    setPickerOpen(false);
  };

  const switchToMulti = () => {
    Haptics.selectionAsync().catch(() => undefined);
    // Seed the current single payer with the full amount so the user only
    // redistributes instead of retyping everything.
    const seeded: Record<string, number | null> = { ...value.multiAmounts };
    if (amount !== null && amount > 0 && Object.values(seeded).every((v) => !v)) {
      seeded[value.singleId] = amount;
    }
    onChange({ ...value, mode: 'multi', multiAmounts: seeded });
    setPickerOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Paid by ${displayName(value.singleId)}. Change payer`}
        onPress={() => setPickerOpen(true)}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: pressed ? colors.surface2 : colors.surface,
            borderColor: colors.hairline,
          },
        ]}
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
        <Text numberOfLines={1} style={[styles.fieldText, { color: colors.ink }]}>
          Paid by <Text style={styles.fieldName}>{displayName(value.singleId)}</Text>
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.ink3} />
      </Pressable>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}
      >
        <SafeAreaView
          edges={['top', 'left', 'right', 'bottom']}
          style={[styles.modal, { backgroundColor: colors.page }]}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.ink }]}>Who paid?</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setPickerOpen(false)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: pressed ? colors.surface2 : 'transparent' },
              ]}
            >
              <Ionicons name="close" size={22} color={colors.ink2} />
            </Pressable>
          </View>
          <FlatList
            data={members}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
            )}
            renderItem={({ item }) => {
              const isSelected = item.id === value.singleId;
              return (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => pickSingle(item.id)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: colors.surface2 },
                  ]}
                >
                  <Avatar
                    name={item.name}
                    color={item.avatarColor}
                    avatarUrl={item.avatarUrl}
                    size={36}
                  />
                  <Text numberOfLines={1} style={[styles.rowName, { color: colors.ink }]}>
                    {item.name}
                    {item.id === meId ? <Text style={{ color: colors.ink3 }}> (you)</Text> : null}
                  </Text>
                  {isSelected ? (
                    <Ionicons name="checkmark" size={20} color={colors.brand} />
                  ) : null}
                </Pressable>
              );
            }}
            ListFooterComponent={
              <>
                <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
                <Pressable
                  accessibilityRole="button"
                  onPress={switchToMulti}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: colors.surface2 },
                  ]}
                >
                  <View style={[styles.multiIcon, { backgroundColor: colors.surface2 }]}>
                    <Ionicons name="people-outline" size={19} color={colors.ink2} />
                  </View>
                  <Text style={[styles.rowName, { color: colors.ink }]}>Multiple people</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.ink3} />
                </Pressable>
              </>
            }
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  fieldText: {
    flex: 1,
    fontSize: fontSize.md,
  },
  fieldName: {
    fontWeight: '600',
  },
  multiCard: {
    borderWidth: 1,
    borderRadius: radii.xl,
    padding: spacing.md,
    gap: spacing.sm + 2,
  },
  multiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  multiTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  linkText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  multiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  multiName: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.md,
  },
  multiAmount: {
    width: 118,
  },
  remainingLine: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'right',
  },
  remainingMuted: {
    fontSize: fontSize.sm,
    textAlign: 'right',
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
  closeButton: {
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowName: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  multiIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
