import { Redirect, useLocalSearchParams } from "expo-router";

// `/share` is the share-extension entry point (`_layout.tsx` forwards the
// native payload here as `?url=` / `?text=`). Games were removed from Workshop
// on 2026-11-06, so there's no longer a choice to make: every share goes
// straight to the list-add flow. Kept as a route so in-flight links and older
// redirects into `/share` still land somewhere.
export default function ShareHome() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const query = new URLSearchParams();
  const url = firstParam(params.url);
  const text = firstParam(params.text);
  if (url) query.set("url", url);
  if (text) query.set("text", text);
  const qs = query.toString();
  return (
    <Redirect
      href={qs ? (`/share/pick-list?${qs}` as `/share/pick-list?${string}`) : "/share/pick-list"}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}
