// The ONLY module in HighScore that may load `expo-notifications`.
//
// The native module exists only in the 1.2.0+ binary, but every OTA also
// ships to the 1.0.1 / 1.1.0 Store binaries (supported-runtimes.json). Loading
// `expo-notifications` on an old binary throws `Cannot find native module …`,
// so this facade:
//   1. reports unsupported on web (no push) and on any runtime below 1.2.0,
//   2. only then `require`s the package — lazily, inside a function, never at
//      module scope (Metro still bundles it; the module factory just never
//      runs on an old binary),
//   3. treats a throwing require as unsupported.
// Everything else (the type below) is `import type`, which is erased.

import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { compareReleaseVersions } from "./appRelease";

type NotificationsModule = typeof import("expo-notifications");

/** First binary that contains the `expo-notifications` native module. */
export const PUSH_MIN_RUNTIME = "1.2.0";

export type PushPermissionStatus = "unsupported" | "granted" | "denied" | "undetermined";

export interface PushEnv {
  /** `Platform.OS`. */
  os: string;
  /** Binary version (`Updates.runtimeVersion` → `Constants.expoConfig.version`). */
  runtimeVersion: string | null;
  /** EAS project id for `getExpoPushTokenAsync`. */
  projectId: string | null;
  /** Loads `expo-notifications`; called at most once, only past the gate. */
  load: () => NotificationsModule;
  /** `__DEV__` web only: pretend push works so the UI can be exercised. */
  fake?: boolean;
}

export interface PushNotifications {
  isPushSupported(): boolean;
  getPermissionStatus(): Promise<PushPermissionStatus>;
  /** Ask the OS (shows the system dialog when undetermined) and, if granted, mint the token. */
  requestPermissionAndToken(): Promise<{ status: PushPermissionStatus; token: string | null }>;
  /** The Expo push token when permission is already granted; null otherwise. */
  getPushToken(): Promise<string | null>;
  /**
   * Calls `onUrl` with the tapped notification's `data.url` — once for the
   * response that cold-started the app (if any), then for every later tap.
   * Returns an unsubscribe.
   */
  addResponseListener(onUrl: (url: string | null) => void): () => void;
}

/** True when this binary has the native module (pure gate; no require). */
export function runtimeHasPush(os: string, runtimeVersion: string | null): boolean {
  if (os !== "ios" && os !== "android") return false;
  if (!runtimeVersion) return false;
  const cmp = compareReleaseVersions(runtimeVersion, PUSH_MIN_RUNTIME);
  return cmp !== null && cmp >= 0;
}

function permissionFrom(
  p: Awaited<ReturnType<NotificationsModule["getPermissionsAsync"]>>,
): PushPermissionStatus {
  if (p.granted) return "granted";
  // iOS provisional / ephemeral authorization still delivers (quietly).
  const ios = p.ios?.status;
  if (ios === 3 || ios === 4) return "granted";
  return p.status === "denied" ? "denied" : "undetermined";
}

function urlFromResponse(response: unknown): string | null {
  const data = (
    response as { notification?: { request?: { content?: { data?: unknown } } } } | null
  )?.notification?.request?.content?.data;
  if (data && typeof data === "object" && "url" in data) {
    const url = (data as { url: unknown }).url;
    return typeof url === "string" ? url : null;
  }
  return null;
}

function responseId(response: unknown): string | null {
  const id = (response as { notification?: { request?: { identifier?: unknown } } } | null)
    ?.notification?.request?.identifier;
  return typeof id === "string" ? id : null;
}

function createFake(): PushNotifications {
  let status: PushPermissionStatus = "undetermined";
  return {
    isPushSupported: () => true,
    getPermissionStatus: async () => status,
    requestPermissionAndToken: async () => {
      status = "granted";
      return { status, token: null };
    },
    getPushToken: async () => null,
    addResponseListener: () => () => {},
  };
}

