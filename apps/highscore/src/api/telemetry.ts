import { apiRequest } from "@workshop/api-client/api";
import { API_URL } from "@workshop/api-client/config";
import type { PreloginScoreEvent } from "@workshop/shared/constants";
import { Platform } from "react-native";

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

/**
 * One step of the score-before-sign-in funnel (onboarding spike 1), logged
 * server-side as `kind: "prelogin_score"`. Public route (most steps happen
 * signed out); never carries score text. Fire-and-forget.
 */
export interface PreloginScoreTelemetry {
  event: PreloginScoreEvent;
  draftId?: string;
  linkKind?: "play" | "friend";
  gameKey?: string | null;
  sharerPlayed?: boolean;
  reason?: "discarded" | "expired" | "post_failed" | "left_page" | "replaced";
  ageMs?: number;
}

const PRELOGIN_SCORE_PATH = "/v1/telemetry/prelogin-score";

export async function reportPreloginScore(
  snapshot: PreloginScoreTelemetry,
  token: string | null,
): Promise<void> {
  try {
    await apiRequest<{ ok: boolean }>({
      method: "POST",
      path: PRELOGIN_SCORE_PATH,
      body: { ...snapshot, platform: Platform.OS },
      token,
    });
  } catch {
    // Telemetry must never affect the user-facing flow.
  }
}

/**
 * The same report from a page that is going away (web `pagehide`): a
 * `keepalive` fetch survives the unload, an ordinary request is cancelled.
 */
export function reportPreloginScoreOnUnload(snapshot: PreloginScoreTelemetry): void {
  try {
    void fetch(`${API_URL}${PRELOGIN_SCORE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...snapshot, platform: Platform.OS }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never throw from an unload handler.
  }
}
