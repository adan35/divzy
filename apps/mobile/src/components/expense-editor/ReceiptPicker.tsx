import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Button } from '@/components/ui';
import { apiUrl } from '@/lib/api';
import { errorMessage, useUploadReceipt } from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme } from '@/theme';

export interface ReceiptPickerProps {
  /** Server path of the attached receipt (e.g. "/uploads/receipts/x.jpg"). */
  value: string | null;
  onChange: (url: string | null) => void;
}

function isPdf(url: string): boolean {
  return /\.pdf(\?.*)?$/i.test(url);
}

/**
 * Attach a receipt photo: camera or library via expo-image-picker, uploaded
 * through the API's multipart endpoint, previewed as a thumbnail.
 */
export function ReceiptPicker({ value, onChange }: ReceiptPickerProps) {
  const { colors } = useTheme();
  const upload = useUploadReceipt();
  const [error, setError] = useState<string | null>(null);

  const handleAsset = (asset: ImagePicker.ImagePickerAsset) => {
    setError(null);
    const extension = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
    const name = asset.fileName ?? `receipt-${Date.now()}.${extension}`;
    const type = asset.mimeType ?? 'image/jpeg';
    upload.mutate(
      { uri: asset.uri, name, type },
      {
        onSuccess: (res) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          onChange(res.url);
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  const pickFromLibrary = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
      });
      const asset = result.assets?.[0];
      if (!result.canceled && asset) handleAsset(asset);
    } catch {
      setError('Could not open your photo library.');
    }
  };

  const takePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Camera access is needed to photograph a receipt.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      const asset = result.assets?.[0];
      if (!result.canceled && asset) handleAsset(asset);
    } catch {
      setError('Could not open the camera.');
    }
  };

  const openPicker = () => {
    setError(null);
    Alert.alert('Attach receipt', undefined, [
      { text: 'Take photo', onPress: () => void takePhoto() },
      { text: 'Choose from library', onPress: () => void pickFromLibrary() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (value) {
    return (
      <View>
        <View style={[styles.attached, { borderColor: colors.hairline }]}>
          {isPdf(value) ? (
            <View style={[styles.pdfBubble, { backgroundColor: colors.surface2 }]}>
              <Ionicons name="document-text-outline" size={20} color={colors.ink2} />
            </View>
          ) : (
            <Image
              source={{ uri: apiUrl(value) }}
              style={[styles.thumbnail, { backgroundColor: colors.surface2 }]}
              contentFit="cover"
              accessibilityLabel="Receipt thumbnail"
            />
          )}
          <Text style={[styles.attachedText, { color: colors.ink }]}>Receipt attached</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove receipt"
            onPress={() => {
              setError(null);
              onChange(null);
            }}
            hitSlop={8}
            style={({ pressed }) => [
              styles.removeButton,
              { backgroundColor: pressed ? colors.surface2 : 'transparent' },
            ]}
          >
            <Ionicons name="close" size={18} color={colors.ink3} />
          </Pressable>
        </View>
        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View>
      <Button
        title={upload.isPending ? 'Uploading…' : 'Attach receipt'}
        icon="attach"
        variant="secondary"
        size="sm"
        loading={upload.isPending}
        onPress={openPicker}
      />
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  attached: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.xs + 2,
    paddingRight: spacing.sm,
    gap: spacing.sm,
  },
  thumbnail: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
  },
  pdfBubble: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachedText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
});
