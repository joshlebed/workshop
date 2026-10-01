// Per-variant navigators and root providers.
//
// Three things live here, all keyed on the active variant:
//
// 1. `VariantProviders` — the provider wrappers each variant's root layout added
//    on its own branch (its own `ToastProvider`, plus ux1's `DeckNavProvider`,
//    ux4's `FlightProvider`/`PeekProvider`, ux5's `DockProvider`). The shared
//    providers — gesture handler, keyboard, safe area, query client, auth,
//    games runtime, font loading — are identical on all five branches and are
//    mounted once by `app/_layout.tsx`.
// 2. `RootStack` — the union of the full-screen routes, with each variant's own
//    screen animations.
// 3. `GroupLayout` — what `app/(app)/_layout.tsx` renders. ux1/ux4/ux5 push real
//    screens, so theirs is a `Stack`. ux2 and ux3 draw their whole main loop from
//    a persistent layout whose child routes render `null`, so theirs is that
//    layout plus a `Slot` — exactly the shape they had on their own branches.

import { Slot, Stack, usePathname } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "../hooks/useAuth";
import { DeckNavProvider } from "../variants/ux1/deck/DeckNav";
import { ToastProvider as Ux1ToastProvider } from "../variants/ux1/theme/Toast";
import { tokens as ux1Tokens } from "../variants/ux1/theme/tokens";
import { Shell as Ux2Shell } from "../variants/ux2/shell/Shell";
import { ToastProvider as Ux2ToastProvider } from "../variants/ux2/theme/Toast";
import { tokens as ux2Tokens } from "../variants/ux2/theme/tokens";
import { SheetHost as Ux3SheetHost } from "../variants/ux3/nav/SheetHost";
import { ToastProvider as Ux3ToastProvider } from "../variants/ux3/theme/Toast";
import { tokens as ux3Tokens } from "../variants/ux3/theme/tokens";
import { TimelineHome as Ux3Timeline } from "../variants/ux3/timeline/TimelineHome";
import { FlightProvider } from "../variants/ux4/components/Flight";
import { PeekProvider } from "../variants/ux4/components/Peek";
import { ToastProvider as Ux4ToastProvider } from "../variants/ux4/theme/Toast";
import { tokens as ux4Tokens } from "../variants/ux4/theme/tokens";
import { DockProvider } from "../variants/ux5/nav/dock";
import { ToastProvider as Ux5ToastProvider } from "../variants/ux5/theme/Toast";
import { tokens as ux5Tokens } from "../variants/ux5/theme/tokens";
import { useUxVariant } from "./variant";
import type { UxVariant } from "./variants";

/** Each variant's canvas colour — the five palettes are deliberately different. */
export const VARIANT_CANVAS: Record<UxVariant, string> = {
  ux1: ux1Tokens.bg.canvas,
  ux2: ux2Tokens.bg.canvas,
  ux3: ux3Tokens.bg.canvas,
  ux4: ux4Tokens.bg.canvas,
  ux5: ux5Tokens.bg.canvas,
};

/**
 * How far above the bottom edge the UX chip has to float to clear the variant's
 * own bottom chrome: ux1's three-key control panel, ux4's KeyPanel, ux5's dock.
 * ux2 and ux3 raise sheets from the bottom edge instead and have no fixed bar.
 */
export const VARIANT_CHIP_BOTTOM: Record<UxVariant, number> = {
  ux1: 92,
  ux2: 20,
  ux3: 20,
  ux4: 92,
  ux5: 76,
};

// ---------------------------------------------------------------- providers

function Ux1Providers({ children }: { children: ReactNode }) {
  return (
    <Ux1ToastProvider>
      <DeckNavProvider>{children}</DeckNavProvider>
    </Ux1ToastProvider>
  );
}

function Ux2Providers({ children }: { children: ReactNode }) {
  return <Ux2ToastProvider>{children}</Ux2ToastProvider>;
}

function Ux3Providers({ children }: { children: ReactNode }) {
  return <Ux3ToastProvider>{children}</Ux3ToastProvider>;
}

function Ux4Providers({ children }: { children: ReactNode }) {
  // Both render a root-level overlay above the router: the flight clone and the
  // peek panel.
  return (
    <Ux4ToastProvider>
      <FlightProvider>
        <PeekProvider>{children}</PeekProvider>
      </FlightProvider>
    </Ux4ToastProvider>
  );
}

function Ux5Providers({ children }: { children: ReactNode }) {
  // The dock lives outside the Stack so it survives every navigation and can
  // morph rather than remount.
  return (
    <Ux5ToastProvider>
      <DockProvider>{children}</DockProvider>
    </Ux5ToastProvider>
  );
}

const PROVIDERS: Record<UxVariant, (props: { children: ReactNode }) => ReactNode> = {
  ux1: Ux1Providers,
  ux2: Ux2Providers,
  ux3: Ux3Providers,
  ux4: Ux4Providers,
  ux5: Ux5Providers,
};

export function VariantProviders({
  variant,
  children,
}: {
  variant: UxVariant;
  children: ReactNode;
}) {
  const Providers = PROVIDERS[variant];
  return <Providers>{children}</Providers>;
}

/**
 * The variant's own canvas colour behind the whole router. Each branch set it on
 * its `GestureHandlerRootView`; here the root is shared, so the paint happens one
 * level down where the variant is known.
 */
