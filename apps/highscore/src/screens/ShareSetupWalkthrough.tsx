// Multi-step "add HighScore to your share panel" walkthrough. Content lives in
// src/lib/shareOnboarding.ts (testable without a renderer); this screen owns
// paging + the completion write. Reached from the Games-home announcement card
// and from Edit profile, and routable directly at /share-setup.
//
// Each "how" step shows a screenshot of the real iOS share sheet with the
// control to tap ringed. The last step opens a practice page in Safari
// (`SHARE_PRACTICE_URL`) whose Share button shares SHARE_PRACTICE_TEXT, so the
// user does the setup in a real share sheet. Tapping HighScore there proves it:
// `_layout.tsx` routes the practice payload to `/share-setup?tested=1` — the
// "it works" state. Coming back without it, the screen asks whether HighScore
// is at the front of the row.
//
// The practice share used to be an in-app `Share.share`. A share to our own
// extension from inside the app can leave the extension's sheet up over this
// screen (expo-share-intent #231) — clear on a device, so "You're set" showed
// through while Done and X were dead — and JS cannot dismiss it. From Safari
// the hand-off brings HighScore forward with nothing over it. The proof is
// saved as soon as it arrives rather than on Done.
//
// Finishing writes the `games.share-sheet-announcement` flag with
// `{ completedAt }` — server-side, so no other device re-blasts the
// announcement. Closing early writes nothing: the card stays until the user
// explicitly deals with it.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import { goBack } from "@workshop/ui/navigation";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Image,
  type ImageSourcePropType,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { putUserFlag } from "../api/release";
import { useAuth } from "../hooks/useAuth";
import {
  completedFlagValue,
  type IllustrationHighlight,
  SHARE_PRACTICE_URL,
  SHARE_WALKTHROUGH_STEPS,
  type ShareIllustration,
} from "../lib/shareOnboarding";
import { useSharePracticeReceivedAt } from "../lib/sharePractice";
import { Button, IconButton, PixelIcon, Screen, Text, tokens } from "../theme";

const ILLUSTRATIONS: Record<ShareIllustration, ImageSourcePropType> = {
  "share-row": require("../../assets/share-setup/share-row.png"),
  "more-list": require("../../assets/share-setup/more-list.png"),
  "edit-favorites": require("../../assets/share-setup/edit-favorites.png"),
};

