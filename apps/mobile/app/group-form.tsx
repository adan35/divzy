import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { GROUP_TYPES, LIMITS, type GroupType } from '@divzy/shared';
import {
  Button,
  CurrencyPicker,
  ErrorState,
  Input,
  Screen,
  SkeletonList,
} from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage, useCreateGroup, useGroup, useUpdateGroup } from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

const EMOJI_CHOICES = [
  '✈️', '🏠', '❤️', '👥', '💼', '📋',
  '🍕', '🛒', '🚗', '🎉', '🏖️', '🎿',
  '🎓', '🐾', '🏋️', '🎮', '🎬', '⚽',
  '🎂', '🍻', '🛠️', '🌮', '⛺', '💸',
] as const;

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
  const [type, setType] = useState<GroupType>('OTHER');
  const [currency, setCurrency] = useState(user?.defaultCurrency ?? 'USD');
  const [simplifyDebts, setSimplifyDebts] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load existing values once when editing.
  useEffect(() => {
    if (isEdit && groupQ.data && !initialized) {
      setName(groupQ.data.name);
      setEmoji(groupQ.data.emoji);
      setEmojiTouched(true);
      setType(groupQ.data.type);
      setCurrency(groupQ.data.currency);
      setSimplifyDebts(groupQ.data.simplifyDebts);
      setInitialized(true);
    }
  }, [isEdit, groupQ.data, initialized]);

  const selectType = (nextType: GroupType) => {
    setType(nextType);
    if (!emojiTouched) {
      const info = GROUP_TYPES.find((t) => t.key === nextType);
      if (info) setEmoji(info.emoji);
    }
  };

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
            router.back();
          },
          onError: (err) => setSubmitError(errorMessage(err)),
        },
      );
    } else {
      createGroup.mutate(payload, {
        onSuccess: (group) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          router.replace(`/group/${group.id}`);
        },
        onError: (err) => setSubmitError(errorMessage(err)),
      });
    }
  };

  return (
    <Screen scroll keyboardShouldPersistTaps="handled">
      {/* Modal header */}
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
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
          <View style={styles.emojiGrid}>
            {EMOJI_CHOICES.map((choice) => {
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
            })}
          </View>

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
              thumbColor="#ffffff"
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
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
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
