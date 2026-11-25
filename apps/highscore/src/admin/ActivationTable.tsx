// The "2-3-1" activation cohorts and the push-permission funnel on the admin
// Overview tab. Plain views in a horizontal scroll view so a phone can pan the
// columns; the numbers come from `activation` / `pushFunnel` on
// `GET /v1/admin/analytics?client=highscore` (see `lib/adminActivation.ts`).

import type { AdminActivationCohorts, AdminActivationRow, AdminPushFunnel } from "@workshop/shared";
import { PUSH_PROMPT_STAGES } from "@workshop/shared/constants";
import { ScrollView, StyleSheet, View } from "react-native";
import { Card, Text, tokens } from "../theme";
import {
  ACTIVATION_COLUMNS,
  formatActivationCell,
  funnelCounts,
  PUSH_STAGE_LABELS,
} from "./activation";

const LABEL_WIDTH = 168;
const NUM_WIDTH = 100;

function HeaderRow({ first, columns }: { first: string; columns: readonly string[] }) {
  return (
    <View style={[styles.row, styles.headerRow]}>
      <Text variant="overline" tone="muted" style={styles.labelCell}>
        {first}
      </Text>
      {columns.map((c) => (
        <Text key={c} variant="overline" tone="muted" style={styles.numCell}>
          {c}
        </Text>
      ))}
    </View>
  );
}

function CohortRow({ row }: { row: AdminActivationRow }) {
  return (
    <View style={styles.row} testID={`activation-row-${row.key}`}>
      <Text variant="label" style={styles.labelCell} numberOfLines={2}>
        {row.label}
      </Text>
      <Text variant="label" style={styles.numCell}>
        {row.signups}
      </Text>
      {ACTIVATION_COLUMNS.map((col) => {
        const f = formatActivationCell(row[col.key]);
        const highlight = col.key === "all";
        return (
          <View key={col.key} style={[styles.numCell, highlight && styles.highlight]}>
            <Text variant="label" tone={highlight && f.ratio ? "spotlight" : "primary"}>
              {f.pct}
            </Text>
            {f.ratio ? (
              <Text variant="caption" tone="muted">
                {f.ratio}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function CohortTable({ rows, first }: { rows: AdminActivationRow[]; first: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <HeaderRow first={first} columns={["Signups", ...ACTIVATION_COLUMNS.map((c) => c.label)]} />
        {rows.map((r) => (
          <CohortRow key={r.key} row={r} />
        ))}
      </View>
    </ScrollView>
  );
}

export function ActivationTable({ activation }: { activation: AdminActivationCohorts }) {
  return (
    <Card style={styles.card} testID="activation-cohorts">
      <Text variant="label">{activation.label}</Text>
      <CohortTable rows={activation.weeks} first="Signup week" />
      {activation.bySource.length > 0 ? (
        <View style={styles.section} testID="activation-by-source">
          <Text variant="label">Same weeks, by signup source</Text>
          <CohortTable rows={activation.bySource} first="Signup source" />
        </View>
      ) : null}
      <Text variant="caption" tone="muted">
        {activation.description}
      </Text>
    </Card>
  );
}

export function PushFunnelTable({ funnel }: { funnel: AdminPushFunnel }) {
  return (
    <Card style={styles.card} testID="push-funnel">
      <Text variant="label">{funnel.label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeaderRow
            first="Trigger"
            columns={PUSH_PROMPT_STAGES.map((s) => PUSH_STAGE_LABELS[s])}
          />
          {funnel.rows.map((row) => (
            <View key={row.trigger} style={styles.row} testID={`push-funnel-${row.trigger}`}>
              <Text variant="label" style={styles.labelCell}>
                {row.label}
              </Text>
              {funnelCounts(row).map(({ stage, value }) => (
                <Text
                  key={stage}
                  variant="label"
                  tone={value > 0 ? "primary" : "muted"}
                  style={styles.numCell}
                >
                  {value}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <Text variant="caption" tone="muted">
        {funnel.description}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: tokens.space.sm },
  section: { gap: tokens.space.sm, marginTop: tokens.space.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: tokens.space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
  },
  headerRow: { alignItems: "flex-end" },
  labelCell: { width: LABEL_WIDTH, paddingRight: tokens.space.sm },
  numCell: { width: NUM_WIDTH, paddingHorizontal: tokens.space.xs },
  highlight: { backgroundColor: tokens.bg.elevated, borderRadius: tokens.radius.sm },
});