/** A share-sheet screenshot with the control to tap ringed in the accent color. */
function Illustration({
  source,
  highlight,
}: {
  source: ImageSourcePropType;
  highlight: IllustrationHighlight | null;
}) {
  const { width, height } = Image.resolveAssetSource(source);
  return (
    <View style={[styles.shot, { aspectRatio: width / height }]}>
      <Image source={source} style={styles.shotImage} resizeMode="cover" />
      {highlight ? (
        <View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              left: `${highlight.x * 100}%`,
              top: `${highlight.y * 100}%`,
              width: `${highlight.width * 100}%`,
              height: `${highlight.height * 100}%`,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

export default function ShareSetupWalkthrough() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tested?: string }>();
  // The practice share came back through the extension: setup is proven.
  // Either it arrived while this screen was open (the signal) or it routed
  // here with `?tested=1`.
  const [mountedAt] = useState(Date.now);
  const practiceAt = useSharePracticeReceivedAt();
  const tested = params.tested === "1" || practiceAt >= mountedAt;
  const [stepIndex, setStepIndex] = useState(0);
  // Back from the practice page without the proof: ask whether HighScore
  // made it in.
  const [sheetClosed, setSheetClosed] = useState(false);
  const awayRef = useRef(false);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && awayRef.current) {
        awayRef.current = false;
        setSheetClosed(true);
      }
    });
    return () => subscription.remove();
  }, []);

  const steps = SHARE_WALKTHROUGH_STEPS;
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex >= steps.length - 1;
  const confirming = Boolean(step?.tryIt) && sheetClosed;

  const complete = useMutation({
    mutationFn: () =>
      putUserFlag(token, USER_FLAG_KEYS.shareSheetAnnouncement, completedFlagValue(new Date())),
    onSettled: async () => {
      // Even a failed write shouldn't strand the user here — the announcement
      // card will simply reappear and they can finish again.
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.flags });
      goBack("/");
    },
  });

  // The practice share proves the setup, so save it now rather than on Done.
  const savedRef = useRef(false);
  useEffect(() => {
    if (!tested || savedRef.current) return;
    savedRef.current = true;
    putUserFlag(token, USER_FLAG_KEYS.shareSheetAnnouncement, completedFlagValue(new Date()))
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.users.flags }))
      .catch(() => {
        // Done writes it again.
      });
  }, [tested, token, queryClient]);

  const openPracticePage = () => {
    awayRef.current = true;
    Linking.openURL(SHARE_PRACTICE_URL).catch(() => {
      // Safari didn't open: the user can still tap "Already done".
      awayRef.current = false;
    });
  };

  const onNext = () => {
    if (isLast) {
      complete.mutate();
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  return (
    <Screen style={styles.root} testID="share-setup">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="caption" tone="muted" style={styles.eyebrow}>
            Setup
          </Text>
          <Text variant="heading" numberOfLines={1} accessibilityRole="header">
            Add HighScore to Share
          </Text>
        </View>
        <IconButton
          accessibilityLabel="Close"
          onPress={() => goBack("/")}
          testID="share-setup-close"
        >
          <PixelIcon name="close" size={24} color={tokens.text.secondary} />
        </IconButton>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {Platform.OS === "ios" && tested ? (
          <View style={styles.stepCard} testID="share-setup-tested">
            <Text style={styles.stepGlyph}>🎉</Text>
            <Text variant="title" style={styles.stepTitle}>
              You're set
            </Text>
            <Text tone="secondary" style={styles.stepBody}>
              Finish a game, tap Share, tap HighScore.
            </Text>
            <Button
              label="Done"
              size="lg"
              loading={complete.isPending}
              onPress={() => complete.mutate()}
              testID="share-setup-done"
              style={styles.fullWidth}
            />
          </View>
        ) : Platform.OS === "ios" ? (
          <>
            {step?.illustration ? (
              <Illustration source={ILLUSTRATIONS[step.illustration]} highlight={step.highlight} />
            ) : (
              <Text style={styles.stepGlyph}>📲</Text>
            )}
            <View style={styles.stepText} testID={`share-setup-step-${stepIndex}`}>
              <Text variant="caption" tone="muted" style={styles.eyebrow}>
                {stepIndex + 1} of {steps.length}
              </Text>
              {/* Back from the practice page: the question replaces the instructions. */}
              <Text variant="title" style={styles.stepTitle}>
                {confirming ? "Is HighScore at the front of the row?" : step?.title}
              </Text>
              {confirming ? null : (
                <Text tone="secondary" style={styles.stepBody}>
                  {step?.body}
                </Text>
              )}
            </View>

            {confirming ? (
              <View style={styles.tryIt} testID="share-setup-confirm">
                <Button
                  label="Yes"
                  size="lg"
                  loading={complete.isPending}
                  onPress={() => complete.mutate()}
                  testID="share-setup-confirm-yes"
                />
                <Button
                  label="Try again"
                  variant="secondary"
                  size="lg"
                  onPress={openPracticePage}
                  testID="share-setup-open-sheet"
                />
                <Text variant="caption" tone="muted" style={styles.stepBody}>
                  Not in the list? Restart your iPhone.
                </Text>
              </View>
            ) : step?.tryIt ? (
              <View style={styles.tryIt}>
                <Button
                  label="Open practice page"
                  size="lg"
                  onPress={openPracticePage}
                  testID="share-setup-open-sheet"
                />
                <Text variant="caption" tone="muted" style={styles.stepBody}>
                  More → Edit → + HighScore → ✓
                </Text>
              </View>
            ) : null}

            <View
              style={styles.dots}
              accessibilityLabel={`Step ${stepIndex + 1} of ${steps.length}`}
            >
              {steps.map((s, i) => (
                <View key={s.title} style={[styles.dot, i === stepIndex && styles.dotActive]} />
              ))}
            </View>

            <View style={styles.controls}>
              {stepIndex > 0 ? (
                <Button
                  label="Back"
                  variant="secondary"
                  size="lg"
                  onPress={() => setStepIndex((i) => i - 1)}
                  testID="share-setup-back"
                  style={styles.controlButton}
                />
              ) : null}
              {isLast && sheetClosed ? null : (
                <Button
                  label={isLast ? "Already done" : "Next"}
                  variant={isLast ? "secondary" : "primary"}
                  size="lg"
                  loading={complete.isPending}
                  onPress={onNext}
                  testID="share-setup-next"
                  style={styles.controlButton}
                />
              )}
            </View>
          </>
        ) : (
          // The share sheet is an iOS-native surface; on web there is nothing
          // to set up. Keep the route renderable rather than dead-ending.
          <View style={styles.stepCard} testID="share-setup-web-fallback">
            <Text style={styles.stepGlyph}>📱</Text>
            <Text variant="title" style={styles.stepTitle}>
              iPhone only
            </Text>
            <Text tone="secondary" style={styles.stepBody}>
              Open HighScore on your iPhone to set this up.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: tokens.bg.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
  },
  headerText: { flex: 1, minWidth: 0 },
  eyebrow: { textTransform: "uppercase", letterSpacing: 1 },
  body: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  stepCard: {
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.xl,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.bg.surface,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  stepText: { alignItems: "center", gap: tokens.space.sm },
  shot: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 360,
    maxHeight: 420,
    borderRadius: tokens.radius.lg,
    overflow: "hidden",
    backgroundColor: tokens.bg.surface,
  },
  shotImage: { width: "100%", height: "100%" },
  ring: {
    position: "absolute",
    borderWidth: 3,
    borderRadius: tokens.radius.md,
    borderColor: tokens.accent.default,
  },
  tryIt: { gap: tokens.space.sm },
  fullWidth: { alignSelf: "stretch" },
  stepGlyph: { fontSize: 56, lineHeight: 64, textAlign: "center" },
  stepTitle: { textAlign: "center" },
  stepBody: { textAlign: "center" },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: tokens.space.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.border.default,
  },
  dotActive: { backgroundColor: tokens.accent.default },
  controls: {
    flexDirection: "row",
    gap: tokens.space.md,
  },
  controlButton: { flex: 1 },
});
