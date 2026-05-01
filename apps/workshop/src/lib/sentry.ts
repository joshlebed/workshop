import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

declare const __DEV__: boolean;

let initialized = false;

// Idempotent — Sentry.init() is wrapped in this helper so layout reloads
// (Fast Refresh, OTA reload via Updates.reloadAsync) don't double-install.
export function initSentry() {
  if (initialized) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  // Tag releases with the bundle's app version so source maps uploaded by
  // the Expo plugin at build time match incoming events.
  const release = Constants.expoConfig?.version ?? "unknown";

  Sentry.init({
    dsn,
    environment: __DEV__ ? "development" : "production",
    release,
    // 10% perf-event sample rate during beta — keeps inside Sentry free-tier
    // (10k transactions/month) while still surfacing slow flows. Crashes
    // are captured at 100%.
    tracesSampleRate: 0.1,
    enableNative: true,
  });
  initialized = true;
}

export { Sentry };
