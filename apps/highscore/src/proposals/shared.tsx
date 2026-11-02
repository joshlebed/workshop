// Shared scaffolding for the profile/friends UX proposals (dev-only route
// `/proposals`). Real data (the signed-in user, friends, requests, mutuals,
// today's games) so each proposal is judged with the owner's actual numbers.
import { useQuery } from "@tanstack/react-query";
import { fetchFriendRequests, fetchFriends, fetchMutuals } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { FriendRequestSummary, FriendSummary, MutualSummary } from "@workshop/shared/friends";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { fetchMyGames } from "../games/api/games";
import { localDateKey } from "../games/lib/gameDate";
import { useAuth } from "../hooks/useAuth";
import { Avatar, bodyType, PixelIcon, type PixelIconName, Text, tokens, uiType } from "../theme";

export interface ProfileData {
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  friends: FriendSummary[];
  inbound: FriendRequestSummary[];
  mutuals: MutualSummary[];
  /** Games on my list, with today's standings. */
  games: {
    id: string;
    title: string;
    iconUrl: string | null;
    played: boolean;
    streak: number;
    playedCount: number;
  }[];
  playedToday: number;
  bestStreak: number;
}

export function useProfileData(): ProfileData {
  const { token, user } = useAuth();
  const todayKey = localDateKey();
  const friends = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token,
  });
  const requests = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
  });
  const mutuals = useQuery({
    queryKey: queryKeys.friends.mutuals,
    queryFn: () => fetchMutuals(token),
    enabled: !!token,
  });
  const games = useQuery({
    queryKey: queryKeys.games.mine(todayKey),
    queryFn: () => fetchMyGames(todayKey, token),
    enabled: !!token,
  });
  const myGames = (games.data?.games ?? []).map((g) => ({
    id: g.gameId,
    title: g.game.title,
    iconUrl: g.game.iconUrl ?? null,
    played: g.standings.viewerHasPlayed,
    streak: g.standings.viewerStreak,
    playedCount: g.standings.entries.length,
  }));
  return {
    name: user?.displayName?.trim() || "You",
    email: user?.email ?? "",
    avatarUrl: user?.avatarUrl ?? null,
    isAdmin: !!user?.isAdmin,
    friends: friends.data?.friends ?? [],
    inbound: requests.data?.inbound ?? [],
    mutuals: mutuals.data?.mutuals ?? [],
    games: myGames,
    playedToday: myGames.filter((g) => g.played).length,
    bestStreak: myGames.reduce((m, g) => Math.max(m, g.streak), 0),
  };
}

/** The real home header, mocked: wordmark left, the proposal's triggers right. */
export function MockHeader({ right }: { right: ReactNode }) {
  return (
    <View style={s.header}>
      <Text variant="display" style={s.wordmark}>
        HighScore
      </Text>
      <View style={s.headerRight}>{right}</View>
    </View>
  );
}

export function HeaderIconButton({
  icon,
  label,
  badge,
  onPress,
  active,
}: {
  icon: PixelIconName;
  label: string;
  badge?: number;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={s.iconBtn}
    >
      <PixelIcon name={icon} size={24} color={active ? tokens.neon.pink : tokens.text.secondary} />
      {badge ? <Badge n={badge} /> : null}
    </Pressable>
  );
}

export function AvatarButton({
  data,
  onPress,
  badge,
}: {
  data: ProfileData;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Profile"
      onPress={onPress}
      style={s.iconBtn}
    >
      <Avatar name={data.name} imageUrl={data.avatarUrl} size="md" />
      {badge ? <Badge n={badge} /> : null}
    </Pressable>
  );
}

export function Badge({ n }: { n: number }) {
  return (
    <View style={s.badge}>
      <Text style={s.badgeText}>{n > 9 ? "9+" : n}</Text>
    </View>
  );
}

/** A tappable list row: leading icon or avatar, label, trailing text/chevron. */
export function Row({
  icon,
  leading,
  label,
  detail,
  trailing,
  onPress,
  tone = "primary",
  chevron = true,
  testID,
}: {
  icon?: PixelIconName;
  leading?: ReactNode;
  label: string;
  detail?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  tone?: "primary" | "secondary" | "danger" | "link";
  chevron?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed, hovered }) => [s.row, (pressed || hovered) && s.rowHover]}
    >
      {leading ??
        (icon ? (
          <PixelIcon
            name={icon}
            size={24}
            color={tone === "danger" ? tokens.status.danger : tokens.text.secondary}
          />
        ) : null)}
      <View style={s.rowText}>
        <Text variant="body" tone={tone} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron && onPress ? (
        <PixelIcon name="chevron-right" size={16} color={tokens.text.secondary} />
      ) : null}
    </Pressable>
  );
}

export function SectionLabel({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={s.sectionLabel}>
      <Text variant="overline" tone="secondary">
        {children}
      </Text>
      {right}
    </View>
  );
}

/** Pixel-numeral stat: value in Press Start 2P, label in Space Grotesk. */
export function Stat({
  value,
  label,
  tone = "primary",
}: {
  value: string | number;
  label: string;
  tone?: "primary" | "success" | "spotlight";
}) {
  return (
    <View style={s.stat}>
      <Text variant="score" tone={tone} style={s.statValue}>
        {value}
      </Text>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
    </View>
  );
}

export function TextLink({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={6}>
      <Text variant="caption" style={s.textLink}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Phone-sized frame so a proposal reads at the size it ships at. */
export function Phone({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.phone, style]}>{children}</View>;
}

export function Divider() {
  return <View style={s.divider} />;
}

export const proposalStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.bg.canvas },
  pad: { paddingHorizontal: tokens.space.lg },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.xs,
  },
  navTitle: { flex: 1, minWidth: 0 },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
  },
  identityText: { flex: 1, minWidth: 0 },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
    gap: tokens.space.lg,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
  },
  linkRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.lg,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
  },
  acceptBtn: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    paddingHorizontal: tokens.space.md,
    height: 32,
    justifyContent: "center",
  },
  acceptText: { ...uiType(10), color: tokens.neon.pinkTint },
  quietBtn: {
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
    height: 32,
    justifyContent: "center",
  },
  quietText: { ...uiType(10), color: tokens.text.secondary },
});

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
  },
  wordmark: { fontSize: 14, lineHeight: 22 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    right: 2,
    top: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.neon.pink,
    borderWidth: 2,
    borderColor: tokens.bg.canvas,
  },
  badgeText: { ...bodyType("bold"), fontSize: 9, lineHeight: 11, color: tokens.text.onAccent },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    minHeight: 52,
  },
  rowHover: { backgroundColor: tokens.bg.surface },
  rowText: { flex: 1, minWidth: 0 },
  sectionLabel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.xs,
  },
  stat: { gap: 2 },
  statValue: { fontSize: 18, lineHeight: 26 },
  textLink: { color: tokens.text.secondary, textDecorationLine: "underline" },
  phone: {
    width: 390,
    maxWidth: "100%",
    minHeight: 760,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
    overflow: "hidden",
    alignSelf: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.default,
    marginHorizontal: tokens.space.lg,
  },
});
