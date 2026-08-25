import { setItem } from "@workshop/api-client/storage";
import type { Item, ListItemsResponse, ListPreview } from "@workshop/shared";
import { Button, Card, type ListColorKey, Screen, Text, tokens } from "@workshop/ui";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { goBack } from "../lib/goBack";

/**
 * The most-recent path a signed-out user clicked through to (either
 * `/list/:id` or `/l/:slug`), stashed before the AuthGate bounces them to
 * `/sign-in`. After sign-in, `app/_layout.tsx` consumes this and replaces
 * the user back onto that path so the landing → sign-in → landing-as-authed
 * loop closes without forcing them to re-click the share link.
 */
export const PENDING_RETURN_PATH_KEY = "workshop.pending-return-path";

interface Props {
  preview: ListPreview;
  viewer: { authenticated: boolean; isMember: boolean };
  /**
   * Present when we landed here via `/l/:slug` — used to build the
   * return-to-here path during the sign-in round trip. When omitted (legacy
   * `/list/:id` callers), we fall back to the canonical UUID URL.
   */
  shareSlug?: string;
  /** Items split for view-mode rendering. Null when not yet loaded or unavailable. */
  items?: ListItemsResponse | null;
  /** Join action — `null` when the link is not in `join` visibility. */
  onJoin?: (() => Promise<void>) | null;
  joinPending?: boolean;
}

/**
 * Public landing page rendered when a non-member (or signed-out visitor)
 * lands on `/l/:slug` or `/list/:id`. CTA depends on the list's share
 * visibility:
 *
 *  - **join** (default): "Sign in to join" / "Join this list" — the legacy
 *    invite-token flow rebranded around the slug. Clicking through adds the
 *    user as a member and routes them to the list.
 *  - **view**: read-only landing. Items render inline (titles + completion
 *    state); no join button. The owner explicitly opted into a publicly
 *    readable list.
 *  - **off**: this screen never renders — the parent route already 404'd.
 *
 * Already-a-member is also never reached (the parent redirects), but a
 * stale-data race could flash it briefly; we render the "Open list"
 * affordance so the user can step forward without reloading.
 */
