import { apiRequest } from "@workshop/api-client/api";

/**
 * A structured snapshot of what `useShareIntent()` handed us, sent to the
 * server so the iOS share-extension payload shape is debuggable without a
 * Mac/device debugger (the extension is native — never exercised by CI or
 * web). Mirrors Workshop's `src/api/telemetry.ts`; both post to the same
 * log-only `POST /v1/telemetry/share-intent`. Fire-and-forget — telemetry
 * must never affect the user-facing share flow.
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
