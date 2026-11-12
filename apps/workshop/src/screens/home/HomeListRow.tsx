import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { ActivityEvent, ListSummary } from "@workshop/shared";
import {
  Avatar,
  Badge,
  EmojiBadge,
  Icon,
  type ListColorKey,
  ListRow,
  Text,
  tokens,
} from "@workshop/ui";
import { memo, useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { homeRowSubtitle } from "./homeRow";
import { RowMoreButton } from "./RowMoreButton";

export interface HomeListRowProps {
  list: ListSummary;
  latestEvent: ActivityEvent | null;
  selfId: string | null;
  onPress: () => void;
  onOpenMenu: () => void;
}

/**
 * One list on home (UX pass 3.1): badge, name, the one-rule second line,
 * members as a small avatar stack, unread as a count badge. Actions: long-press
 * (touch), right-click and a trailing "more" button on hover/focus (web).
 */
export const HomeListRow = memo(function HomeListRow({
  list,
  latestEvent,
  selfId,
  onPress,
  onOpenMenu,
}: HomeListRowProps) {
  const accent = tokens.list[list.color as ListColorKey] ?? tokens.accent.default;
  const subtitle = homeRowSubtitle(list, latestEvent, selfId);
  const unread = list.mutedAt ? 0 : list.unreadCount;
  const others = Math.max(0, list.memberCount - 1);

  // Which of row/button is hovered or focused; the "more" button shows while
  // any is (web only — the native RowMoreButton renders nothing).
  const [active, setActive] = useState({ hover: 0, focus: 0 });
  const track = useCallback(
    (source: "row" | "button") => (key: "hover" | "focus", on: boolean) => {
      const bit = source === "row" ? 1 : 2;
      setActive((s) => ({ ...s, [key]: on ? s[key] | bit : s[key] & ~bit }));
    },
    [],
  );
  const trackRow = track("row");
  const moreVisible = active.hover !== 0 || active.focus !== 0;

  const a11yParts = [list.name, subtitle];
  if (unread > 0) a11yParts.push(`${unread} new`);
  if (others > 0) a11yParts.push(`shared with ${others} ${others === 1 ? "person" : "people"}`);
  if (list.pinnedAt) a11yParts.unshift("Pinned");
  if (list.mutedAt) a11yParts.push("activity muted");

  return (
    <View style={styles.wrap}>
      <ListRow
        accessibilityLabel={a11yParts.join(", ")}
        accessibilityHint="Long press for list actions"
        onPress={onPress}
        onLongPress={onOpenMenu}
        delayLongPress={350}
        testID={`list-card-${list.id}`}
        pressableProps={{
          onContextMenu: (e: { preventDefault: () => void }) => {
            e.preventDefault();
            onOpenMenu();
          },
          onHoverIn: () => trackRow("hover", true),
          onHoverOut: () => trackRow("hover", false),
          onFocus: () => trackRow("focus", true),
          onBlur: () => trackRow("focus", false),
        }}
        leading={<EmojiBadge emoji={list.emoji} color={accent} imageUrl={list.coverPhotoUrl} />}
        title={
          <View style={styles.titleRow}>
            {list.pinnedAt ? <Icon name="pin" size={12} tone="muted" /> : null}
            <Text numberOfLines={1} style={[styles.title, unread > 0 ? styles.titleUnread : null]}>
              {list.name}
            </Text>
          </View>
        }
        subtitle={
          <Text
            variant="caption"
            tone={unread > 0 ? "secondary" : "muted"}
            numberOfLines={1}
            testID={`list-card-subtitle-${list.id}`}
          >
            {subtitle}
          </Text>
        }
        trailing={
          <View style={[styles.trailing, moreVisible ? styles.trailingHidden : null]}>
            {list.mutedAt ? (
              <Text variant="caption" tone="muted">
                Muted
              </Text>
            ) : null}
            {others > 0 ? <MemberStack list={list} others={others} accent={accent} /> : null}
            {unread > 0 ? (
              <Badge
                label={unread > 9 ? "9+" : String(unread)}
                tone="accent"
                testID={`list-card-unread-${list.id}`}
              />
            ) : null}
          </View>
        }
      />
      <RowMoreButton
        visible={moreVisible}
        label={`Actions for ${list.name}`}
        onPress={onOpenMenu}
        onActiveChange={track("button")}
        testID={`list-card-more-${list.id}`}
      />
    </View>
  );
});

function MemberStack({
  list,
  others,
  accent,
}: {
  list: ListSummary;
  others: number;
  accent: string;
}) {
  // Three faces when that is everyone; otherwise two and a "+N".
  const shown = (list.memberPreview ?? []).slice(0, others <= 3 ? 3 : 2);
  const extra = others - shown.length;
  return (
    <View style={styles.stack} testID={`list-card-members-${list.id}`}>
      {shown.map((m, i) => (
        <Avatar
          key={m.userId}
          name={m.displayName}
          imageUrl={userAvatarImageUrl(m.userId)}
          size="sm"
          style={[
            styles.avatar,
            i > 0 ? styles.avatarOverlap : null,
            { borderColor: tokens.bg.canvas },
          ]}
        />
      ))}
      {extra > 0 ? (
        <View
          style={[
            styles.avatar,
            styles.more,
            shown.length > 0 ? styles.avatarOverlap : null,
            { backgroundColor: tokens.bg.elevated, borderColor: tokens.bg.canvas },
          ]}
        >
          <Text style={[styles.moreText, shown.length === 0 ? { color: accent } : null]}>
            +{extra}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.xsm, minWidth: 0 },
  title: {
    flexShrink: 1,
    fontSize: tokens.font.size.md,
    lineHeight: 22,
    fontWeight: tokens.font.weight.medium,
    letterSpacing: -0.2,
  },
  titleUnread: { fontWeight: tokens.font.weight.semibold },
  trailing: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  trailingHidden: { opacity: 0 },
  stack: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
  avatarOverlap: { marginLeft: -8 },
  more: { alignItems: "center", justifyContent: "center" },
  moreText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: tokens.font.weight.semibold,
    color: tokens.text.secondary,
  },
});
