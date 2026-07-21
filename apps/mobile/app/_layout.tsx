import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ThemeProvider, useTheme } from '@/theme';
import { CelebrationOverlay } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useRealtimeSync } from '@/lib/socket';
import {
  persistBuster,
  persistMaxAge,
  queryPersister,
  shouldPersistQuery,
} from '@/lib/query-persist';

// Keep the splash visible until the session restore has resolved.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Mounts the socket sync while authed (must live inside all providers). */
function RealtimeSync() {
  useRealtimeSync();
  return null;
}

function RootNavigator() {
  const { status } = useAuth();
  const { colors } = useTheme();

  useEffect(() => {
    if (status !== 'loading') {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [status]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.page },
      }}
    >
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="expense/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="expense/[id]" />
      <Stack.Screen name="group/[id]" />
      <Stack.Screen name="group-form" options={{ presentation: 'modal' }} />
      <Stack.Screen name="friend/[id]" />
      <Stack.Screen name="settle" options={{ presentation: 'modal' }} />
      {/* WI-039b — settlement detail, modal-presented (spec-WI-039b §4),
          deliberately different from expense/[id]'s full-screen push. */}
      <Stack.Screen name="settlement/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="join/[code]" />
      <Stack.Screen name="add-friend/[code]" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="notification-preferences" />
      <Stack.Screen name="analytics" />
      <Stack.Screen name="recurring" />
    </Stack>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <ThemeProvider>
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
              persister: queryPersister,
              maxAge: persistMaxAge,
              buster: persistBuster,
              // WI-076 — only persist a small allowlist of reference-data
              // queries; see query-persist.ts for why.
              dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
            }}
          >
            <AuthProvider>
              <RealtimeSync />
              <RootNavigator />
              {/* spec-WI-068 §7 — root-mounted so a settle-success
                  celebration survives the `router.back()` navigation that
                  follows it. Inert (renders null) while idle. */}
              <CelebrationOverlay />
              <StatusBar style="auto" />
            </AuthProvider>
          </PersistQueryClientProvider>
        </ThemeProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
