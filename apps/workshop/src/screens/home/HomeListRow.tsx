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
import { Platform, StyleSheet, View } from "react-native";
import { homeRowSubtitle, memberStackFaces } from "./homeRow";
import { RowMoreButton } from "./RowMoreButton";

export interface HomeListRowProps {
  list: ListSummary;
  latestEvent: ActivityEvent | null;
  selfId: string | null;
  onPress: () => void;
  onOpenMenu: () => void;
  /** The list open in the right pane of the desktop two-pane layout. */
  selected?: boolean;
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
  selected,
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

  // What only the badge, the pin and the avatars say. On web the row is named
  // by its own text (so a voice-control user can say what they see, WCAG
  // 2.5.3) and these extras are its description; native reads one label.
  const unreadLabel = unread > 9 ? "9+" : String(unread);
  const extras: string[] = [];
  if (unread > 0) extras.push(`${unreadLabel} new`);
  if (others > 0) extras.push(`shared with ${others} ${others === 1 ? "person" : "people"}`);
  if (list.pinnedAt) extras.push("pinned");
  const nativeLabel = [list.name, subtitle, list.mutedAt ? "Muted" : null, ...extras]
    .filter(Boolean)
    .join(", ");
  const describedById = `list-card-desc-${list.id}`;
  const web = Platform.OS === "web";

  return (
    <View style={styles.wrap}>
      <ListRow
        accessibilityLabel={web ? undefined : nativeLabel}
        accessibilityHint="Long press for list actions"
        onPress={onPress}
        onLongPress={onOpenMenu}
        delayLongPress={350}
        selected={selected}
        testID={`list-card-${list.id}`}
        pressableProps={{
          ...(web && extras.length > 0 ? { "aria-describedby": describedById } : {}),
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
            <MemberStack list={list} others={others} />
            {unread > 0 ? (
              <Badge label={unreadLabel} tone="accent" testID={`list-card-unread-${list.id}`} />
            ) : null}
          </View>
        }
      />
      {web && extras.length > 0 ? (
        // Referenced by aria-describedby; hidden nodes still describe.
        <Text nativeID={describedById} style={styles.hidden}>
          {extras.join(", ")}
        </Text>
      ) : null}
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

function MemberStack({ list, others }: { list: ListSummary; others: number }) {
  const faces = memberStackFaces(others, list.memberPreview);
  if (!faces) return null;
  const { shown, extra } = faces;
  return (
    <View
      style={styles.stack}
      testID={`list-card-members-${list.id}`}
      // The row's name says "shared with N people"; the faces are decoration.
      aria-hidden
    >
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
            styles.more,
            styles.avatarOverlap,
            { backgroundColor: tokens.bg.elevated, borderColor: tokens.bg.canvas },
          ]}
        >
          <Text variant="caption" tone="secondary" style={styles.moreText}>
            +{extra}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  hidden: { display: "none" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.xsm, minWidth: 0 },
  title: {
    flexShrink: 1,
    fontWeight: tokens.font.weight.medium,
    letterSpacing: tokens.font.tracking.heading,
  },
  titleUnread: { fontWeight: tokens.font.weight.semibold },
  trailing: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  trailingHidden: { opacity: 0 },
  stack: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 26, height: 26, borderRadius: tokens.radius.pill, borderWidth: 2 },
  avatarOverlap: { marginLeft: -tokens.space.sm },
  // Floors, so a "+12" or a larger text size grows the chip instead of clipping.
  more: {
    minWidth: 26,
    minHeight: 26,
    borderRadius: tokens.radius.pill,
    borderWidth: 2,
    paddingHorizontal: tokens.space.xxs,
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: { fontWeight: tokens.font.weight.semibold, fontVariant: ["tabular-nums"] },
});
