// The one-time push permission pre-prompts. Two triggers, one sheet, one per
// session at most, each with its own `user_flags` key so their opt-in rates
// are measured apart (spike 4):
//
// - `first_score` — "Get a daily nudge when your games are ready?" Offered
//   right after the first successful score post of a session (every post
//   surface calls `usePlayReminderOffer()` via `usePostedScoreNotice`). Turn on
//   = OS permission + token + daily reminder. Flag
//   `USER_FLAG_KEYS.playReminderPrompted`.
// - `nudge` — "Want to know when they post back?" Offered right after the
//   first one-tap nudge (`useNudgePushOffer()`). Turn on = OS permission +
//   token only (the "they posted" push, `lib/stalledNudges.ts` server-side,
//   and pokes from friends). Flag `USER_FLAG_KEYS.nudgePushPrompted`.
//
// Never on launch, and only when push works on this binary, the OS permission
// is still undetermined, and that trigger's flag is unset — once answered,
// never re-asked automatically; the settings screen is the way back. Every
// step goes to `POST /v1/telemetry/push-prompt` (shown → turn_on | not_now →
// granted | denied | failed) for the per-trigger funnel.

import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import {
  type PushPromptStep,
  type PushPromptTrigger,
  USER_FLAG_KEYS,
} from "@workshop/shared/constants";
import type { UserFlagsResponse } from "@workshop/shared/games";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import { fetchUserFlags, putUserFlag } from "../api/release";
import { reportPushPrompt } from "../api/telemetry";
import { useAuth } from "../hooks/useAuth";
import { getPermissionStatus, isPushSupported } from "../lib/pushNotifications";
import {
  enablePlayReminder,
  ensurePushRegistered,
  formatReminderHour,
} from "../lib/pushRegistration";
import { Button, Sheet, Text, tokens, useToast } from "../theme";

// Post surfaces close a Sheet (paste sheet) or navigate on success; wait past
// the Sheet's 220ms exit so two Modals never stack (root CLAUDE.md), and let
// the "Score posted" toast land first.
const OFFER_DELAY_MS = 1200;

type Choice = "turn_on" | "not_now";

const FLAG_KEY: Record<PushPromptTrigger, string> = {
  first_score: USER_FLAG_KEYS.playReminderPrompted,
  nudge: USER_FLAG_KEYS.nudgePushPrompted,
};

/** Who was just nudged, for the nudge sheet's words. */
export interface NudgedWho {
  names: string;
  count: number;
}

/** The sheet's words for one trigger. */
function pushPromptCopy(
  trigger: PushPromptTrigger,
  who?: NudgedWho,
): { heading: string; body: string } {
  if (trigger === "nudge") {
    const subject = who ? `${who.names} ${who.count === 1 ? "posts" : "post"}` : "they post";
    return {
      heading: "Want to know when they post back?",
      body: `Turn on notifications and we'll tell you when ${subject} — and your friends can nudge you too. Change it any time in Notifications.`,
    };
  }
  return {
    heading: "Get a daily nudge when your games are ready?",
    body: "One notification a day at the hour you usually play — skipped if you've already posted. Change or turn it off any time in Notifications.",
  };
}

interface OfferApi {
  offer: (trigger: PushPromptTrigger, who?: NudgedWho) => void;
}

const OfferContext = createContext<OfferApi>({ offer: () => {} });

/** Call after a successful score post. No-op outside the provider. */
export function usePlayReminderOffer(): () => void {
  const { offer } = useContext(OfferContext);
  return useCallback(() => offer("first_score"), [offer]);
}

/** Call after a one-tap nudge goes out (the provider shows it at most once). */
export function useNudgePushOffer(): (who?: NudgedWho) => void {
  const { offer } = useContext(OfferContext);
  return useCallback((who?: NudgedWho) => offer("nudge", who), [offer]);
}

