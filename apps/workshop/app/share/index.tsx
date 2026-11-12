import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import {
  normalizeSharePayload,
  sharePayloadParams,
  stashPendingShare,
} from "../../src/lib/sharePayload";

// `/share` is the share-extension entry point (`_layout.tsx` forwards the
// native payload here as `?url=` / `?text=`). Every share goes to the list
// picker. Signed out, the payload is stashed first and resumed on the picker
// after sign-in (4.4), so nothing shared is dropped.
export default function ShareHome() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const { status } = useAuth();
  const router = useRouter();
  const payload = normalizeSharePayload({
    url: firstParam(params.url),
    text: firstParam(params.text),
  });
  const signedOut = status === "signed-out";

  useEffect(() => {
    if (!signedOut) return;
    (async () => {
      if (payload) await stashPendingShare(payload);
      router.replace("/sign-in");
    })();
  }, [signedOut, payload, router]);

  if (signedOut) return null;
  const qs = payload ? new URLSearchParams(sharePayloadParams(payload)).toString() : "";
  return (
    <Redirect
      href={qs ? (`/share/pick-list?${qs}` as `/share/pick-list?${string}`) : "/share/pick-list"}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}
