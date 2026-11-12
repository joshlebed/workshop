import { useQuery } from "@tanstack/react-query";
import { setItem } from "@workshop/api-client/storage";
import type { Item, ListPreview } from "@workshop/shared";
import {
  Button,
  Card,
  EmojiBadge,
  Icon,
  type ListColorKey,
  layout,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  screenColumnStyle,
  Text,
  tokens,
} from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { fetchListItemsBySlug } from "../api/share";
import { useAuth } from "../hooks/useAuth";
import { goBack } from "../lib/goBack";
import { PENDING_RETURN_PATH_KEY } from "../lib/returnPath";

interface Props {
  preview: ListPreview;
  viewer: { authenticated: boolean; isMember: boolean };
  /**
   * Where sign-in should bring the visitor back to: `/l/:slug`,
   * `/list/:id` or `/invite/:token`. Defaults to the canonical list URL.
   */
  returnPath?: string;
  /** Join action; `null` when the viewer can't join from here. */
  onJoin?: (() => Promise<void>) | null;
  /** Runs before sign-in (the legacy invite also stashes its token). */
  onBeforeSignIn?: () => Promise<void>;
}

/**
 * The public landing for a share link (`/l/:slug`, `/list/:id`, and the
 * legacy `/invite/:token`). One preview, one explicit action (4.6):
 *
 *  - **join**: signed out, "Sign in to join"; signed in, "Join list".
 *  - **view**: the items, read-only, with no sign-in wall in front of them.
 *    A signed-out visitor gets a quiet way to start their own lists.
 *  - **off**: never rendered (the route 404s), except in a stale race,
 *    where a signed-in visitor is told to ask for a new link.
 */