export function ListPublicLanding({
  preview,
  viewer,
  shareSlug,
  items,
  onJoin,
  joinPending,
}: Props) {
  const router = useRouter();
  const accent =
    (preview.color as ListColorKey) in tokens.list
      ? tokens.list[preview.color as ListColorKey]
      : tokens.accent.default;
  const [joining, setJoining] = useState(false);

  const returnPath = shareSlug ? `/l/${shareSlug}` : `/list/${preview.id}`;
  const stashReturnPath = async () => {
    await setItem(PENDING_RETURN_PATH_KEY, returnPath).catch(() => {});
  };

  const handleJoin = async () => {
    if (!onJoin || joining) return;
    setJoining(true);
    try {
      await onJoin();
    } finally {
      setJoining(false);
    }
  };

  const visibility = preview.shareVisibility;
  const allItems: Item[] = items ? [...items.ordered, ...items.unordered, ...items.completed] : [];

  return (
    <Screen style={styles.screen}>
      <View style={styles.headerNav}>
        <Button
          variant="ghost"
          size="md"
          label="‹ Back"
          onPress={() => goBack("/")}
          testID="list-landing-back"
        />
      </View>

      <View style={styles.hero}>
        <View
          style={[styles.badge, { backgroundColor: `${accent}1F`, borderColor: `${accent}33` }]}
        >
          <Text style={styles.badgeEmoji}>{preview.emoji}</Text>
        </View>
        <Text variant="title" style={styles.title} testID="list-landing-name">
          {preview.name}
        </Text>
        <Text tone="muted" style={styles.byline}>
          {preview.ownerName ? `by ${preview.ownerName}` : "Private list"}
          {" · "}
          {preview.memberCount} {preview.memberCount === 1 ? "member" : "members"}
          {" · "}
          {preview.itemCount} {preview.itemCount === 1 ? "item" : "items"}
        </Text>
      </View>

      <Card style={styles.cta} elevated>
        {!viewer.authenticated ? (
          <>
            <Text variant="title" style={styles.ctaHeading}>
              {visibility === "view" ? "Sign in to see more" : "Sign in to join"}
            </Text>
            <Text tone="secondary" style={styles.ctaBody}>
              {visibility === "view"
                ? `${preview.ownerName ?? "The owner"} shared this list as read-only. Sign in to see the items.`
                : "Workshop is a private space for lists you build with friends. Create an account to join this one."}
            </Text>
            <Button
              label="Create account or sign in"
              variant="primary"
              size="lg"
              onPress={async () => {
                await stashReturnPath();
                router.push("/sign-in");
              }}
              testID="list-landing-sign-in"
            />
          </>
        ) : viewer.isMember ? (
          <>
            <Text variant="title" style={styles.ctaHeading}>
              You're a member
            </Text>
            <Text tone="secondary" style={styles.ctaBody}>
              Open the list to see what's inside.
            </Text>
            <Button
              label="Open list"
              variant="primary"
              size="lg"
              onPress={() => router.replace(`/list/${preview.id}`)}
              testID="list-landing-open"
            />
          </>
        ) : visibility === "join" && onJoin ? (
          <>
            <Text variant="title" style={styles.ctaHeading}>
              Join this list
            </Text>
            <Text tone="secondary" style={styles.ctaBody}>
              Anyone with the link can join.{" "}
              {preview.ownerName ? `Joining adds you alongside ${preview.ownerName}.` : ""}
            </Text>
            <Button
              label="Join list"
              variant="primary"
              size="lg"
              loading={joining || joinPending}
              disabled={joining || joinPending}
              onPress={handleJoin}
              testID="list-landing-join"
            />
          </>
        ) : visibility === "view" ? (
          <>
            <Text variant="title" style={styles.ctaHeading}>
              Read-only list
            </Text>
            <Text tone="secondary" style={styles.ctaBody}>
              {preview.ownerName ?? "The owner"} shared this list as read-only. Items are listed
              below. Ask the owner if you'd like to add or change anything.
            </Text>
          </>
        ) : (
          <>
            <Text variant="title" style={styles.ctaHeading}>
              Ask to join
            </Text>
            <Text tone="secondary" style={styles.ctaBody}>
              You're signed in, but joining is currently disabled for this list. Ask{" "}
              {preview.ownerName ?? "the owner"} to share a fresh link with joining enabled.
            </Text>
          </>
        )}
      </Card>

      {visibility === "view" && allItems.length > 0 ? (
        <ScrollView contentContainerStyle={styles.itemsBody} testID="list-landing-items">
          <Text variant="caption" tone="muted" style={styles.itemsLabel}>
            Items
          </Text>
          {allItems.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              {item.completed ? (
                <Text style={styles.itemCheck}>✓</Text>
              ) : (
                <View style={styles.itemDot} />
              )}
              <Text
                variant="body"
                style={item.completed ? styles.itemTitleDone : styles.itemTitle}
                numberOfLines={2}
              >
                {item.title}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.xl,
    gap: tokens.space.xl,
  },
  headerNav: {
    paddingHorizontal: tokens.space.sm,
    alignSelf: "flex-start",
  },
  hero: {
    alignItems: "center",
    paddingHorizontal: tokens.space.xl,
    gap: tokens.space.md,
  },
  badge: {
    width: 88,
    height: 88,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeEmoji: { fontSize: 48, lineHeight: 56 },
  title: {
    textAlign: "center",
    letterSpacing: -0.5,
    fontSize: 28,
    lineHeight: 32,
  },
  byline: {
    textAlign: "center",
    letterSpacing: 0.2,
  },
  cta: {
    marginHorizontal: tokens.space.xl,
    gap: tokens.space.md,
    padding: tokens.space.xl,
  },
  ctaHeading: { fontSize: 20, lineHeight: 24 },
  ctaBody: { lineHeight: 20 },
  itemsBody: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.sm,
  },
  itemsLabel: {
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: tokens.space.xs,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
  },
  itemCheck: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.md,
    width: 18,
    textAlign: "center",
  },
  itemDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.border.default,
    marginLeft: 5,
    marginRight: 5,
  },
  itemTitle: { flex: 1, color: tokens.text.primary },
  itemTitleDone: { flex: 1, color: tokens.text.muted, textDecorationLine: "line-through" },
});
