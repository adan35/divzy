import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Button, Input } from '@/components/ui';
import { errorMessage, useSubmitManualRate } from '@/lib/hooks';
import type { ManualRatePair } from '@/lib/manualRatePrompt';
import { fontSize, radii, spacing, topEdgeHighlight, useTheme } from '@/theme';

export interface ManualRatePromptDialogProps {
  /** null renders nothing — dedupe/queueing lives in useManualRatePrompt. */
  prompt: ManualRatePair | null;
  onClose: () => void;
}

/**
 * "1 {currency} = ? {viewerCurrency}" fallback prompt (story-WI-002),
 * shared by the dashboard and the group Balances tab. Submits to
 * POST /api/v1/rates/manual; on success the triggering balance query is
 * invalidated so the figure resolves immediately. Declining/dismissing
 * makes no API call, persists no rate, and never re-prompts for this pair
 * within the session — that dedupe is owned by useManualRatePrompt, not
 * this component. Settling the underlying debt is entirely unaffected by
 * this dialog (spec-WI-002, "Settling is unaffected by a manual rate").
 */
export function ManualRatePromptDialog({ prompt, onClose }: ManualRatePromptDialogProps) {
  const { colors, scheme } = useTheme();
  const [rateText, setRateText] = useState('');
  const submitRate = useSubmitManualRate();

  if (!prompt) return null;

  const parsed = Number(rateText);
  const isValid = rateText.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;

  const reset = () => {
    setRateText('');
    submitRate.reset();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!isValid) return;
    submitRate.mutate(
      { from: prompt.currency, to: prompt.viewerCurrency, rate: parsed },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
      },
    );
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleClose}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        {/* spec-WI-068 §1.1/§9.1 — dialogs sit on `elevated`, light-mode
            shadow-pop; dark elevation is border + top-edge highlight, never
            a shadow (mirrors Card, ui/Card.tsx). */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.elevated, borderColor: colors.hairline },
            scheme === 'light' ? [styles.shadowPop, { shadowColor: colors.ink }] : styles.darkBorder,
          ]}
        >
          {scheme === 'dark' ? (
            <View pointerEvents="none" style={[styles.topEdge, { backgroundColor: topEdgeHighlight }]} />
          ) : null}
          <Text style={[styles.title, { color: colors.ink }]}>Exchange rate needed</Text>
          <Text style={[styles.subtitle, { color: colors.ink2 }]}>
            We couldn’t automatically convert {prompt.currency} to {prompt.viewerCurrency}. Enter
            the rate yourself:
          </Text>
          <Text style={[styles.equation, { color: colors.ink3 }]}>
            1 {prompt.currency} = ? {prompt.viewerCurrency}
          </Text>
          <Input
            autoFocus
            keyboardType="decimal-pad"
            placeholder={`Rate in ${prompt.viewerCurrency}`}
            value={rateText}
            onChangeText={setRateText}
            containerStyle={styles.input}
          />
          {submitRate.isError ? (
            <Text style={[styles.error, { color: colors.danger }]}>
              {errorMessage(submitRate.error)}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button
              title="Not now"
              variant="secondary"
              onPress={handleClose}
              disabled={submitRate.isPending}
              style={styles.actionButton}
            />
            <Button
              title="Save rate"
              onPress={handleSubmit}
              loading={submitRate.isPending}
              disabled={!isValid}
              style={styles.actionButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  // shadow-2/"shadow-pop" (spec §1.1): 0 4px 16px rgba(15,23,42,0.08), light
  // only — `shadowColor` is applied inline (theme's `colors.ink`), never a
  // static hex here (story AC-2: no raw semantic hex in src/components/**).
  shadowPop: {
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  darkBorder: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Inset from the corners so the 1px line stays inside the border radius
  // (mirrors ui/Card.tsx's dark top-edge highlight treatment).
  topEdge: {
    position: 'absolute',
    top: StyleSheet.hairlineWidth,
    left: radii.lg,
    right: radii.lg,
    height: 1,
    borderRadius: 0.5,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  equation: {
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  input: {
    marginBottom: spacing.sm,
  },
  error: {
    fontSize: fontSize.sm,
    marginBottom: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
