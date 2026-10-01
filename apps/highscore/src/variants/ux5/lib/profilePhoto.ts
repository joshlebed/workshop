import * as ImagePicker from "expo-image-picker";

export interface PickedProfilePhoto {
  /** `data:image/jpeg;base64,…` URL ready to send to the API. */
  dataUrl: string;
}

/**
 * Open the system image picker, crop to a square, and return a base64
 * `data:` URL. Returns `null` if the user cancels or denies permission.
 *
 * The backend caps the avatar at ~1.5MB of base64. We aim well under that by
 * capping quality at 0.5 and letting the picker downscale via
 * `allowsEditing: true` (which forces a crop step on iOS that also resamples
 * to a reasonable size). If a future regression makes the resulting payload
 * too large, add expo-image-manipulator and resize here to ~1024px max edge.
 */
export async function pickProfilePhoto(): Promise<PickedProfilePhoto | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.5,
    base64: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;

  // Prefer the base64 payload (iOS/Android). On web, expo-image-picker
  // returns a `data:` URL in `uri` and `base64` may be empty — handle both.
  if (asset.base64) {
    const mime = mimeFromUri(asset.uri) ?? "image/jpeg";
    return { dataUrl: `data:${mime};base64,${asset.base64}` };
  }
  if (asset.uri.startsWith("data:")) {
    return { dataUrl: asset.uri };
  }
  return null;
}

function mimeFromUri(uri: string): string | null {
  const m = uri.match(/^data:([^;]+);/);
  if (m) return m[1] ?? null;
  if (/\.png(\?|$)/i.test(uri)) return "image/png";
  if (/\.webp(\?|$)/i.test(uri)) return "image/webp";
  if (/\.gif(\?|$)/i.test(uri)) return "image/gif";
  return "image/jpeg";
}
