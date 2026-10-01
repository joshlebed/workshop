// The variant store.
//
// Which of the five UX explorations the app is currently *being*. Persisted so a
// reload keeps your pick, overridable by `?ux=ux3` on any URL so a comparison
// page can link straight into one, and switchable live from the floating UX chip
// (or Alt+1…Alt+5 on web).
//
// Switching remounts the whole router tree below this provider — see the
// `key={variant}` in `app/_layout.tsx`. That is deliberate: these variants hold
// a lot of local state (deck panel, sheet stack, dock registrations) and leaking
// any of it across a switch would make the comparison dishonest.

import { getItem, removeItem, setItem } from "@workshop/api-client/storage";
import { useGlobalSearchParams } from "expo-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import {
  DEFAULT_UX_VARIANT,
  isUxVariant,
  UX_VARIANT_STORAGE_KEY,
  UX_VARIANTS,
  type UxVariant,
} from "./variants";

interface UxVariantContextValue {
  variant: UxVariant;
  setVariant: (next: UxVariant) => void;
  /** Forget the persisted pick and fall back to the default. */
  reset: () => void;
}

const UxVariantContext = createContext<UxVariantContextValue | null>(null);

export function UxVariantProvider({ children }: { children: ReactNode }) {
  // `null` until the persisted value has been read, so the first paint can't
  // flash ux1 and then swap.
  const [variant, setVariantState] = useState<UxVariant | null>(null);
  // `useGlobalSearchParams` is the change signal, but it keeps a param alive
  // after the URL has dropped it — a stale `ux=` would then resurrect itself
  // over every later switch. On web the address bar is the authority.
  const params = useGlobalSearchParams<{ ux?: string | string[] }>();
  const rawUx = params.ux;
  const paramUx = Array.isArray(rawUx) ? rawUx[0] : rawUx;
  const queryUx =
    Platform.OS === "web" && typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("ux") ?? undefined)
      : paramUx;
  // One `?ux=` value is honoured once per mount, so the chip and Alt+N stay in
  // control after a deep link has done its job.
  const appliedQueryRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getItem(UX_VARIANT_STORAGE_KEY).catch(() => null);
      if (cancelled) return;
      setVariantState(isUxVariant(stored) ? stored : DEFAULT_UX_VARIANT);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setVariant = useCallback((next: UxVariant) => {
    setVariantState(next);
    void setItem(UX_VARIANT_STORAGE_KEY, next);
  }, []);

  const reset = useCallback(() => {
    setVariantState(DEFAULT_UX_VARIANT);
    void removeItem(UX_VARIANT_STORAGE_KEY);
  }, []);

  // `?ux=` wins over the persisted value, and sticks (so the chip's label and a
  // later reload agree with the link you followed).
  useEffect(() => {
    if (variant === null || !isUxVariant(queryUx)) return;
    if (appliedQueryRef.current === queryUx) return;
    appliedQueryRef.current = queryUx;
    if (queryUx !== variant) setVariant(queryUx);
  }, [queryUx, variant, setVariant]);

  // Alt+1 … Alt+5. Alt rather than a bare digit so the shortcut can't fire
  // while someone is typing a score into a paste sheet.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const index = Number.parseInt(event.key, 10) - 1;
      const next = UX_VARIANTS[index];
      if (!next) return;
      event.preventDefault();
      setVariant(next);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [setVariant]);

  const value = useMemo(
    () => ({ variant: variant ?? DEFAULT_UX_VARIANT, setVariant, reset }),
    [variant, setVariant, reset],
  );

  if (variant === null) return null;
  return <UxVariantContext.Provider value={value}>{children}</UxVariantContext.Provider>;
}

function useUxVariantContext(): UxVariantContextValue {
  const value = useContext(UxVariantContext);
  if (!value) throw new Error("useUxVariant must be used inside UxVariantProvider");
  return value;
}

/** The active variant. Every route dispatcher reads this. */
export function useUxVariant(): UxVariant {
  return useUxVariantContext().variant;
}

export function useUxVariantControls(): Omit<UxVariantContextValue, "variant"> & {
  variant: UxVariant;
} {
  return useUxVariantContext();
}
