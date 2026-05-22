import type { ListPreview } from "@workshop/shared";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { goBack } from "../lib/goBack";
import { setItem } from "../lib/storage";
import { Button, Card, type ListColorKey, Screen, Text, tokens } from "../ui/index";

/**
 * The most-recent `/list/:id` path a signed-out user clicked through to,
 * stashed before the AuthGate bounces them to `/sign-in`. After sign-in,
 * `app/_layout.tsx` consumes this and replaces the user back onto that path
 * so the landing → sign-in → landing-as-authed-non-member loop closes
 * without the user having to re-click the link. Mirrors the
 * `PENDING_INVITE_TOKEN_KEY` pattern in `inviteStash.ts`.
 */
export const PENDING_RETURN_PATH_KEY = "workshop.pending-return-path";

interface Props {
  preview: ListPreview;
  viewer: { authenticated: boolean; isMember: boolean };
}

/**
 * Public landing page rendered when a non-member (or signed-out visitor)
 * lands on `/list/:id`. Three states, all intentionally low-information —
 * we show the list's name + emoji + owner so the visitor knows what they
 * clicked through to, but never leak items, member identities, or scores.
 *
 * - Unauthenticated → "Sign in to join" CTA. Stashes the current path so
 *   the AuthGate bounces back here on success.
 * - Authenticated non-member → tells them to ask the owner for an invite.
 *   No "request to join" backend exists yet (no `join_requests` table); the
 *   invite-token flow in `app/list/[id]/settings.tsx` is the join mechanism.
 * - Authenticated member → small "Open list" affordance. Normally
 *   unreachable (the parent route would have rendered `ListDetail`), but a
 *   stale-data race could land us here briefly.
 */
export function ListPublicLanding({ preview, viewer }: Props) {
  const router = useRouter();
  const accent =
    (preview.color as ListColorKey) in tokens.list
      ? tokens.list[preview.color as ListColorKey]
      : tokens.accent.default;

  const stashReturnPath = async () => {
    await setItem(PENDING_RETURN_PATH_KEY, `/list/${preview.id}`).catch(() => {});
  };

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
              Sign in to join
            </Text>
            <Text tone="secondary" style={styles.ctaBody}>
              Workshop is a private space for lists you build with friends. Create an account to ask{" "}
              {preview.ownerName ?? "the owner"} to add you to this one.
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
        ) : (
          <>
            <Text variant="title" style={styles.ctaHeading}>
              Ask to join
            </Text>
            <Text tone="secondary" style={styles.ctaBody}>
              You're signed in, but you're not on this list yet. Ask{" "}
              {preview.ownerName ? (
                <Text style={styles.owner}>{preview.ownerName}</Text>
              ) : (
                "the owner"
              )}{" "}
              to share an invite link with you — they can generate one from the list's settings.
            </Text>
          </>
        )}
      </Card>
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
  owner: { color: tokens.text.primary, fontWeight: tokens.font.weight.semibold },
});
