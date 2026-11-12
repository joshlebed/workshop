import { useEffect, useId, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  Modal as RNModal,
  StyleSheet,
  View,
  type ViewInstance,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Button } from "./Button";
import { type ConfirmRequest, confirmStore } from "./confirmStore";
import { webAria } from "./interaction";
import { timing } from "./motion";
import { Text } from "./Text";
import { tokens } from "./theme";

type FocusTarget = { focus?: () => void; contains?: (n: unknown) => boolean };

/**
 * Mount once at an app's root (inside its providers) to back `confirm()` on
 * web with an in-app dialog instead of `window.confirm`. Renders nothing on
 * native, where `confirm()` keeps the system alert. Without a mounted host,
 * web `confirm()` falls back to `window.confirm` (HighScore relies on that).
 */
export function ConfirmDialogHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(() => confirmStore.current());

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unregister = confirmStore.registerHost();
    const unsubscribe = confirmStore.subscribe(setRequest);
    setRequest(confirmStore.current());
    return () => {
      unsubscribe();
      unregister();
    };
  }, []);

  if (Platform.OS !== "web" || !request) return null;
  return (
    <ConfirmDialog
      key={request.id}
      request={request}
      onAnswer={(answer) => confirmStore.settle(request.id, answer)}
    />
  );
}

function ConfirmDialog({
  request,
  onAnswer,
}: {
  request: ConfirmRequest;
  onAnswer: (answer: boolean) => void;
}) {
  const {
    title,
    message,
    confirmLabel = "OK",
    cancelLabel = "Cancel",
    destructive = false,
  } = request;
  const cardRef = useRef<ViewInstance>(null);
  const messageId = `confirm-message-${useId().replace(/:/g, "")}`;
  const destructiveRef = useRef(destructive);
  const cancelRef = useRef<ViewInstance>(null);
  const confirmRef = useRef<ViewInstance>(null);
  const answerRef = useRef(onAnswer);
  answerRef.current = onAnswer;
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, timing("fast"));
  }, [progress]);

  // Keyboard contract (web): focus starts on the confirm button (on Cancel
  // when the action is destructive, so a stray Enter never deletes), Tab and
  // Shift+Tab cycle inside the dialog, Escape cancels, Enter confirms unless
  // focus is on Cancel. Focus returns to the opener when the dialog closes.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const opener = document.activeElement as HTMLElement | null;
    const asEl = (r: React.RefObject<ViewInstance | null>) =>
      r.current as unknown as HTMLElement | null;
    const focusTimer = setTimeout(
      () => asEl(destructiveRef.current ? cancelRef : confirmRef)?.focus(),
      0,
    );
    const onKey = (e: KeyboardEvent) => {
      const cancelEl = asEl(cancelRef);
      const confirmEl = asEl(confirmRef);
      const card = asEl(cardRef) as unknown as FocusTarget | null;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        answerRef.current(false);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        answerRef.current(document.activeElement !== cancelEl);
        return;
      }
      if (e.key === "Tab") {
        const order = [cancelEl, confirmEl].filter(Boolean) as HTMLElement[];
        if (order.length === 0) return;
        const active = document.activeElement;
        const inside = !!card?.contains?.(active);
        const idx = order.indexOf(active as HTMLElement);
        e.preventDefault();
        const next =
          !inside || idx === -1
            ? order[0]
            : order[(idx + (e.shiftKey ? order.length - 1 : 1)) % order.length];
        next?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey, true);
      if (opener && typeof opener.focus === "function" && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduceMotion ? [] : [{ scale: 0.97 + progress.value * 0.03 }],
  }));

  return (
    <RNModal visible transparent animationType="none" onRequestClose={() => onAnswer(false)}>
      <View style={styles.root}>
        <Animated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]} />
        <Pressable
          style={styles.backdropPress}
          accessibilityLabel={cancelLabel}
          onPress={() => onAnswer(false)}
          tabIndex={-1}
        />
        <Animated.View
          ref={cardRef}
          style={[styles.card, cardStyle]}
          role="alertdialog"
          aria-modal
          aria-label={title}
          {...webAria({ "aria-describedby": message ? messageId : undefined })}
          testID="confirm-dialog"
        >
          <Text variant="heading">{title}</Text>
          {message ? (
            <Text tone="secondary" style={styles.message} nativeID={messageId}>
              {message}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button
              ref={cancelRef}
              label={cancelLabel}
              variant="secondary"
              onPress={() => onAnswer(false)}
              testID="confirm-dialog-cancel"
              style={styles.action}
            />
            <Button
              ref={confirmRef}
              label={confirmLabel}
              variant={destructive ? "danger" : "primary"}
              onPress={() => onAnswer(true)}
              testID="confirm-dialog-confirm"
              style={styles.action}
            />
          </View>
        </Animated.View>
      </View>
    </RNModal>
  );
}

const fill = { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0 };

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.space.xl,
  },
  backdrop: { ...fill, backgroundColor: "rgba(0,0,0,0.6)" },
  backdropPress: { ...fill },
  card: {
    width: "100%",
    maxWidth: 400,
    gap: tokens.space.sm,
    padding: tokens.space.xl,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  message: { marginBottom: tokens.space.xs },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: tokens.space.sm,
    marginTop: tokens.space.md,
  },
  action: { minWidth: 96 },
});
