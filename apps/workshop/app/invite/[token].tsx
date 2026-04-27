import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * `/invite/:token` (web) and `workshop://invite/:token` (iOS) — the share-URL
 * shape the spec specifies. Both URL patterns map here via expo-router's
 * file-based routing; we forward to the canonical
 * `/onboarding/accept-invite?token=…` handler so the actual logic lives in
 * one place.
 */
export default function InviteRedirect() {
  const params = useLocalSearchParams<{ token?: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const target = token
    ? (`/onboarding/accept-invite?token=${encodeURIComponent(token)}` as const)
    : ("/onboarding/accept-invite" as const);
  return <Redirect href={target} />;
}
