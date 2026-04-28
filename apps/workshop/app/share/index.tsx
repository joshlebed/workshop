import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * `/share` (web) and `workshop://share` (iOS) — the deep-link target that
 * the Phase 4 share extension will hand off to. expo-router's file-based
 * routing maps the bare `/share` path here; we forward to the canonical
 * `/share/pick-list?url=…` so the picker logic lives in one place.
 */
export default function ShareRedirect() {
  const params = useLocalSearchParams<{ url?: string }>();
  const url = Array.isArray(params.url) ? params.url[0] : params.url;
  const target = url
    ? (`/share/pick-list?url=${encodeURIComponent(url)}` as const)
    : ("/share/pick-list" as const);
  return <Redirect href={target} />;
}
