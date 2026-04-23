import Constants from "expo-constants";
import { Platform } from "react-native";

function deriveFromWebLocation(): string | null {
  if (Platform.OS !== "web") return null;
  if (typeof window === "undefined") return null;
  const { hostname, protocol, port } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:8787";
  }

  const previewMatch = hostname.match(/^ns-(\d+)-(.+)\.preview\.niteshift\.dev$/);
  if (previewMatch) {
    const [, , id] = previewMatch;
    return `${protocol}//ns-8787-${id}.preview.niteshift.dev`;
  }

  if (port === "8081") {
    return `${protocol}//${hostname}:8787`;
  }
  return null;
}

function readApiUrl(): string {
  const derived = deriveFromWebLocation();
  if (derived) return derived.replace(/\/$/, "");
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  if (extra?.apiUrl) return extra.apiUrl.replace(/\/$/, "");
  return "http://localhost:8787";
}

export const API_URL = readApiUrl();
