import { Screen, Text, tokens } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useGamesRuntime } from "../runtime";
import { type PostScoreDetection, PostScoreForm } from "./PostScoreForm";

// The Games-surface score picker for the share flow (the leaderboard-list
// picker's successor). The body — detected-score card with a one-tap Post
// button, paste box, My Games rows — is `PostScoreForm`, shared with the
// home's "Paste a score" sheet; this route adds the share-sheet chrome and
// goes home once the score has posted.
export default function PickGame() {
  const params = useLocalSearchParams<{ url?: string; text?: string; via?: string }>();
  const [sharedPayload] = useState(() => readSharedPayload(params));
  // Provenance for the score write: only the share-intent redirect in
  // _layout.tsx sets `via=share-extension`, so its presence means the payload
  // arrived through the iOS share sheet (vs. a manual visit / in-app paste).
  const entrySource = firstParam(params.via) === "share-extension" ? "share_extension" : "paste";
  const router = useRouter();
  const { routes } = useGamesRuntime();
  const [detection, setDetection] = useState<PostScoreDetection>({
    label: null,
    resultless: false,
  });
  const onDetectionChange = useCallback((next: PostScoreDetection) => {
    setDetection((prev) =>
      prev.label === next.label && prev.resultless === next.resultless ? prev : next,
    );
  }, []);

  const onCancel = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(routes.root as Href);
    }
  };

  return (
    <Screen style={styles.root} testID="share-pick-game">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
          testID="share-game-cancel"
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <Text style={styles.navGlyph}>x</Text>
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text variant="title" style={styles.title}>
            Post to your Games
          </Text>
          <View style={styles.payloadPill} testID="share-game-payload">
            <View style={styles.payloadDot} />
            <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.payloadText}>
              {detection.label
                ? `${detection.label} ${detection.resultless ? "link" : "score"} detected`
                : "Score share"}
            </Text>
          </View>
        </View>
      </View>

      <PostScoreForm
        initialDraft={sharedPayload}
        entrySource={entrySource}
        onPosted={() => router.replace(routes.home as Href)}
        onOpenGames={() => router.replace(routes.home as Href)}
        onDetectionChange={onDetectionChange}
      />
    </Screen>
  );
}

function readSharedPayload(params: { url?: string | string[]; text?: string | string[] }): string {
  const text = firstParam(params.text);
  if (text) return text;
  return firstParam(params.url) ?? "";
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: tokens.bg.canvas,
  },
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
  headerTitleBlock: { flex: 1, minWidth: 0, gap: tokens.space.xs, paddingTop: 4 },
  title: { fontSize: tokens.font.size.xl },
  payloadPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 4,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    maxWidth: "100%",
  },
  payloadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tokens.accent.default,
  },
  payloadText: { flexShrink: 1 },
});
