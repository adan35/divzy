import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  GROUP_TYPES,
  LIMITS,
  SPLIT_TYPES,
  SPLIT_TYPE_LABELS,
  categoryInfo,
  groupTemplate,
  type ExpenseCategory,
  type GroupType,
  type SplitType,
} from '@divzy/shared';
import {
  Button,
  CurrencyPicker,
  ErrorState,
  Input,
  Screen,
  SkeletonList,
} from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { pickerEmojis } from '@/lib/emojiPicker';
import { errorMessage, useCreateGroup, useGroup, useUpdateGroup } from '@/lib/hooks';
import {
  applyTypeChangeToTemplate,
  initialTemplateState,
  toggleCategorySelection,
} from '@/lib/groupTemplateSelection';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

function typeLabel(type: GroupType): string {
  return GROUP_TYPES.find((t) => t.key === type)?.label ?? type;
}

export default function GroupFormScreen() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const isEdit = groupId.length > 0;

  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();

  const groupQ = useGroup(groupId, isEdit);
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string>('👥');
  const [emojiTouched, setEmojiTouched] = useState(false);
  // WI-031 — search narrows the bounded, scrollable emoji panel below; never
  // reflows the rest of the form. Clearing the query restores the full set.
  const [emojiQuery, setEmojiQuery] = useState('');
  const emojiChoices = pickerEmojis(emojiQuery, emoji);
  const [type, setType] = useState<GroupType>('OTHER');
  const [currency, setCurrency] = useState(user?.defaultCurrency ?? 'USD');
  const [simplifyDebts, setSimplifyDebts] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // WI-020 — group-creation templates. Create-only, presentational, discarded
  // on submit: `categoryOptions` is the candidate chip list (frozen once
  // touched, refreshed on type change until then); `selectedCategories` is
  // the subset currently toggled on within that candidate list. Independent
  // `categoriesTouched`/`splitTypeTouched` flags mirror `emojiTouched` — an
  // override survives a later type switch instead of being clobbered.
  const [categoryOptions, setCategoryOptions] = useState<readonly ExpenseCategory[]>(
    () => initialTemplateState('OTHER').categoryOptions,
  );
  const [selectedCategories, setSelectedCategories] = useState<readonly ExpenseCategory[]>(
    () => initialTemplateState('OTHER').selectedCategories,
  );
  const [splitType, setSplitType] = useState<SplitType | undefined>(
    () => initialTemplateState('OTHER').splitType,
  );
  const [categoriesTouched, setCategoriesTouched] = useState(false);
  const [splitTypeTouched, setSplitTypeTouched] = useState(false);

  // Load existing values once when editing.
  useEffect(() => {
    if (isEdit && groupQ.data && !initialized) {
      setName(groupQ.data.name);
      setEmoji(groupQ.data.emoji);
      setEmojiTouched(true);
      setType(groupQ.data.type);
      setCurrency(groupQ.data.currency);
      setSimplifyDebts(groupQ.data.simplifyDebts);
      // Edit path never renders the template block (spec-WI-020) — clear any
      // state and mark both fields touched so a later type change made while
      // editing can't repopulate a stale suggestion.
      setCategoryOptions([]);
      setSelectedCategories([]);
      setSplitType(undefined);
      setCategoriesTouched(true);
      setSplitTypeTouched(true);
      setInitialized(true);
    }
  }, [isEdit, groupQ.data, initialized]);

  const selectType = (nextType: GroupType) => {
    setType(nextType);
    if (!emojiTouched) {
      const info = GROUP_TYPES.find((t) => t.key === nextType);
      if (info) setEmoji(info.emoji);
    }
    // Same rule, per field, for the template suggestions (spec-WI-020 D4):
    // refresh an untouched field to the new type's template, or clear it if
    // the new type has none; leave an already-touched override intact.
    // Delegated to src/lib/groupTemplateSelection.ts (unit-tested).
    const next = applyTypeChangeToTemplate(
      { categoryOptions, selectedCategories, splitType, categoriesTouched, splitTypeTouched },
      nextType,
    );
    setCategoryOptions(next.categoryOptions);
    setSelectedCategories(next.selectedCategories);
    setSplitType(next.splitType);
  };

  const toggleCategory = (key: ExpenseCategory) => {
    setCategoriesTouched(true);
    setSelectedCategories((prev) => toggleCategorySelection(prev, key));
  };

  const handleSplitTypeChange = (next: SplitType) => {
    setSplitTypeTouched(true);
    setSplitType(next);
  };

  const template = !isEdit ? groupTemplate(type) : undefined;

  const saving = createGroup.isPending || updateGroup.isPending;
  const canSave = name.trim().length > 0 && !saving && (!isEdit || initialized);

  const submit = () => {
    if (!canSave) return;
    setSubmitError(null);
    const payload = {
      name: name.trim(),
      emoji,
      type,
      currency,
      simplifyDebts,
    };
    if (isEdit) {
      updateGroup.mutate(
        { groupId, input: payload },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
              () => undefined,
            );
            router.replace('/(tabs)/groups');
          },
          onError: (err) => setSubmitError(errorMessage(err)),
        },
      );
    } else {
      createGroup.mutate(payload, {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          router.replace('/(tabs)/groups');
        },
        onError: (err) => setSubmitError(errorMessage(err)),
      });
    }
  };

  return (
    <Screen scroll keyboardShouldPersistTaps="handled">
      {/* Modal header */}
      <View style={styles.header}>
        {/* WI-068 AC-10b (defect-WI-068-1): 44pt target (spec §12) via the
            hitSlop idiom — text stays visually unchanged (explicit 20pt
            lineHeight + 12pt slop each side = 44pt tall; width 60 + slop). */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        >
          {({ pressed }) => (
            <Text style={[styles.cancel, { color: pressed ? colors.brandHover : colors.brand }]}>
              Cancel
            </Text>
          )}
        </Pressable>
        <Text style={[styles.title, { color: colors.ink }]}>
          {isEdit ? 'Edit group' : 'New group'}
        </Text>
        <View style={styles.cancelSpacer} />
      </View>

      {isEdit && groupQ.isLoading ? (
        <SkeletonList rows={5} avatar={false} style={styles.skeleton} />
      ) : isEdit && (groupQ.isError || (!groupQ.isLoading && !groupQ.data)) ? (
        <ErrorState message={errorMessage(groupQ.error)} onRetry={() => void groupQ.refetch()} />
      ) : (
        <>
          {submitError ? (
            <View style={[styles.banner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
              <Text style={[styles.bannerText, { color: colors.danger }]}>{submitError}</Text>
            </View>
          ) : null}

          <Input
            label="Group name"
            value={name}
            onChangeText={setName}
            placeholder="Trip to Lisbon"
            maxLength={LIMITS.GROUP_NAME_MAX}
            autoFocus={!isEdit}
            containerStyle={styles.field}
          />

          <Text style={[styles.label, { color: colors.ink2 }]}>Emoji</Text>
          <Input
            placeholder="Search emoji"
            value={emojiQuery}
            onChangeText={setEmojiQuery}
            autoCapitalize="none"
            autoCorrect={false}
            containerStyle={styles.emojiSearch}
          />
          {/* WI-031 — fixed-size, internally scrollable panel: browsing the
              grid never reflows the name/type/currency fields below. */}
          <ScrollView
            style={[styles.emojiPanel, { borderColor: colors.hairline }]}
            contentContainerStyle={styles.emojiGrid}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {emojiChoices.length === 0 ? (
              <Text style={[styles.emojiEmpty, { color: colors.ink3 }]}>No emoji match.</Text>
            ) : (
              emojiChoices.map((choice) => {
                const selected = choice === emoji;
                return (
                  <Pressable
                    key={choice}
                    accessibilityRole="button"
                    accessibilityLabel={`Emoji ${choice}`}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setEmoji(choice);
                      setEmojiTouched(true);
                    }}
                    style={[
                      styles.emojiCell,
                      { backgroundColor: colors.surface, borderColor: colors.hairline },
                      selected && {
                        backgroundColor: withAlpha(colors.brand, 0.14),
                        borderColor: colors.brand,
                      },
                    ]}
                  >
                    <Text style={styles.emojiText}>{choice}</Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Text style={[styles.label, { color: colors.ink2 }]}>Type</Text>
          <View style={styles.typeRow}>
            {GROUP_TYPES.map((t) => {
              const selected = t.key === type;
              return (
                <Pressable
                  key={t.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => selectType(t.key)}
                  style={[
                    styles.typeChip,
                    { backgroundColor: colors.surface, borderColor: colors.hairline },
                    selected && {
                      backgroundColor: withAlpha(colors.brand, 0.14),
                      borderColor: colors.brand,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.typeChipText,
                      { color: selected ? colors.brand : colors.ink2 },
                    ]}
                  >
                    {t.emoji} {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <CurrencyPicker
            label="Default currency"
            value={currency}
            onChange={setCurrency}
            containerStyle={styles.field}
          />

          {template ? (
            <View
              style={[
                styles.templateBlock,
                { backgroundColor: colors.surface, borderColor: colors.hairline },
              ]}
            >
              <Text style={[styles.templateHint, { color: colors.ink3 }]}>
                Suggested for a {typeLabel(type)} group — you can change these
              </Text>

              <Text style={[styles.label, { color: colors.ink2 }]}>Categories</Text>
              <View style={styles.typeRow}>
                {categoryOptions.map((key) => {
                  const info = categoryInfo(key);
                  const selected = selectedCategories.includes(key);
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      accessibilityLabel={info.label}
                      accessibilityState={{ selected }}
                      onPress={() => toggleCategory(key)}
                      style={[
                        styles.typeChip,
                        { backgroundColor: colors.surface, borderColor: colors.hairline },
                        selected && {
                          backgroundColor: withAlpha(colors.brand, 0.14),
                          borderColor: colors.brand,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.typeChipText,
                          { color: selected ? colors.brand : colors.ink2 },
                        ]}
                      >
                        {info.emoji} {info.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.label, { color: colors.ink2 }]}>Suggested split mode</Text>
              <View style={styles.typeRow}>
                {SPLIT_TYPES.map((st) => {
                  const selected = st === splitType;
                  return (
                    <Pressable
                      key={st}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => handleSplitTypeChange(st)}
                      style={[
                        styles.typeChip,
                        { backgroundColor: colors.surface, borderColor: colors.hairline },
                        selected && {
                          backgroundColor: withAlpha(colors.brand, 0.14),
                          borderColor: colors.brand,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.typeChipText,
                          { color: selected ? colors.brand : colors.ink2 },
                        ]}
                      >
                        {SPLIT_TYPE_LABELS[st]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={[styles.simplifyRow, { borderColor: colors.hairline }]}>
            <View style={styles.simplifyBody}>
              <Text style={[styles.simplifyTitle, { color: colors.ink }]}>Simplify debts</Text>
              <Text style={[styles.simplifyHint, { color: colors.ink3 }]}>
                Combine debts so the group settles with the fewest payments
              </Text>
            </View>
            <Switch
              value={simplifyDebts}
              onValueChange={setSimplifyDebts}
              trackColor={{ false: colors.surface2, true: colors.brand }}
              thumbColor={colors.onBrand}
            />
          </View>

          <Button
            title={isEdit ? 'Save changes' : 'Create group'}
            onPress={submit}
            loading={saving}
            disabled={!canSave}
            size="lg"
            fullWidth
            style={styles.submit}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  cancel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    // Explicit so the 44pt touch-target arithmetic above holds on both
    // platforms (WI-068 AC-10b): 20 + 12 + 12 hitSlop = 44.
    lineHeight: 20,
    width: 60,
  },
  cancelSpacer: {
    width: 60,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  skeleton: {
    marginTop: spacing.lg,
  },
  banner: {
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  field: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  emojiSearch: {
    marginBottom: spacing.sm,
  },
  emojiPanel: {
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: radii.lg,
    marginBottom: spacing.lg,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // WI-068 §9.2 — "emoji picker grid spacing": a bit more breathing room
    // between cells than the pre-retune 8pt gap.
    gap: spacing.md,
    padding: spacing.md,
  },
  emojiEmpty: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingVertical: spacing.lg,
    width: '100%',
  },
  emojiCell: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: {
    fontSize: 22,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  typeChip: {
    borderRadius: radii.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  typeChipText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  templateBlock: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  templateHint: {
    fontSize: fontSize.xs,
    marginBottom: spacing.md,
  },
  simplifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  simplifyBody: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.md,
  },
  simplifyTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  simplifyHint: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  submit: {
    marginBottom: spacing.xl,
  },
});
