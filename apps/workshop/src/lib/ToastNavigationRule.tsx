import { useToast } from "@workshop/ui";
import { useNavigationContainerRef } from "expo-router";
import { useEffect, useRef } from "react";
import { collectRouteKeys, openedNewScreen } from "./toastNavigationRule";

/**
 * Applies the toast navigation rule: opening a new screen on top dismisses
 * the toasts the previous screen raised; going back keeps them (a "Deleted ·
 * Undo" raised in item detail survives the trip back to the list). Mounted
 * once inside `ToastProvider` in the root layout.
 */
export function ToastNavigationRule() {
  const navigationRef = useNavigationContainerRef();
  const { dismissForNavigation } = useToast();
  const keysRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    return navigationRef.addListener("state", (event) => {
      const state: unknown = event.data.state;
      if (openedNewScreen(keysRef.current, state)) dismissForNavigation();
      keysRef.current = collectRouteKeys(state).all;
    });
  }, [navigationRef, dismissForNavigation]);

  return null;
}
