// Five candidate layouts for a per-game board score row, switchable in dev
// (see `BoardRowVariantSwitcher`). Each one fixes the same problems with the
// current row — too many alignment axes, a score box floating mid-row, a
// loose edit control — in a different way. Pick one, delete the rest.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { Game, GameStandingsEntry } from "@workshop/shared/games";
import { formatRelative } from "@workshop/ui";
import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  Avatar,
  bodyType,
  PixelIcon,
  scoreType,
  shareTextType,
  Text,
  tokens,
  uiType,
} from "../../theme";
import { scoreLineLabel } from "../lib/scoreCheck";
import { summarizeGameScoreBody } from "../lib/scoresSummary";

export const BOARD_ROW_VARIANTS = [
  { key: "ledger", label: "Ledger" },
  { key: "arcade", label: "Arcade" },
  { key: "bezel", label: "Bezel" },
  { key: "podium", label: "Podium" },
  { key: "snippet", label: "Snippet" },
] as const;
export type BoardRowVariant = (typeof BOARD_ROW_VARIANTS)[number]["key"];
/** The switcher also offers today's row ("Current") for comparison. */
export type BoardRowChoice = BoardRowVariant | "current";

export interface BoardRowProps {
  variant: BoardRowVariant;
  entry: GameStandingsEntry;
  game: Pick<Game, "title" | "url" | "summarySpec" | "hasFormatter">;
  teachAvailable: boolean;
  isMe: boolean;
  onEdit?: () => void;
  onReport?: () => void;
  onPressPlayer?: (userId: string) => void;
}

const ORDINAL = ["", "1ST", "2ND", "3RD"];
function ordinal(rank: number): string {
  return ORDINAL[rank] ?? `${rank}TH`;
}

/** Everything every variant needs, derived once. */
function useRowModel({ entry, game, teachAvailable, onPressPlayer }: BoardRowProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  return {
    name: entry.displayName ?? "Someone",
    ago: entry.updatedAt ? formatRelative(entry.updatedAt) : null,
    body: summarizeGameScoreBody(game, entry),
    picked: scoreLineLabel(entry, game, teachAvailable),
    score:
      entry.scoreValue != null && Number.isFinite(entry.scoreValue)
        ? entry.scoreValue.toLocaleString()
        : null,
    avatarUrl: userAvatarImageUrl(entry.userId, entry.avatarVersion),
    openPlayer: onPressPlayer ? () => onPressPlayer(entry.userId) : undefined,
    showOriginal,
    toggleOriginal: () => setShowOriginal((s) => !s),
  };
}
type RowModel = ReturnType<typeof useRowModel>;

