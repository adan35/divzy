'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from 'next-themes';
import { Toaster } from 'sonner';
import { initAuth } from '@/lib/auth-store';

/** Kicks off the silent cookie-based session restore exactly once. */
function AuthBootstrap() {
  useEffect(() => {
    void initAuth();
  }, []);
  return null;
}

/** Sonner toaster that follows the active next-themes theme. */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      richColors
      closeButton
      position="bottom-right"
      theme={resolvedTheme === 'dark' ? 'dark' : resolvedTheme === 'light' ? 'light' : 'system'}
      // WI-068 §9.1: map richColors' success/error rings onto the design
      // tokens (pos / danger) rather than sonner's own hardcoded palette.
      toastOptions={{
        classNames: {
          success: 'ring-1 ring-pos',
          error: 'ring-1 ring-danger',
        },
      }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <AuthBootstrap />
        {children}
        <ThemedToaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
