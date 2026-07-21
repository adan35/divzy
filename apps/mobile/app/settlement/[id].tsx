import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Badge, Card, ErrorState, MoneyText, Skeleton, SkeletonList } from '@/components/ui';
import { apiUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateFull, formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/hooks';
import { isProofPdf, settlementMethodLabel, settlementPartyLine } from '@/lib/settlements';
import { useSettlementActions } from '@/hooks/useSettlementActions';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Settlement detail (WI-039b, restore added WI-054b) — modal-presented (see
 * `_layout.tsx`'s `presentation: 'modal'` registration, deliberately
 * different from `expense/[id].tsx`'s full-screen push, per spec-WI-039b
 * §4). Renders the same data points as the web `SettlementDetailDialog`:
 * amount/currency, who paid whom, date, method, group (when group-scoped),
 * note, proof — with a group-admin-or-party-gated delete action, a
 * symmetric restore action once deleted, and a clean deleted state,
 * mirroring `expense/[id].tsx`'s structure (header, loading/error states,
 * deleted banner) adapted to settlement fields. Delete and restore are
 * mutually exclusive per spec-WI-054b §4.3's naming invariant — exactly one
 * of the two is ever shown for a given viewer/settlement.
 */
export default function SettlementDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user: me } = useAuth();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const settlementId = firstParam(params.id);

  const {
    settlement,
    isLoading,
    isError,
    isRefetching,
    error,
    refetch,
    canDelete,
    isDeleting,
    confirmDelete,
    canRestore,
    isRestoring,
    restore,
  } = useSettlementActions(settlementId);

  const isDeleted = !!settlement?.deletedAt;
  const proofIsPdf = !!settlement?.proofUrl && isProofPdf(settlement.proofUrl);

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.page }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
          ]}
        >
          <Ionicons name="close" size={24} color={colors.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>Settlement</Text>
        <View style={styles.headerActions}>
          {canDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete settlement"
              disabled={isDeleting}
              onPress={confirmDelete}
              hitSlop={8}
              style={({ pressed }) => [
                styles.headerButton,
                {
                  backgroundColor: pressed ? colors.surface2 : 'transparent',
                  opacity: isDeleting ? 0.4 : 1,
                },
              ]}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          ) : null}
          {canRestore ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Restore settlement"
              disabled={isRestoring}
              onPress={restore}
              hitSlop={8}
              style={({ pressed }) => [
                styles.headerButton,
                {
                  backgroundColor: pressed ? colors.surface2 : 'transparent',
                  opacity: isRestoring ? 0.4 : 1,
                },
              ]}
            >
              <Ionicons name="arrow-undo-outline" size={20} color={colors.ink2} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.gutters}>
          <View style={styles.heroSkeleton}>
            <Skeleton width={56} height={56} radius={28} />
            <Skeleton width="60%" height={22} style={styles.skeletonGap} />
            <Skeleton width={120} height={30} style={styles.skeletonGap} />
          </View>
          <SkeletonList rows={3} />
        </View>
      ) : isError || !settlement ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : (
        <ScrollView
          style={styles.root}
          contentContainerStyle={[styles.gutters, styles.content]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={colors.ink3} />
          }
        >
          {isDeleted ? (
            <View
              style={[styles.deletedBanner, { backgroundColor: withAlpha(colors.neg, 0.12) }]}
            >
              <Ionicons name="arrow-undo-outline" size={16} color={colors.neg} />
              <Text style={[styles.deletedText, { color: colors.neg }]}>
                This settlement was deleted.
              </Text>
            </View>
          ) : null}

          {/* Hero */}
          <View style={styles.hero}>
            {/* WI-068 §9.2 — amounts via MoneyText (tabular numerals hard-
                applied). A settlement's `amount` is always a positive
                historical payment figure, not a "you owe"/"owed to you"
                position — `colored={false}` keeps it neutral ink, matching
                the plain-Text rendering this replaces byte-for-byte. */}
            <MoneyText
              amount={settlement.amount}
              currency={settlement.currency}
              colored={false}
              size={fontSize.hero}
              weight="700"
              style={styles.heroAmount}
            />
            <Text style={[styles.heroParties, { color: colors.ink }]}>
              {settlementPartyLine(settlement, me?.id)}
            </Text>
            <Text style={[styles.heroMeta, { color: colors.ink3 }]}>
              {settlementMethodLabel(settlement.method)} · {formatDateFull(settlement.date)}
              {settlement.group ? ` · ${settlement.group.emoji} ${settlement.group.name}` : ''}
            </Text>
            {isDeleted ? <Badge label="Deleted" tone="neg" style={styles.heroBadge} /> : null}
          </View>

          {/* Note */}
          {settlement.note ? (
            <Card style={styles.notesCard}>
              <Text style={[styles.sectionTitle, { color: colors.ink3 }]}>NOTE</Text>
              <Text style={[styles.notesText, { color: colors.ink2 }]}>{settlement.note}</Text>
            </Card>
          ) : null}

          {/* Proof */}
          {settlement.proofUrl ? (
            proofIsPdf ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open proof PDF"
                onPress={() => {
                  Linking.openURL(apiUrl(settlement.proofUrl!)).catch(() =>
                    Alert.alert('Could not open the proof.'),
                  );
                }}
                style={({ pressed }) => [
                  styles.pdfRow,
                  {
                    borderColor: colors.hairline,
                    backgroundColor: pressed ? colors.surface2 : colors.surface,
                  },
                ]}
              >
                <Ionicons name="document-text-outline" size={20} color={colors.ink2} />
                <Text style={[styles.pdfText, { color: colors.ink }]}>Proof (PDF)</Text>
                <Ionicons name="open-outline" size={18} color={colors.ink3} />
              </Pressable>
            ) : (
              <Image
                source={{ uri: apiUrl(settlement.proofUrl) }}
                style={[styles.proofImage, { backgroundColor: colors.surface2 }]}
                contentFit="cover"
                accessibilityLabel="Proof image"
              />
            )
          ) : null}

          {/* Provenance footer */}
          <Text style={[styles.provenance, { color: colors.ink3 }]}>
            Recorded by {me && settlement.createdBy.id === me.id ? 'You' : settlement.createdBy.name}{' '}
            · {formatRelative(settlement.createdAt)}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  gutters: {
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginLeft: spacing.xs,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  heroSkeleton: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  skeletonGap: {
    marginTop: spacing.md,
  },
  content: {
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  deletedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  deletedText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  hero: {
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  // fontSize/weight/tabular-nums now come from MoneyText's own props.
  heroAmount: {},
  heroParties: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  heroMeta: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.xs + 2,
  },
  heroBadge: {
    marginTop: spacing.sm + 2,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  notesCard: {
    gap: spacing.xs,
  },
  notesText: {
    fontSize: fontSize.md,
    lineHeight: 21,
  },
  pdfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm + 2,
  },
  pdfText: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  proofImage: {
    width: '100%',
    height: 220,
    borderRadius: radii.xl,
  },
  provenance: {
    fontSize: fontSize.xs,
    textAlign: 'center',
  },
});
