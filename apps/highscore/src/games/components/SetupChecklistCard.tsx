// The day-1 "Get set up" card at the top of the Games home (onboarding spike
// 6). Draws what `useSetupChecklist` decides (rules: src/lib/setupChecklist.ts)
// and hands each row's tap to the surface that finishes it — the card itself
// never opens a Sheet on its own, so it can't stack on the share-setup
// walkthrough's auto-open or the reminder pre-prompt (root CLAUDE.md, Sheet
// rules). The one Sheet a row can open (the paste sheet, "Post your first
// score") opens on a tap.

import type { SetupChecklistRowId } from "@workshop/shared/constants";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { SetupCardState, SetupRow, TodayBoardLine } from "../../lib/setupChecklist";
import { Button, IconButton, PixelIcon, Text, tokens } from "../../theme";

export interface SetupChecklistCardProps {
  state: SetupCardState;
  /** Today's board for "You're set". */
  board: TodayBoardLine[];
  /** The row whose action is in flight (invite link being minted). */
  pendingRow: SetupChecklistRowId | null;
  onRow: (row: SetupChecklistRowId) => void;
  onOpenGame: (gameId: string) => void;
  onDismiss: () => void;
  onAcknowledge: () => void;
}

export function SetupChecklistCard({
  state,
  board,
  pendingRow,
  onRow,
  onOpenGame,
  onDismiss,
  onAcknowledge,
}: SetupChecklistCardProps) {
  if (state.kind === "hidden") return null;

  if (state.kind === "celebrate") {
    return (
      <View style={[styles.card, styles.cardDone]} testID="setup-checklist-done">
        <View style={styles.header}>
          <Text variant="overline" style={styles.doneOverline}>
            You&apos;re set
          </Text>
          <Segments rows={state.rows} />
        </View>
        <Text tone="secondary" variant="caption">
          Friends, games and your first score: that&apos;s the whole loop. Here&apos;s today.
        </Text>
        <View style={styles.board}>
          {board.map((line) => (
            <Pressable
              key={line.gameId}
              accessibilityRole="button"
              onPress={() => onOpenGame(line.gameId)}
              style={({ pressed }) => [styles.boardRow, pressed && styles.rowPressed]}
              testID={`setup-checklist-board-${line.gameId}`}
            >
              <Text variant="game" numberOfLines={1} style={styles.boardTitle}>
                {line.title}
              </Text>
              <Text variant="caption" tone={line.played ? "primary" : "secondary"}>
                {line.status}
              </Text>
            </Pressable>
          ))}
        </View>
        <Button
          label="Got it"
          variant="secondary"
          onPress={onAcknowledge}
          testID="setup-checklist-ack"
        />
      </View>
    );
  }

  const { rows, doneCount, total } = state;
  return (
    <View style={styles.card} testID="setup-checklist" accessibilityRole="summary">
      <View style={styles.header}>
        <Text variant="overline">Get set up</Text>
        <Text variant="caption" tone="secondary" testID="setup-checklist-count">
          {doneCount} of {total}
        </Text>
        <Segments rows={rows} />
        <IconButton
          accessibilityLabel="Dismiss Get set up"
          onPress={onDismiss}
          testID="setup-checklist-dismiss"
        >
          <PixelIcon name="close" size={16} color={tokens.text.secondary} />
        </IconButton>
      </View>
      {rows.map((row) => (
        <ChecklistRow
          key={row.id}
          row={row}
          pending={pendingRow === row.id}
          onPress={() => onRow(row.id)}
        />
      ))}
    </View>
  );
}

function Segments({ rows }: { rows: SetupRow[] }) {
  return (
    <View style={styles.segments} accessibilityElementsHidden importantForAccessibility="no">
      {rows.map((r) => (
        <View key={r.id} style={[styles.segment, r.done && styles.segmentDone]} />
      ))}
    </View>
  );
}

function ChecklistRow({
  row,
  pending,
  onPress,
}: {
  row: SetupRow;
  pending: boolean;
  onPress: () => void;
}) {
  const label = row.progress ? `${row.label}, ${row.progress}` : row.label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.done ? `${label}, done` : label}
      accessibilityState={{ disabled: row.done }}
      aria-disabled={row.done}
      disabled={row.done || pending}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`setup-checklist-row-${row.id}`}
    >
      <View style={[styles.mark, row.done && styles.markDone, row.next && styles.markNext]}>
        {row.done ? <PixelIcon name="check" size={16} color={tokens.bg.canvas} /> : null}
      </View>
      <View style={styles.rowCopy}>
        <Text variant={row.next ? "label" : "body"} tone={row.done ? "secondary" : "primary"}>
          {row.label}
        </Text>
        {row.next ? (
          <Text variant="caption" tone="secondary">
            {row.hint}
          </Text>
        ) : null}
      </View>
      {row.progress ? (
        <Text variant="caption" tone={row.done ? "secondary" : "primary"}>
          {row.progress}
        </Text>
      ) : null}
      {row.done ? null : pending ? (
        <ActivityIndicator size="small" color={tokens.accent.default} />
      ) : (
        <PixelIcon
          name="chevron-right"
          size={16}
          color={row.next ? tokens.accent.default : tokens.text.secondary}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: tokens.space.lg,
    marginBottom: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xs,
    borderWidth: tokens.bezel,
    borderColor: tokens.accent.default,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  cardDone: {
    borderColor: tokens.neon.chartreuse,
    gap: tokens.space.sm,
    paddingBottom: tokens.space.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 32,
  },
  doneOverline: { color: tokens.neon.chartreuse },
  segments: { flex: 1, flexDirection: "row", gap: 3, justifyContent: "flex-end" },
  segment: {
    width: 14,
    height: 6,
    backgroundColor: tokens.bg.raised,
  },
  segmentDone: { backgroundColor: tokens.neon.chartreuse },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 40,
    paddingVertical: tokens.space.xs,
    borderTopWidth: 1,
    borderTopColor: tokens.border.subtle,
  },
  rowPressed: { backgroundColor: tokens.bg.elevated },
  rowCopy: { flex: 1, minWidth: 0 },
  mark: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  markNext: { borderColor: tokens.accent.default },
  markDone: { borderColor: tokens.neon.chartreuse, backgroundColor: tokens.neon.chartreuse },
  board: { gap: 0 },
  boardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.sm,
    minHeight: 36,
    borderTopWidth: 1,
    borderTopColor: tokens.border.subtle,
  },
  boardTitle: { flexShrink: 1, fontSize: 10 },
});
