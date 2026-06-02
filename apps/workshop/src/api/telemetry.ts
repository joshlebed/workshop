import { apiRequest } from "../lib/api";

/**
 * A structured snapshot of what `useShareIntent()` handed us, sent to the server
 * so the iOS share-extension payload shape is debuggable without a Mac/device
 * debugger. The extension is native (not exercised by CI or web), so this is the
 * only window into "did the result text survive the share sheet, or did we only
 * get the game's referral URL?". Fire-and-forget — never block the share flow.
 */
export interface ShareIntentTelemetry {
  source?: string;
  type?: string | null;
  hasWebUrl: boolean;
  webUrlLen: number;
  hasText: boolean;
  textLen: number;
  textPreview?: string;
  webUrlPreview?: string;
  fileCount?: number;
  metaKeys?: string[];
  runtimeVersion?: string | null;
  updateId?: string | null;
}

export async function reportShareIntent(
  snapshot: ShareIntentTelemetry,
  token: string | null,
): Promise<void> {
  try {
    await apiRequest<{ ok: boolean }>({
      method: "POST",
      path: "/v1/telemetry/share-intent",
      body: snapshot,
      token,
    });
  } catch {
    // Telemetry must never affect the user-facing flow.
  }
}
