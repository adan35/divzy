import type { ReactElement, ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { spacing, useTheme } from '@/theme';

export interface ScreenProps {
  children: ReactNode;
  /** Wrap content in a ScrollView (forms/details — lists bring their own FlatList). */
  scroll?: boolean;
  /** Apply the 16px page gutters. Default true. */
  padded?: boolean;
  /** Safe-area edges. Bottom omitted by default (tab bar / home indicator). */
  edges?: Edge[];
  refreshControl?: ReactElement<RefreshControlProps>;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: 'always' | 'handled' | 'never';
}

export function Screen({
  children,
  scroll = false,
  padded = true,
  edges = ['top', 'left', 'right'],
  refreshControl,
  style,
  contentContainerStyle,
  keyboardShouldPersistTaps = 'handled',
}: ScreenProps) {
  const { colors } = useTheme();

  if (scroll) {
    return (
      <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: colors.page }, style]}>
        <ScrollView
          style={styles.root}
          contentContainerStyle={[
            styles.scrollContent,
            padded && styles.padded,
            contentContainerStyle,
          ]}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={edges}
      style={[
        styles.root,
        { backgroundColor: colors.page },
        padded && styles.padded,
        style,
        contentContainerStyle,
      ]}
    >
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  padded: { paddingHorizontal: spacing.lg },
  scrollContent: { paddingBottom: spacing.xxl },
});
