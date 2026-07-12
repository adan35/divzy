import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/theme';

export default function AuthLayout() {
  const { status } = useAuth();
  const { colors } = useTheme();

  // Splash screen still covers the app while the session restores.
  if (status === 'loading') return null;
  if (status === 'authed') return <Redirect href="/(tabs)" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.page },
      }}
    />
  );
}