export function PlayReminderPromptProvider({ children }: { children: ReactNode }) {
  const { token, user, status, impersonation } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [prompt, setPrompt] = useState<{ trigger: PushPromptTrigger; who?: NudgedWho } | null>(
    null,
  );
  const offeredThisSession = useRef(new Set<PushPromptTrigger>());
  // One sheet a session, whichever trigger gets there first.
  const shownThisSession = useRef(false);
  const choiceRef = useRef<{ trigger: PushPromptTrigger; choice: Choice } | null>(null);

  const track = useCallback(
    (trigger: PushPromptTrigger, step: PushPromptStep) =>
      void reportPushPrompt(token, trigger, step),
    [token],
  );

  const offer = useCallback(
    (trigger: PushPromptTrigger, who?: NudgedWho) => {
      if (offeredThisSession.current.has(trigger) || shownThisSession.current) return;
      offeredThisSession.current.add(trigger);
      if (status !== "signed-in" || !token || impersonation || !isPushSupported()) return;
      void (async () => {
        try {
          if ((await getPermissionStatus()) !== "undetermined") return;
          const flags = await queryClient.fetchQuery<UserFlagsResponse>({
            queryKey: queryKeys.users.flags,
            queryFn: () => fetchUserFlags(token),
            staleTime: 60_000,
          });
          if (flags.flags[FLAG_KEY[trigger]] !== undefined) return;
          if (shownThisSession.current) return;
          shownThisSession.current = true;
          setTimeout(() => {
            setPrompt(who === undefined ? { trigger } : { trigger, who });
            track(trigger, "shown");
          }, OFFER_DELAY_MS);
        } catch {
          /* no prompt is better than a wrong one */
        }
      })();
    },
    [status, token, impersonation, queryClient, track],
  );

  const answer = useCallback(
    (choice: Choice) => {
      if (!prompt) return;
      const { trigger } = prompt;
      choiceRef.current = { trigger, choice };
      setPrompt(null);
      track(trigger, choice);
      const key = FLAG_KEY[trigger];
      const value = { choice, at: new Date().toISOString() };
      queryClient.setQueryData<UserFlagsResponse>(queryKeys.users.flags, (prev) => ({
        flags: { ...(prev?.flags ?? {}), [key]: value },
      }));
      void putUserFlag(token, key, value).catch(() => {});
    },
    [prompt, queryClient, token, track],
  );

  // The OS dialog waits for the Sheet's Modal to finish closing.
  const onClosed = useCallback(() => {
    const answered = choiceRef.current;
    choiceRef.current = null;
    if (answered?.choice !== "turn_on" || !token || !user) return;
    const { trigger } = answered;
    void (async () => {
      try {
        if (trigger === "nudge") {
          const readiness = await ensurePushRegistered(token, user.id);
          if (readiness === "ready") {
            track(trigger, "granted");
            showToast({
              message: "Notifications on — we'll tell you when they post",
              tone: "success",
            });
          } else if (readiness === "denied") {
            track(trigger, "denied");
            showToast({ message: "Notifications are off for HighScore in Settings" });
          } else {
            track(trigger, readiness === "dismissed" ? "denied" : "failed");
          }
          return;
        }
        const result = await enablePlayReminder(token, user.id);
        if (result.ok) {
          track(trigger, "granted");
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
          track(trigger, "denied");
          showToast({ message: "Notifications are off for HighScore in Settings" });
        } else {
          track(trigger, "failed");
        }
      } catch (e) {
        track(trigger, "failed");
        showToast({ message: errorMessage(e, "Couldn't turn on notifications"), tone: "danger" });
      }
    })();
  }, [queryClient, showToast, token, user, track]);

  const api = useMemo(() => ({ offer }), [offer]);
  // Keep the words through the closing animation (prompt is null by then).
  const shownPrompt = useRef(prompt);
  if (prompt) shownPrompt.current = prompt;
  const copy = pushPromptCopy(
    shownPrompt.current?.trigger ?? "first_score",
    shownPrompt.current?.who,
  );

  return (
    <OfferContext.Provider value={api}>
      {children}
      <Sheet
        visible={prompt !== null}
        // A backdrop / swipe dismiss is an answer too: never re-ask automatically.
        onRequestClose={() => answer("not_now")}
        onClosed={onClosed}
        testID="play-reminder-prompt"
      >
        <View
          style={styles.content}
          testID={`push-prompt-${shownPrompt.current?.trigger ?? "first_score"}`}
        >
          <Text variant="heading" accessibilityRole="header">
            {copy.heading}
          </Text>
          <Text tone="secondary">{copy.body}</Text>
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