export function createPushNotifications(env: PushEnv): PushNotifications {
  if (env.fake) return createFake();

  let loaded: NotificationsModule | null | undefined;
  const handled = new Set<string>();

  function mod(): NotificationsModule | null {
    if (loaded !== undefined) return loaded;
    if (!runtimeHasPush(env.os, env.runtimeVersion)) {
      loaded = null;
      return loaded;
    }
    try {
      const m = env.load();
      // Foreground notifications show as a banner (the default is silent).
      m.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      loaded = m;
    } catch {
      loaded = null;
    }
    return loaded;
  }

  async function tokenFrom(m: NotificationsModule): Promise<string | null> {
    try {
      const res = await m.getExpoPushTokenAsync(env.projectId ? { projectId: env.projectId } : {});
      return res.data;
    } catch {
      return null;
    }
  }

  return {
    isPushSupported: () => mod() !== null,

    async getPermissionStatus() {
      const m = mod();
      if (!m) return "unsupported";
      try {
        return permissionFrom(await m.getPermissionsAsync());
      } catch {
        return "unsupported";
      }
    },

    async requestPermissionAndToken() {
      const m = mod();
      if (!m) return { status: "unsupported", token: null };
      let status: PushPermissionStatus;
      try {
        status = permissionFrom(await m.requestPermissionsAsync());
      } catch {
        return { status: "unsupported", token: null };
      }
      return { status, token: status === "granted" ? await tokenFrom(m) : null };
    },

    async getPushToken() {
      const m = mod();
      if (!m) return null;
      try {
        if (permissionFrom(await m.getPermissionsAsync()) !== "granted") return null;
      } catch {
        return null;
      }
      return tokenFrom(m);
    },

    addResponseListener(onUrl) {
      const m = mod();
      if (!m) return () => {};
      // A response is delivered once; the cold-start one is also returned by
      // getLastNotificationResponseAsync for the life of the process, so
      // dedupe on the notification id across re-subscriptions.
      const deliver = (response: unknown) => {
        const id = responseId(response);
        if (id) {
          if (handled.has(id)) return;
          handled.add(id);
        }
        onUrl(urlFromResponse(response));
      };
      let active = true;
      let sub: { remove(): void } | null = null;
      try {
        sub = m.addNotificationResponseReceivedListener(deliver);
        m.getLastNotificationResponseAsync()
          .then((last) => {
            if (active && last) deliver(last);
          })
          .catch(() => {});
      } catch {
        /* unsupported in practice — no listener */
      }
      return () => {
        active = false;
        sub?.remove();
      };
    },
  };
}

/**
 * `highscore:///` → `/`; `highscore:///games/x` → `/games/x`. Anything that
 * isn't a HighScore link (or is missing) opens Games home.
 */
export function notificationPath(url: string | null): string {
  const prefix = "highscore://";
  if (!url?.startsWith(prefix)) return "/";
  const rest = url.slice(prefix.length).replace(/^\/*/, "/");
  return rest.startsWith("//") ? "/" : rest;
}

// --- The app's instance -----------------------------------------------------

/** The lazy loader. The only `expo-notifications` value reference in the app. */
function loadExpoNotifications(): NotificationsModule {
  return require("expo-notifications") as NotificationsModule;
}

function easProjectId(): string | null {
  const extra: unknown = Constants.expoConfig?.extra;
  const id = (extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  return typeof id === "string" ? id : null;
}

// `__DEV__` web only: `?fakePushSupported=1` exercises the pre-prompt and the
// settings controls in a browser. Read once per page load.
const DEV_FAKE_PUSH =
  __DEV__ &&
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("fakePushSupported") === "1";

const push = createPushNotifications({
  os: Platform.OS,
  // `appVersion` runtime policy: runtime version === the binary's app.json version.
  runtimeVersion: Updates.runtimeVersion ?? Constants.expoConfig?.version ?? null,
  projectId: easProjectId(),
  load: loadExpoNotifications,
  fake: DEV_FAKE_PUSH,
});

export const isPushSupported = (): boolean => push.isPushSupported();
export const getPermissionStatus = (): Promise<PushPermissionStatus> => push.getPermissionStatus();
export const requestPermissionAndToken = () => push.requestPermissionAndToken();
export const getPushToken = (): Promise<string | null> => push.getPushToken();
export const addResponseListener = (onUrl: (url: string | null) => void): (() => void) =>
  push.addResponseListener(onUrl);

/** `ios` | `android` for `POST /v1/me/push-token`. */
export const pushPlatform: "ios" | "android" = Platform.OS === "android" ? "android" : "ios";
