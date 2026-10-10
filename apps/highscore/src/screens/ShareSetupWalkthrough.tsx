// Multi-step "add HighScore to your share panel" walkthrough. Content lives in
// src/lib/shareOnboarding.ts (testable without a renderer); this screen owns
// paging + the completion write. Reached from the Games-home announcement card
// and from Edit profile, and routable directly at /share-setup.
//
// Each "how" step shows a screenshot of the real iOS share sheet with the
// control to tap ringed. The last step opens a live share sheet (sharing
// SHARE_PRACTICE_TEXT) so the user does the setup right there, then asks
// whether HighScore is at the front when the sheet closes. If the user taps
// HighScore in that sheet instead, that proves it: `Share.share` reports our
// extension, or `_layout.tsx` routes the practice payload to
// `/share-setup?tested=1` — either way the "it works" state.
//
// Finishing writes the `games.share-sheet-announcement` flag with
// `{ completedAt }` — server-side, so no other device re-blasts the
// announcement. Closing early writes nothing: the card stays until the user
// explicitly deals with it.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import { Button, Screen, Text, tokens } from "@workshop/ui";
import { goBack } from "@workshop/ui/navigation";
import Constants from "expo-constants";
import { useLocalSearchParams } from "expo-router";
import { getShareExtensionKey, ShareIntentModule } from "expo-share-intent";
import { useState } from "react";
import {
  Image,
  type ImageSourcePropType,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { setMyFlag } from "../api/userFlags";
import { useAuth } from "../hooks/useAuth";
import {
  completedFlagValue,
  type IllustrationHighlight,
  SHARE_PRACTICE_TEXT,
  SHARE_WALKTHROUGH_STEPS,
  type ShareIllustration,
} from "../lib/shareOnboarding";
import { markSharePracticeReceived, useSharePracticeReceivedAt } from "../lib/sharePractice";

const ILLUSTRATIONS: Record<ShareIllustration, ImageSourcePropType> = {
  "share-row": require("../../assets/share-setup/share-row.png"),
  "more-list": require("../../assets/share-setup/more-list.png"),
  "edit-favorites": require("../../assets/share-setup/edit-favorites.png"),
};

/** The share extension's bundle id is the app's, plus a suffix. */
function isOwnShareExtension(activityType: string | null | undefined): boolean {
  const appId = Constants.expoConfig?.ios?.bundleIdentifier;
  return !!appId && !!activityType?.startsWith(`${appId}.`);
}

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
  // The live sheet was opened and closed: ask whether HighScore made it in.
  const [sheetClosed, setSheetClosed] = useState(false);

  const steps = SHARE_WALKTHROUGH_STEPS;
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex >= steps.length - 1;

  const complete = useMutation({
    mutationFn: () =>
      setMyFlag(USER_FLAG_KEYS.shareSheetAnnouncement, completedFlagValue(new Date()), token),
    onSettled: async () => {
      // Even a failed write shouldn't strand the user here — the announcement
      // card will simply reappear and they can finish again.
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.flags });
      goBack("/");
    },
  });

  const openShareSheet = async () => {
    try {
      const result = await Share.share({ message: SHARE_PRACTICE_TEXT });
      // iOS names the activity the user picked; ours is the share extension.
      // This is the reliable signal: the extension's hand-off back into an
      // app that never left the foreground reuses the same deep link, which
      // `useShareIntent` doesn't re-read. Clear that pending payload so it
      // can't surface on the next foreground as a second "it works".
      if (result.action === Share.sharedAction && isOwnShareExtension(result.activityType)) {
        markSharePracticeReceived();
        ShareIntentModule?.clearShareIntent(getShareExtensionKey());
      } else {
        setSheetClosed(true);
      }
    } catch {
      // The user can still tap "I've added it".
    }
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => goBack("/")}
          testID="share-setup-close"
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <Text style={styles.navGlyph}>x</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text variant="caption" tone="muted" style={styles.eyebrow}>
            One-time setup
          </Text>
          <Text variant="heading" numberOfLines={1}>
            Share sheet setup
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {Platform.OS === "ios" && tested ? (
          <View style={styles.stepCard} testID="share-setup-tested">
            <Text style={styles.stepGlyph}>🎉</Text>
            <Text variant="title" style={styles.stepTitle}>
              It works
            </Text>
            <Text tone="secondary" style={styles.stepBody}>
              HighScore is in your share sheet. Next time you finish a game, tap Share, then
              HighScore — your score posts itself.
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
                Step {stepIndex + 1} of {steps.length}
              </Text>
              <Text variant="title" style={styles.stepTitle}>
                {step?.title}
              </Text>
              <Text tone="secondary" style={styles.stepBody}>
                {step?.body}
              </Text>
            </View>

            {step?.tryIt && sheetClosed ? (
              <View style={styles.tryIt} testID="share-setup-confirm">
                <Text variant="heading" style={styles.stepBody}>
                  Is HighScore at the front of the app row now?
                </Text>
                <Button
                  label="Yes, all set"
                  size="lg"
                  loading={complete.isPending}
                  onPress={() => complete.mutate()}
                  testID="share-setup-confirm-yes"
                />
                <Button
                  label="Open share sheet again"
                  variant="secondary"
                  size="lg"
                  onPress={() => void openShareSheet()}
                  testID="share-setup-open-sheet"
                />
              </View>
            ) : step?.tryIt ? (
              <View style={styles.tryIt}>
                <Button
                  label="Open share sheet"
                  size="lg"
                  onPress={() => void openShareSheet()}
                  testID="share-setup-open-sheet"
                />
                <Text variant="caption" tone="muted" style={styles.stepBody}>
                  In the sheet: More → Edit → + HighScore → ✓
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
                  label={isLast ? "I've added it" : "Next"}
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
              Grab the iPhone app
            </Text>
            <Text tone="secondary" style={styles.stepBody}>
              Posting scores straight from the share sheet is an iPhone feature. Open HighScore on
              your iPhone and revisit this setup from your profile.
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
    alignItems: "flex-start",
    gap: tokens.space.xs,
    paddingHorizontal: tokens.space.sm,
    paddingRight: tokens.space.lg,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  navGlyph: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.semibold,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2, paddingTop: 4 },
  eyebrow: { letterSpacing: 0.4, textTransform: "uppercase" },
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
    borderWidth: 1,
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
    borderWidth: 1,
    borderColor: tokens.border.default,
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
    borderRadius: 4,
    backgroundColor: tokens.border.default,
  },
  dotActive: { backgroundColor: tokens.accent.default },
  controls: {
    flexDirection: "row",
    gap: tokens.space.md,
  },
  controlButton: { flex: 1 },
});
