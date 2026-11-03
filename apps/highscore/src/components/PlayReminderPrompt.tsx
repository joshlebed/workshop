// The one-time "daily nudge?" pre-prompt. Offered right after the first
// successful score post of a session (every post surface calls
// `usePlayReminderOffer()` via `usePostedScoreNotice`), never on launch, and
// only when push works on this binary, the OS permission is still
// undetermined, and the user hasn't answered before (`user_flags`
// `USER_FLAG_KEYS.playReminderPrompted` — once answered, never re-asked
// automatically; the settings screen is the way back).

import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import type { UserFlagsResponse } from "@workshop/shared/games";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { fetchUserFlags, putUserFlag } from "../api/release";
import { useAuth } from "../hooks/useAuth";
import { getPermissionStatus, isPushSupported } from "../lib/pushNotifications";
import { enablePlayReminder, formatReminderHour } from "../lib/pushRegistration";
import { Button, Sheet, Text, tokens, useToast } from "../theme";

// Post surfaces close a Sheet (paste sheet) or navigate on success; wait past
// the Sheet's 220ms exit so two Modals never stack (root CLAUDE.md), and let
// the "Score posted" toast land first.
const OFFER_DELAY_MS = 1200;

type Choice = "turn_on" | "not_now";

const OfferContext = createContext<() => void>(() => {});

/** Call after a successful score post. No-op outside the provider. */
export function usePlayReminderOffer(): () => void {
  return useContext(OfferContext);
}

export function PlayReminderPromptProvider({ children }: { children: ReactNode }) {
  const { token, user, status, impersonation } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [visible, setVisible] = useState(false);
  const offeredThisSession = useRef(false);
  const choiceRef = useRef<Choice | null>(null);

  const offer = useCallback(() => {
    if (offeredThisSession.current) return;
    offeredThisSession.current = true;
    if (status !== "signed-in" || !token || impersonation || !isPushSupported()) return;
    void (async () => {
      try {
        if ((await getPermissionStatus()) !== "undetermined") return;
        const flags = await queryClient.fetchQuery<UserFlagsResponse>({
          queryKey: queryKeys.users.flags,
          queryFn: () => fetchUserFlags(token),
          staleTime: 60_000,
        });
        if (flags.flags[USER_FLAG_KEYS.playReminderPrompted] !== undefined) return;
        setTimeout(() => setVisible(true), OFFER_DELAY_MS);
      } catch {
        /* no prompt is better than a wrong one */
      }
    })();
  }, [status, token, impersonation, queryClient]);

  const answer = useCallback(
    (choice: Choice) => {
      choiceRef.current = choice;
      setVisible(false);
      const value = { choice, at: new Date().toISOString() };
      queryClient.setQueryData<UserFlagsResponse>(queryKeys.users.flags, (prev) => ({
        flags: { ...(prev?.flags ?? {}), [USER_FLAG_KEYS.playReminderPrompted]: value },
      }));
      void putUserFlag(token, USER_FLAG_KEYS.playReminderPrompted, value).catch(() => {});
    },
    [queryClient, token],
  );

  // The OS dialog waits for the Sheet's Modal to finish closing.
  const onClosed = useCallback(() => {
    const choice = choiceRef.current;
    choiceRef.current = null;
    if (choice !== "turn_on" || !token || !user) return;
    void (async () => {
      try {
        const result = await enablePlayReminder(token, user.id);
        if (result.ok) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.users.notificationPrefs });
          const hour = result.prefs.playReminderHour;
          showToast({
            message:
              hour === null
                ? "Reminders on"
                : `Reminders on — around ${formatReminderHour(hour)}. Change it in Notifications.`,
            tone: "success",
          });
        } else if (result.status === "denied") {
          showToast({ message: "Notifications are off for HighScore in Settings" });
        }
      } catch (e) {
        showToast({ message: errorMessage(e, "Couldn't turn on reminders"), tone: "danger" });
      }
    })();
  }, [queryClient, showToast, token, user]);

  return (
    <OfferContext.Provider value={offer}>
      {children}
      <Sheet
        visible={visible}
        // A backdrop / swipe dismiss is an answer too: never re-ask automatically.
        onRequestClose={() => answer("not_now")}
        onClosed={onClosed}
        testID="play-reminder-prompt"
      >
        <View style={styles.content}>
          <Text variant="heading" accessibilityRole="header">
            Get a daily nudge when your games are ready?
          </Text>
          <Text tone="secondary">
            One notification a day at the hour you usually play — skipped if you&apos;ve already
            posted. Change or turn it off any time in Notifications.
          </Text>
          <Button
            label="Turn on"
            size="lg"
            onPress={() => answer("turn_on")}
            testID="play-reminder-turn-on"
          />
          <Button
            label="Not now"
            variant="ghost"
            onPress={() => answer("not_now")}
            testID="play-reminder-not-now"
          />
        </View>
      </Sheet>
    </OfferContext.Provider>
  );
}

const styles = StyleSheet.create({
  content: { gap: tokens.space.md },
});
