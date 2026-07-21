import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ApiError } from '@divzy/api-client';
import { Button, Card, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage, useAddFriendByCode } from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

/**
 * WI-040 — deep-link handler for a friend-add share link
 * (`divzy://add-friend/<code>` or the web share URL), mirroring
 * `app/join/[code].tsx`'s pattern exactly. The known `divzy://`-only deep
 * link limitation (no universal links) applies unchanged — not solved here.
 */
export default function AddFriendByCodeScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = (typeof params.code === 'string' ? params.code : '').trim();

  const router = useRouter();
  const { colors } = useTheme();
  const { status } = useAuth();
  const addFriendByCode = useAddFriendByCode();
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  if (status === 'loading') {
    return (
      <Screen>
        <View />
      </Screen>
    );
  }
  if (status === 'guest') return <Redirect href="/(auth)/login" />;

  const dismiss = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/friends');
    }
  };

  const add = () => {
    if (!code) {
      setAddError('This link is missing its code.');
      return;
    }
    setAddError(null);
    addFriendByCode.mutate(
      { code },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          setAdded(true);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'CANNOT_ADD_SELF') {
            setAddError('That’s your own code — share it with someone else instead.');
          } else if (err instanceof ApiError && err.code === 'INVALID_CODE') {
            setAddError('This code is invalid or has been regenerated. Ask for a fresh one.');
          } else {
            setAddError(errorMessage(err));
          }
        },
      },
    );
  };

  return (
    <Screen>
      <View style={styles.center}>
        <Card style={styles.card}>
          <Text style={styles.emoji}>{added ? '🎉' : '🤝'}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>
            {added ? 'Friend added' : 'Add friend'}
          </Text>
          {!added ? (
            <Text style={[styles.subtitle, { color: colors.ink2 }]}>
              Someone shared their Divzy friend code with you. Add them to split expenses
              and settle up directly.
            </Text>
          ) : null}

          {!added ? (
            <View style={[styles.codePill, { backgroundColor: colors.surface2 }]}>
              <Text style={[styles.codeText, { color: colors.ink }]}>{code || '—'}</Text>
            </View>
          ) : null}

          {addError ? (
            <View style={[styles.banner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
              <Text style={[styles.bannerText, { color: colors.danger }]}>{addError}</Text>
            </View>
          ) : null}

          {added ? (
            <Button title="Done" onPress={dismiss} size="lg" fullWidth />
          ) : (
            <>
              <Button
                title="Add friend"
                onPress={add}
                loading={addFriendByCode.isPending}
                disabled={!code || addFriendByCode.isPending}
                size="lg"
                fullWidth
              />
              <Button
                title="Not now"
                variant="ghost"
                onPress={dismiss}
                disabled={addFriendByCode.isPending}
                fullWidth
                style={styles.dismiss}
              />
            </>
          )}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: spacing.xxl,
  },
  card: {
    alignItems: 'stretch',
  },
  emoji: {
    fontSize: 44,
    textAlign: 'center',
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  subtitle: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  codePill: {
    alignSelf: 'center',
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginVertical: spacing.lg,
  },
  codeText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    letterSpacing: 3,
    fontVariant: ['tabular-nums'],
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
  dismiss: {
    marginTop: spacing.sm,
  },
});
