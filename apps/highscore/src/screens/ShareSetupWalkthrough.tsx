// Multi-step "add HighScore to your share panel" walkthrough. Content lives in
// src/lib/shareOnboarding.ts (testable without a renderer); this screen owns
// paging + the completion write. Reached from the Games-home announcement card
// and from Edit profile, and routable directly at /share-setup.
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
import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { setMyFlag } from "../api/userFlags";
import { useAuth } from "../hooks/useAuth";
import { completedFlagValue, SHARE_WALKTHROUGH_STEPS } from "../lib/shareOnboarding";

export default function ShareSetupWalkthrough() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [stepIndex, setStepIndex] = useState(0);

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
        {Platform.OS === "ios" ? (
          <>
            <View style={styles.stepCard} testID={`share-setup-step-${stepIndex}`}>
              <Text style={styles.stepGlyph}>{step?.glyph}</Text>
              <Text variant="title" style={styles.stepTitle}>
                {step?.title}
              </Text>
              <Text tone="secondary" style={styles.stepBody}>
                {step?.body}
              </Text>
            </View>

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
              <Button
                label={isLast ? "Done" : "Next"}
                size="lg"
                loading={complete.isPending}
                onPress={onNext}
                testID="share-setup-next"
                style={styles.controlButton}
              />
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
  stepGlyph: { fontSize: 56, lineHeight: 64 },
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