/** The share text plus the picked / adjusted / original lines, shared by all variants. */
function ShareBlock({
  m,
  entry,
  style,
}: {
  m: RowModel;
  entry: GameStandingsEntry;
  style?: object;
}) {
  return (
    <View style={[s.shareBlock, style]}>
      <Text
        style={[s.share, m.body ? null : s.shareMuted]}
        testID={`game-board-score-${entry.userId}`}
      >
        {m.body ?? "Played"}
      </Text>
      {m.picked ? (
        <View style={s.pickedRow}>
          <Text variant="caption" tone="muted">
            {m.picked}
          </Text>
          {entry.adjusted ? (
            <Pressable accessibilityRole="button" onPress={m.toggleOriginal} hitSlop={8}>
              <Text variant="caption" tone="muted" style={s.underline}>
                adjusted
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {entry.adjusted && m.showOriginal ? (
        <Text style={[s.share, s.shareMuted]}>{entry.scoreRaw}</Text>
      ) : null}
    </View>
  );
}

function EditButton({ onEdit }: { onEdit?: () => void }) {
  if (!onEdit) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Edit your score"
      onPress={onEdit}
      hitSlop={8}
      testID="game-board-edit-score"
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        s.editBtn,
        (pressed || hovered) && s.editBtnHover,
      ]}
    >
      <PixelIcon name="pencil" size={16} color={tokens.text.secondary} />
    </Pressable>
  );
}

function NameLink({ m, style }: { m: RowModel; style?: object }) {
  return (
    <Pressable
      onPress={m.openPlayer}
      disabled={!m.openPlayer}
      accessibilityRole="button"
      accessibilityLabel={`View ${m.name}'s profile`}
      style={({ pressed }) => [s.nameLink, pressed && s.pressed]}
    >
      <Text numberOfLines={1} style={[s.name, style]}>
        {m.name}
      </Text>
    </Pressable>
  );
}

/** Long-press-to-report wrapper (Guideline 1.2) shared by every variant. */
function RowShell({
  props,
  style,
  children,
}: {
  props: BoardRowProps;
  style?: object | (object | false)[];
  children: ReactNode;
}) {
  return (
    <Pressable
      onLongPress={props.onReport}
      disabled={!props.onReport}
      accessibilityHint={props.onReport ? "Long-press to report this score" : undefined}
      style={style}
      testID={`game-board-row-${props.entry.userId}`}
    >
      {children}
    </Pressable>
  );
}

export function BoardRow(props: BoardRowProps) {
  const m = useRowModel(props);
  switch (props.variant) {
    case "ledger":
      return <LedgerRow p={props} m={m} />;
    case "arcade":
      return <ArcadeRow p={props} m={m} />;
    case "bezel":
      return <BezelRow p={props} m={m} />;
    case "podium":
      return <PodiumRow p={props} m={m} />;
    case "snippet":
      return <SnippetRow p={props} m={m} />;
  }
}

// ── A · Ledger ────────────────────────────────────────────────────────────
// One header line carries everything you scan: rank, face, name, time, and the
// score as a bare pixel numeral right-aligned on the same baseline. The share
// text hangs underneath, indented to the name. Two axes total: the name column
// and the right edge.
function LedgerRow({ p, m }: { p: BoardRowProps; m: RowModel }) {
  const rank = p.entry.rank;
  return (
    <RowShell props={p} style={[s.ledger, p.isMe && s.meTint]}>
      <View style={s.ledgerHead}>
        <Text style={[s.ledgerRank, rank === 1 && s.yellow]}>{rank ?? "·"}</Text>
        <Pressable onPress={m.openPlayer} disabled={!m.openPlayer}>
          <Avatar name={p.entry.displayName} imageUrl={m.avatarUrl} size="sm" />
        </Pressable>
        <View style={s.ledgerNameWrap}>
          <NameLink m={m} />
          {m.ago ? <Text style={s.meta}>{m.ago}</Text> : null}
        </View>
        <EditButton onEdit={p.onEdit} />
        {m.score ? <Text style={[s.ledgerScore, rank === 1 && s.yellow]}>{m.score}</Text> : null}
      </View>
      <ShareBlock m={m} entry={p.entry} style={s.ledgerShare} />
    </RowShell>
  );
}

// ── B · Arcade ────────────────────────────────────────────────────────────
// A cabinet high-score table: the left column is the standing ("1ST" over the
// score in pixel numerals), the right column is the player and what they
// pasted. Score-first, the way arcade boards read.
function ArcadeRow({ p, m }: { p: BoardRowProps; m: RowModel }) {
  const rank = p.entry.rank;
  return (
    <RowShell props={p} style={[s.arcade, p.isMe && s.meTint]}>
      <View style={s.arcadeLeft}>
        <Text style={[s.arcadeOrdinal, rank === 1 && s.yellow]}>
          {rank != null ? ordinal(rank) : "—"}
        </Text>
        {m.score ? (
          <Text style={[s.arcadeScore, rank === 1 && s.yellow]} numberOfLines={1}>
            {m.score}
          </Text>
        ) : null}
      </View>
      <View style={s.arcadeRight}>
        <View style={s.arcadeHead}>
          <Pressable onPress={m.openPlayer} disabled={!m.openPlayer}>
            <Avatar name={p.entry.displayName} imageUrl={m.avatarUrl} size="sm" />
          </Pressable>
          <NameLink m={m} />
          {m.ago ? <Text style={s.meta}>· {m.ago}</Text> : null}
          <View style={s.flex} />
          <EditButton onEdit={p.onEdit} />
        </View>
        <ShareBlock m={m} entry={p.entry} />
      </View>
    </RowShell>
  );
}

// ── C · Bezel ─────────────────────────────────────────────────────────────
// Each score is its own machine: a surface-1 panel with the 2px purple bezel.
// Header across the top (face, name, time · score), share text below. The
// leader's bezel is lit yellow; yours is pink.
function BezelRow({ p, m }: { p: BoardRowProps; m: RowModel }) {
  const rank = p.entry.rank;
  return (
    <RowShell props={p} style={[s.bezel, rank === 1 && s.bezelLeader, p.isMe && s.bezelMe]}>
      <View style={s.bezelHead}>
        <Text style={[s.bezelRank, rank === 1 && s.yellow]}>{rank ?? "·"}</Text>
        <Pressable onPress={m.openPlayer} disabled={!m.openPlayer}>
          <Avatar name={p.entry.displayName} imageUrl={m.avatarUrl} size="sm" />
        </Pressable>
        <View style={s.ledgerNameWrap}>
          <NameLink m={m} />
          {m.ago ? <Text style={s.meta}>{m.ago}</Text> : null}
        </View>
        <EditButton onEdit={p.onEdit} />
        {m.score ? (
          <View style={[s.bezelScore, rank === 1 && s.bezelScoreLeader]}>
            <Text style={[s.bezelScoreText, rank === 1 && s.yellow]}>{m.score}</Text>
          </View>
        ) : null}
      </View>
      <View style={s.bezelRule} />
      <ShareBlock m={m} entry={p.entry} />
    </RowShell>
  );
}

// ── D · Podium ────────────────────────────────────────────────────────────
// Rank carries the hierarchy. Top three get a large ordinal and score; the
// rest step down to a compact line. Same skeleton as Ledger, different weight
// per place, so the board reads as a standings, not a feed.
function PodiumRow({ p, m }: { p: BoardRowProps; m: RowModel }) {
  const rank = p.entry.rank;
  const top = rank != null && rank <= 3;
  return (
    <RowShell props={p} style={[s.podium, top && s.podiumTop, p.isMe && s.meTint]}>
      <View style={s.podiumHead}>
        <View style={s.podiumRankCol}>
          <Text style={[top ? s.podiumOrdinalTop : s.podiumOrdinal, rank === 1 && s.yellow]}>
            {rank != null ? ordinal(rank) : "·"}
          </Text>
        </View>
        <Pressable onPress={m.openPlayer} disabled={!m.openPlayer}>
          <Avatar name={p.entry.displayName} imageUrl={m.avatarUrl} size={top ? "md" : "sm"} />
        </Pressable>
        <View style={s.ledgerNameWrap}>
          <NameLink m={m} style={top ? s.nameTop : undefined} />
          {m.ago ? <Text style={s.meta}>{m.ago}</Text> : null}
        </View>
        <EditButton onEdit={p.onEdit} />
        {m.score ? (
          <Text style={[top ? s.podiumScoreTop : s.podiumScore, rank === 1 && s.yellow]}>
            {m.score}
          </Text>
        ) : null}
      </View>
      <ShareBlock m={m} entry={p.entry} style={s.podiumShare} />
    </RowShell>
  );
}

// ── E · Snippet ───────────────────────────────────────────────────────────
// The pasted text is the content, so frame it as a paste: a recessed
// surface-2 block with the score numeral docked in its top-right corner. The
// header above is just who and when. The eye gets one box per player.
function SnippetRow({ p, m }: { p: BoardRowProps; m: RowModel }) {
  const rank = p.entry.rank;
  return (
    <RowShell props={p} style={s.snippet}>
      <View style={s.snippetHead}>
        <Text style={[s.snippetRank, rank === 1 && s.yellow]}>{rank ?? "·"}</Text>
        <Pressable onPress={m.openPlayer} disabled={!m.openPlayer}>
          <Avatar name={p.entry.displayName} imageUrl={m.avatarUrl} size="sm" />
        </Pressable>
        <NameLink m={m} />
        {m.ago ? <Text style={s.meta}>· {m.ago}</Text> : null}
        <View style={s.flex} />
        <EditButton onEdit={p.onEdit} />
      </View>
      <View style={[s.snippetBlock, p.isMe && s.snippetBlockMe]}>
        <ShareBlock m={m} entry={p.entry} style={s.flex} />
        {m.score ? <Text style={[s.snippetScore, rank === 1 && s.yellow]}>{m.score}</Text> : null}
      </View>
    </RowShell>
  );
}

// ── Dev switcher ──────────────────────────────────────────────────────────
export function BoardRowVariantSwitcher({
  value,
  onChange,
}: {
  value: BoardRowChoice;
  onChange: (v: BoardRowChoice) => void;
}) {
  return (
    <View style={s.switcher} testID="board-row-variant-switcher">
      <Text style={s.switcherLabel}>ROWS</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => onChange("current")}
        testID="board-row-variant-current"
        style={[s.switcherChip, value === "current" && s.switcherChipActive]}
      >
        <Text style={[s.switcherChipText, value === "current" && s.switcherChipTextActive]}>
          Current
        </Text>
      </Pressable>
      {BOARD_ROW_VARIANTS.map((v, i) => {
        const active = v.key === value;
        return (
          <Pressable
            key={v.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(v.key)}
            testID={`board-row-variant-${v.key}`}
            style={[s.switcherChip, active && s.switcherChipActive]}
          >
            <Text style={[s.switcherChipText, active && s.switcherChipTextActive]}>
              {String.fromCharCode(65 + i)} {v.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const NAME_INDENT = 20 + tokens.space.sm + 24 + tokens.space.sm;

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  yellow: { color: tokens.neon.yellow },
  pressed: { opacity: 0.6 },
  underline: { textDecorationLine: "underline" },
  meTint: { backgroundColor: tokens.accent.muted },
  nameLink: { flexShrink: 1, minWidth: 0 },
  name: { ...bodyType("semibold"), fontSize: tokens.font.size.sm, color: tokens.text.primary },
  nameTop: { fontSize: tokens.font.size.md },
  meta: {
    ...bodyType(),
    fontSize: tokens.font.size.xs,
    color: tokens.text.secondary,
    flexShrink: 0,
  },
  shareBlock: { gap: 2 },
  share: { ...shareTextType(tokens.font.size.xs), color: tokens.text.secondary },
  shareMuted: { fontStyle: "italic" },
  pickedRow: { flexDirection: "row", alignItems: "baseline", gap: tokens.space.sm },
  editBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
  },
  editBtnHover: { backgroundColor: tokens.bg.elevated },

  // A · Ledger
  ledger: {
    gap: tokens.space.sm,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.sm,
    marginHorizontal: -tokens.space.sm,
    borderRadius: tokens.radius.sm,
  },
  ledgerHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  ledgerRank: { ...scoreType(10), width: 20, textAlign: "center", color: tokens.text.secondary },
  ledgerNameWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: tokens.space.sm,
  },
  ledgerScore: { ...scoreType(12), color: tokens.text.primary, letterSpacing: 1 },
  ledgerShare: { paddingLeft: NAME_INDENT },

  // B · Arcade
  arcade: {
    flexDirection: "row",
    gap: tokens.space.lg,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.sm,
    marginHorizontal: -tokens.space.sm,
    borderRadius: tokens.radius.sm,
  },
  arcadeLeft: { width: 76, alignItems: "flex-end", gap: 6, paddingTop: 2 },
  arcadeOrdinal: { ...scoreType(8), color: tokens.text.secondary, letterSpacing: 1 },
  arcadeScore: { ...scoreType(14), color: tokens.text.primary, letterSpacing: 1 },
  arcadeRight: { flex: 1, minWidth: 0, gap: tokens.space.sm },
  arcadeHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },

  // C · Bezel
  bezel: {
    backgroundColor: tokens.bg.surface,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.sm,
    padding: tokens.space.md,
    gap: tokens.space.sm,
    marginBottom: tokens.space.sm,
  },
  bezelLeader: { borderColor: tokens.neon.yellow },
  bezelMe: { borderColor: tokens.neon.pink },
  bezelHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  bezelRank: { ...scoreType(10), width: 16, textAlign: "center", color: tokens.text.secondary },
  bezelScore: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 4,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.elevated,
  },
  bezelScoreLeader: { backgroundColor: "rgba(255,233,61,0.10)" },
  bezelScoreText: { ...scoreType(11), lineHeight: 14, color: tokens.text.primary },
  bezelRule: { height: StyleSheet.hairlineWidth, backgroundColor: tokens.border.default },

  // D · Podium
  podium: {
    gap: tokens.space.xs,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
    marginHorizontal: -tokens.space.sm,
    borderRadius: tokens.radius.sm,
  },
  podiumTop: { paddingVertical: tokens.space.md, gap: tokens.space.sm },
  podiumHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  podiumRankCol: { width: 36, alignItems: "flex-start" },
  podiumOrdinal: { ...uiType(8), color: tokens.text.secondary },
  podiumOrdinalTop: { ...scoreType(10), color: tokens.text.secondary, letterSpacing: 1 },
  podiumScore: { ...scoreType(10), color: tokens.text.secondary },
  podiumScoreTop: { ...scoreType(16), color: tokens.text.primary, letterSpacing: 1 },
  podiumShare: { paddingLeft: 36 + tokens.space.sm },

  // E · Snippet
  snippet: { gap: tokens.space.sm, paddingVertical: tokens.space.md },
  snippetHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  snippetRank: { ...scoreType(10), width: 16, textAlign: "center", color: tokens.text.secondary },
  snippetBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.md,
    marginLeft: 16 + tokens.space.sm,
    paddingVertical: tokens.space.sm + 2,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.surface,
  },
  snippetBlockMe: { backgroundColor: tokens.accent.muted },
  snippetScore: { ...scoreType(12), color: tokens.text.primary, letterSpacing: 1 },

  // Switcher
  switcher: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.sm,
    borderTopWidth: tokens.bezel,
    borderBottomWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  switcherLabel: { ...uiType(8), color: tokens.text.secondary, marginRight: 4 },
  switcherChip: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 4,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  switcherChipActive: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  switcherChipText: {
    ...bodyType("semibold"),
    fontSize: tokens.font.size.xs,
    color: tokens.text.secondary,
  },
  switcherChipTextActive: { color: tokens.neon.pinkTint },
});