export function ListPublicLanding({ preview, viewer, returnPath, onJoin, onBeforeSignIn }: Props) {
  const router = useRouter();
  const { token } = useAuth();
  const accent =
    (preview.color as ListColorKey) in tokens.list
      ? tokens.list[preview.color as ListColorKey]
      : tokens.accent.default;
  const [joining, setJoining] = useState(false);
  const visibility = preview.shareVisibility;
  const readOnly = visibility === "view" && !viewer.isMember;

  // Read-only lists show their items to anyone with the link.
  const itemsQuery = useQuery({
    queryKey: ["lists", "by-slug-items", preview.shareSlug],
    queryFn: () => fetchListItemsBySlug(preview.shareSlug, token),
    enabled: readOnly,
  });
  const items: Item[] = itemsQuery.data
    ? [...itemsQuery.data.ordered, ...itemsQuery.data.unordered, ...itemsQuery.data.completed]
    : [];

  const signIn = async () => {
    await setItem(PENDING_RETURN_PATH_KEY, returnPath ?? `/list/${preview.id}`).catch(() => {});
    await onBeforeSignIn?.();
    router.push("/sign-in");
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

  const owner = preview.ownerName ?? null;
  const byline = [
    owner ? `by ${owner}` : null,
    `${preview.memberCount} ${preview.memberCount === 1 ? "member" : "members"}`,
    `${preview.itemCount} ${preview.itemCount === 1 ? "item" : "items"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Screen style={styles.screen}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/")}
        leadingTestID="list-landing-back"
      />
      <ScrollView contentContainerStyle={[styles.body, screenColumnStyle]}>
        <View style={styles.hero}>
          <EmojiBadge emoji={preview.emoji} color={accent} size={72} shape="rounded" />
          <Text variant="title" style={styles.centered} testID="list-landing-name">
            {preview.name}
          </Text>
          <Text tone="muted" style={styles.centered} testID="list-landing-byline">
            {byline}
          </Text>
          {preview.description ? (
            <Text tone="secondary" style={styles.centered}>
              {preview.description}
            </Text>
          ) : null}
        </View>

        {viewer.isMember ? (
          <Card style={styles.cta} elevated>
            <Text variant="heading">You're on this list</Text>
            <Button
              label="Open list"
              size="lg"
              onPress={() => router.replace(`/list/${preview.id}` as Href, { withAnchor: true })}
              testID="list-landing-open"
            />
          </Card>
        ) : visibility === "join" ? (
          <Card style={styles.cta} elevated>
            <Text variant="heading">Join this list</Text>
            <Text tone="secondary">
              {owner
                ? `${owner} shared it with you. Joining lets you add to it, and it shows up on your home.`
                : "Joining lets you add to it, and it shows up on your home."}
            </Text>
            {viewer.authenticated ? (
              <Button
                label="Join list"
                size="lg"
                loading={joining}
                disabled={joining || !onJoin}
                onPress={handleJoin}
                testID="list-landing-join"
              />
            ) : (
              <Button
                label="Sign in to join"
                size="lg"
                onPress={() => void signIn()}
                testID="list-landing-sign-in"
              />
            )}
          </Card>
        ) : visibility === "view" ? (
          <Text tone="muted" style={styles.readOnly} testID="list-landing-read-only">
            {owner ? `${owner} shared this list to read.` : "This list is shared to read."} Only its
            members can change it.
          </Text>
        ) : (
          <Card style={styles.cta} elevated>
            <Text variant="heading">This link doesn't let you join</Text>
            <Text tone="secondary">Ask {owner ?? "the owner"} for a new link.</Text>
          </Card>
        )}

        {readOnly ? (
          <View style={styles.items} testID="list-landing-items">
            <SectionHeader title="Items" inset={false} />
            {itemsQuery.isPending ? (
              <Skeleton.Rows count={4} />
            ) : itemsQuery.isError ? (
              <View style={styles.itemsError}>
                <Text tone="secondary">Couldn't load the items.</Text>
                <Button
                  label="Try again"
                  variant="secondary"
                  size="md"
                  onPress={() => void itemsQuery.refetch()}
                />
              </View>
            ) : items.length === 0 ? (
              <Text tone="muted">Nothing on it yet.</Text>
            ) : (
              items.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  {item.completed ? (
                    <Icon name="check" size={18} tone="muted" />
                  ) : (
                    <View style={styles.itemMark}>
                      <View style={styles.itemDot} />
                    </View>
                  )}
                  <Text
                    variant="body"
                    style={item.completed ? styles.itemTitleDone : styles.itemTitle}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        {readOnly && !viewer.authenticated ? (
          <View style={styles.ownLists}>
            <Button
              label="Start your own lists"
              variant="secondary"
              onPress={() => void signIn()}
              testID="list-landing-sign-in"
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** First-load placeholder in the landing's shape: header, badge, title, CTA card. */
export function ListPublicLandingSkeleton() {
  return (
    <Screen style={styles.screen}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/")}
        leadingTestID="list-landing-back"
      />
      <View style={[styles.body, styles.hero, screenColumnStyle]} testID="list-landing-loading">
        <Skeleton.Block width={72} height={72} radius={tokens.radius.md} />
        <Skeleton.Block width="60%" height={28} />
        <Skeleton.Block width="45%" height={14} />
      </View>
      <View style={screenColumnStyle}>
        <View style={styles.ctaSkeleton}>
          <Skeleton.Block height={160} radius={tokens.radius.lg} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: { paddingTop: tokens.space.lg, paddingBottom: layout.bottomInset },
  ctaSkeleton: { marginHorizontal: layout.gutter, marginTop: tokens.space.xl },
  hero: {
    alignItems: "center",
    paddingHorizontal: layout.gutter,
    gap: tokens.space.md,
  },
  centered: { textAlign: "center" },
  cta: {
    marginTop: tokens.space.xl,
    marginHorizontal: layout.gutter,
    gap: tokens.space.md,
    padding: tokens.space.xl,
  },
  readOnly: {
    marginTop: tokens.space.lg,
    marginHorizontal: layout.gutter,
    textAlign: "center",
  },
  items: { paddingHorizontal: layout.gutter, gap: tokens.space.sm },
  itemsError: { gap: tokens.space.sm, alignItems: "flex-start" },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
  },
  itemMark: { width: 18, alignItems: "center" },
  itemDot: {
    width: 8,
    height: 8,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.border.default,
  },
  itemTitle: { flex: 1, color: tokens.text.primary },
  itemTitleDone: { flex: 1, color: tokens.text.muted, textDecorationLine: "line-through" },
  ownLists: { paddingHorizontal: layout.gutter, paddingTop: tokens.space.xl },
});