export function VariantCanvas({ children }: { children: ReactNode }) {
  const variant = useUxVariant();
  return (
    <View style={[styles.root, { backgroundColor: VARIANT_CANVAS[variant] }]}>{children}</View>
  );
}

// --------------------------------------------------------------- root stack

/** The full-screen routes, present in every variant. */
export function RootStack() {
  const variant = useUxVariant();
  const canvas = VARIANT_CANVAS[variant];
  // ux3 cross-fades between full screens and raises `/share/pick-game` from the
  // bottom; the other four slide from the right, as HighScore always has.
  const isUx3 = variant === "ux3";
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: canvas },
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        ...(isUx3 ? { animation: "fade" as const } : null),
      }}
    >
      <Stack.Screen name="(app)" />
      <Stack.Screen name="friends/accept/[token]" />
      <Stack.Screen name="g/[token]" />
      <Stack.Screen name="share/index" />
      <Stack.Screen
        name="share/pick-game"
        options={{ animation: isUx3 ? "slide_from_bottom" : "slide_from_right" }}
      />
      <Stack.Screen name="support" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="privacy" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="onboarding/display-name" />
    </Stack>
  );
}

// ------------------------------------------------------------- group layouts

/** ux1: deep-link routes resolve into the deck and replace themselves. */
function Ux1GroupLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: ux1Tokens.bg.canvas },
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="games/[id]" options={{ animation: "none" }} />
      <Stack.Screen name="friends/index" options={{ animation: "none" }} />
      <Stack.Screen name="friends/[userId]" options={{ animation: "none" }} />
      <Stack.Screen name="you" options={{ animation: "none" }} />
      <Stack.Screen name="profile" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}

/** The four routes ux2's shell draws itself. Everything else gets the Slot. */
function isUx2ShellRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  if (segments[0] === "games" && segments.length === 2) return true;
  if (segments[0] === "friends" && segments.length === 1) return true;
  if (segments[0] === "friends" && segments.length === 2 && segments[1] !== "accept") return true;
  return false;
}

/**
 * ux2: one persistent `<Shell />` for `/`, `/games/:id`, `/friends` and
 * `/friends/:userId` — those routes render `null` and the shell reads the
 * pathname. `/profile` really does push, so on that URL the shell steps back
 * (hidden, inert, still mounted so the ledger survives the round trip) and the
 * Slot takes the screen.
 */
function Ux2GroupLayout() {
  const { status } = useAuth();
  const pathname = usePathname();
  const inShell = isUx2ShellRoute(pathname);
  return (
    <View style={styles.root}>
      {status === "signed-in" ? (
        <View
          style={[StyleSheet.absoluteFill, inShell ? null : styles.hidden]}
          pointerEvents={inShell ? "auto" : "none"}
        >
          <Ux2Shell />
        </View>
      ) : null}
      <View style={StyleSheet.absoluteFill} pointerEvents={inShell ? "none" : "auto"}>
        <Slot />
      </View>
    </View>
  );
}

/**
 * ux3: the timeline mounts once and never unmounts; `SheetHost` reads the URL
 * and slides the matching sheet over it. Every route in the group renders
 * `null` (or, for `/you`, a redirect), so the Slot overlay only ever has to let
 * touches through to the feed.
 */
function Ux3GroupLayout() {
  const { status } = useAuth();
  return (
    <View style={[styles.root, { backgroundColor: ux3Tokens.bg.canvas }]}>
      {status === "signed-in" ? <Ux3Timeline /> : null}
      <Ux3SheetHost />
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Slot />
      </View>
    </View>
  );
}

/**
 * ux4: detail screens fade rather than slide — their identity block is the
 * landing pad for the flight animation started by the row you tapped, and a
 * horizontal slide would fight it.
 */
function Ux4GroupLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: ux4Tokens.bg.canvas },
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="games/[id]" options={{ animation: "fade", animationDuration: 140 }} />
      <Stack.Screen name="friends/index" options={{ animation: "fade", animationDuration: 140 }} />
      <Stack.Screen
        name="friends/[userId]"
        options={{ animation: "fade", animationDuration: 140 }}
      />
      <Stack.Screen name="you" options={{ animation: "fade", animationDuration: 140 }} />
      <Stack.Screen name="profile" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}

/**
 * ux5: the board unfolds out of the band that opened it, so the stack itself
 * must not also slide — a cross-fade lets the header carry the transition.
 */
function Ux5GroupLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: ux5Tokens.bg.canvas },
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="games/[id]" options={{ animation: "fade" }} />
      <Stack.Screen name="friends/index" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="friends/[userId]" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="you" options={{ animation: "slide_from_bottom" }} />
      <Stack.Screen name="profile" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}

const GROUP_LAYOUTS: Record<UxVariant, () => ReactNode> = {
  ux1: Ux1GroupLayout,
  ux2: Ux2GroupLayout,
  ux3: Ux3GroupLayout,
  ux4: Ux4GroupLayout,
  ux5: Ux5GroupLayout,
};

export function VariantGroupLayout() {
  const variant = useUxVariant();
  const Layout = GROUP_LAYOUTS[variant];
  return <Layout />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hidden: { opacity: 0 },
});
