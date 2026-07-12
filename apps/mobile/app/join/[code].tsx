import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ApiError } from '@divzy/api-client';
import { Button, Card, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage, useJoinGroup } from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

export default function JoinGroupScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = (typeof params.code === 'string' ? params.code : '').trim();

  const router = useRouter();
  const { colors } = useTheme();
  const { status } = useAuth();
  const joinGroup = useJoinGroup();
  const [joinError, setJoinError] = useState<string | null>(null);

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
      router.replace('/(tabs)');
    }
  };

  const join = () => {
    if (!code) {
      setJoinError('This invite link is missing its code.');
      return;
    }
    setJoinError(null);
    joinGroup.mutate(code, {
      onSuccess: (group) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => undefined,
        );
        router.replace(`/group/${group.id}`);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'INVALID_CODE') {
          setJoinError('This invite code is invalid or has been rotated. Ask for a fresh link.');
        } else {
          setJoinError(errorMessage(err));
        }
      },
    });
  };

  return (
    <Screen>
      <View style={styles.center}>
        <Card style={styles.card}>
          <Text style={styles.emoji}>👥</Text>
          <Text style={[styles.title, { color: colors.ink }]}>Join group</Text>
          <Text style={[styles.subtitle, { color: colors.ink2 }]}>
            You’ve been invited to a group on Divzy. Join to see its expenses and split
            fairly with everyone.
          </Text>

          <View style={[styles.codePill, { backgroundColor: colors.surface2 }]}>
            <Text style={[styles.codeText, { color: colors.ink }]}>{code || '—'}</Text>
          </View>

          {joinError ? (
            <View style={[styles.banner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
              <Text style={[styles.bannerText, { color: colors.danger }]}>{joinError}</Text>
            </View>
          ) : null}

          <Button
            title="Join group"
            onPress={join}
            loading={joinGroup.isPending}
            disabled={!code || joinGroup.isPending}
            size="lg"
            fullWidth
          />
          <Button
            title="Not now"
            variant="ghost"
            onPress={dismiss}
            disabled={joinGroup.isPending}
            fullWidth
            style={styles.dismiss}
          />
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
