// PROTOTYPE — the paste sheet's "Summary preview" card for a game with no
// formatter: how this share (and the player's last two) would read on the
// board, with "Looks good" to store the formatter and "Show raw" to keep the
// full text. Presentational; the data comes from `useFormatterPreview` and
// the writes from the sheet.

import { Button, Chip, Text, tokens } from "@workshop/ui";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import type {
  FormatterCandidateKind,
  FormatterCardView,
  FormatterOption,
} from "../lib/formatterPreview";

export type FormatterCardStatus = "idle" | "saving" | "saved" | "rejected" | "error";

function sampleLabel(periodKey: string | null): string {
  if (periodKey === null) return "This paste";
  const [y, m, d] = periodKey.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function lineCount(text: string | null): number {
  return text ? text.split("\n").length : 0;
}

export function FormatterPreviewCard({
  view,
  status,
  onApprove,
  onReject,
  testID = "formatter-preview",
}: {
  view: FormatterCardView;
  status: FormatterCardStatus;
  onApprove: (option: FormatterOption) => void;
  onReject: (shown: FormatterCandidateKind[]) => void;
  testID?: string;
}) {
  const [selected, setSelected] = useState<FormatterCandidateKind>("heuristic");
  const options = view.kind === "ready" ? view.options : [];
  // Keep the selection on an option that exists (the model's may arrive later, or never).
  useEffect(() => {
    if (options.length > 0 && !options.some((o) => o.kind === selected)) {
      setSelected(options[0]?.kind ?? "heuristic");
    }
  }, [options, selected]);

  if (status === "saved") {
    return (
      <View style={styles.done} testID={`${testID}-saved`}>
        <Text variant="caption">
          ✓ Saved. This post and every new one for this game shows the summary.
        </Text>
      </View>
    );
  }
  if (status === "rejected") {
    return (
      <View style={styles.done} testID={`${testID}-rejected`}>
        <Text variant="caption" tone="muted">
          Okay — rows for this game keep showing the full share.
        </Text>
      </View>
    );
  }
  if (view.kind === "hidden") return null;
  if (view.kind === "loading") {
    return (
      <View style={styles.card} testID={`${testID}-loading`}>
        <View style={styles.row}>
          <ActivityIndicator size="small" color={tokens.text.muted} />
          <Text variant="caption" tone="muted">
            Building a summary preview…
          </Text>
        </View>
      </View>
    );
  }

  const option = options.find((o) => o.kind === selected) ?? options[0];
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.header}>
        <Text variant="label">Summary preview</Text>
        {options.length > 1 || view.suggesting ? (
          <View style={styles.chips}>
            {options.map((o) => (
              <Chip
                key={o.kind}
                label={o.label}
                selected={o.kind === option?.kind}
                onPress={() => setSelected(o.kind)}
                testID={`${testID}-option-${o.kind}`}
              />
            ))}
            {view.suggesting ? (
              <View style={styles.row} testID={`${testID}-suggesting`}>
                <ActivityIndicator size="small" color={tokens.text.muted} />
                <Text variant="caption" tone="muted">
                  AI…
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      <Text variant="caption" tone="muted">
        This game has no summary yet, so friends see the whole share. It could look like this:
      </Text>
      {option ? (
        <View style={styles.samples}>
          {view.samples.map((sample, i) => {
            const summary = option.summaries[i] ?? null;
            return (
              <View key={`${sample.periodKey ?? "now"}`} style={styles.sample}>
                <Text variant="caption" tone="muted">
                  {sampleLabel(sample.periodKey)}
                  {summary
                    ? ` · ${lineCount(summary)} of ${lineCount(sample.fallback)} lines`
                    : " · no summary, full text"}
                </Text>
                <Text
                  style={[styles.summary, !summary && styles.summaryMissing]}
                  testID={`${testID}-summary-${i}`}
                >
                  {summary ?? sample.fallback ?? ""}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {status === "error" ? (
        <Text variant="caption" tone="danger" testID={`${testID}-error`}>
          Couldn't save that one. Try again, or keep the full text.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          label="Show raw"
          variant="ghost"
          onPress={() => onReject(options.map((o) => o.kind))}
          disabled={status === "saving"}
          testID={`${testID}-reject`}
        />
        <Button
          label="Looks good"
          variant="secondary"
          onPress={() => option && onApprove(option)}
          disabled={!option || status === "saving"}
          loading={status === "saving"}
          testID={`${testID}-approve`}
        />
      </View>
    </View>
  );
}

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

const styles = StyleSheet.create({
  card: {
    gap: tokens.space.sm,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  done: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: tokens.space.sm,
  },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  chips: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: tokens.space.sm },
  samples: { gap: tokens.space.sm },
  sample: {
    gap: 2,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.canvas,
  },
  summary: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 6,
    fontFamily: MONO,
  },
  summaryMissing: { color: tokens.text.muted },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.md,
  },
});
