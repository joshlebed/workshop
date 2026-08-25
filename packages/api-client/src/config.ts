import Constants from "expo-constants";
import { Platform } from "react-native";

function deriveFromWebLocation(): string | null {
  if (Platform.OS !== "web") return null;
  if (typeof window === "undefined") return null;
  const { hostname, port } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:8787";
  }

  // Niteshift preview proxy gates the backend port (`ns-8787-…`) with a 401
  // HTML page, so we route through `/api` on the same origin instead — the
  // Expo web dev server proxies that to `localhost:8787` (see metro.config.js
  // + dev-api-proxy.js).
  if (hostname.endsWith(".preview.niteshift.dev")) {
    return "/api";
  }

  // Cloudflare Pages owns the browser refresh cookie. Proxy API traffic
  // through the page origin so it remains first-party and reliable in Safari.
  if (hostname.endsWith(".pages.dev")) {
    return "/api";
  }

  if (port === "8081") {
    return `${window.location.protocol}//${hostname}:8787`;
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
