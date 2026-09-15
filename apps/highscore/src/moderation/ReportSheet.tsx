// Report sheet (App Store Review Guideline 1.2 — "a mechanism for users to
// flag objectionable content"). One sheet for both report shapes: a profile
// (name / photo, from the friend profile page) or a single score post (from
// the reaction picker on a leaderboard row). The reporter picks a reason,
// optionally adds a note, and the backend pings the operator, who acts within
// 24 hours (docs/moderation-runbook.md).

import { useMutation } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import type { ReportReason } from "@workshop/shared/moderation";
import { Button, Chip, Sheet, Text, tokens, useToast } from "@workshop/ui";
import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { createReport } from "../api/moderation";

export interface ReportTarget {
  userId: string;
  name: string | null;
  kind: "profile" | "score";
  /** Required for `kind === "score"`. */
  gameId?: string;
  periodKey?: string;
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "abusive", label: "Harassment or abuse" },
  { value: "offensive", label: "Offensive or hateful" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
];

export const REPORT_RECEIVED_MESSAGE = "Thanks — we'll review this within 24 hours.";

interface ReportSheetProps {
  target: ReportTarget | null;
  token: string | null;
  onClose: () => void;
  onClosed?: () => void;
}

export function ReportSheet({ target, token, onClose, onClosed }: ReportSheetProps) {
  const { showToast } = useToast();
  const [snapshot, setSnapshot] = useState<ReportTarget | null>(target);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");

  useEffect(() => {
    if (target) {
      setSnapshot(target);
      setReason(null);
      setDetails("");
    }
  }, [target]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!snapshot || !reason) throw new Error("pick a reason");
      const trimmed = details.trim();
      return createReport(
        {
          targetUserId: snapshot.userId,
          contentKind: snapshot.kind,
          reason,
          ...(trimmed ? { details: trimmed } : {}),
          ...(snapshot.kind === "score"
            ? { gameId: snapshot.gameId, periodKey: snapshot.periodKey }
            : {}),
        },
        token,
      );
    },
    onSuccess: () => {
      showToast({ message: REPORT_RECEIVED_MESSAGE, tone: "success" });
      onClose();
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't send that report."), tone: "danger" });
    },
  });

  const name = snapshot?.name?.trim() || "this user";
  const title = snapshot?.kind === "score" ? `Report ${name}'s score` : `Report ${name}`;

  return (
    <Sheet
      visible={!!target}
      onRequestClose={onClose}
      onClosed={() => {
        setSnapshot(null);
        onClosed?.();
      }}
      testID="report-sheet"
    >
      {snapshot ? (
        <View style={styles.content}>
          <View style={styles.header}>
            <Text variant="heading" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" tone="muted">
              {snapshot.kind === "score"
                ? "Tell us what's wrong with this post. Reports are reviewed by a person within 24 hours."
                : "Tell us what's wrong with this name or photo. Reports are reviewed by a person within 24 hours."}
            </Text>
          </View>
          <View style={styles.reasons}>
            {REASONS.map((r) => (
              <Chip
                key={r.value}
                label={r.label}
                selected={reason === r.value}
                onPress={() => setReason(r.value)}
                testID={`report-reason-${r.value}`}
              />
            ))}
          </View>
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Anything else? (optional)"
            placeholderTextColor={tokens.text.muted}
            multiline
            maxLength={500}
            style={styles.input}
            testID="report-details"
          />
          <View style={styles.actions}>
            <Button
              label="Cancel"
              variant="ghost"
              onPress={onClose}
              disabled={mutation.isPending}
            />
            <Button
              label="Send report"
              variant="danger"
              disabled={!reason || mutation.isPending}
              loading={mutation.isPending}
              onPress={() => mutation.mutate()}
              testID="report-submit"
            />
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: tokens.space.md },
  header: { gap: 4 },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.canvas,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: tokens.space.sm },
});
