// The App Store update nudge, operator side (dashboard Tools tab). This form
// is THE ONLY way the nudge values change: the operator types them, types
// NUDGE to confirm, and saves (`PUT /v1/admin/client-release`, real-admin
// gate). No agent, automation, CI job, or script may set them — see
// docs/release-nudge-runbook.md.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { AdminClientReleaseResponse } from "@workshop/shared";
import { CLIENT_RELEASE_VERSION_PATTERN } from "@workshop/shared/constants";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { fetchAdminClientRelease, saveAdminClientRelease } from "../api/release";
import { useAuth } from "../hooks/useAuth";
import { compareReleaseVersions } from "../lib/appRelease";
import { Button, bodyType, Card, Text, tokens, useToast } from "../theme";

const PLATFORM = "ios" as const;
const CONFIRM_WORD = "NUDGE";

export function ReleaseNudgePanel() {
  const { user, token } = useAuth();
  const query = useQuery({
    queryKey: queryKeys.admin.clientRelease("highscore", PLATFORM),
    queryFn: () => fetchAdminClientRelease(token, PLATFORM),
    enabled: Boolean(user?.isAdmin && token),
  });

  return (
    <Card style={styles.panel} testID="admin-release-nudge">
      <View style={styles.headerRow}>
        <Text variant="label">App Store update nudge (iOS)</Text>
        <Text variant="caption" tone="muted">
          Below Minimum: a blocking “Update required” screen. Below Latest: a dismissible Games-home
          banner. Empty = off. Operator only — nothing else may change these.
        </Text>
      </View>
      {query.isLoading ? (
        <Text variant="caption" tone="muted">
          Loading…
        </Text>
      ) : query.isError ? (
        <View style={styles.row}>
          <Text variant="caption" tone="muted" style={styles.flex}>
            {errorMessage(query.error, "Couldn't load the current values.")}
          </Text>
          <Button label="Retry" variant="secondary" onPress={() => query.refetch()} />
        </View>
      ) : query.data ? (
        // Re-key on save so the draft resets to what the server stored.
        <ReleaseNudgeForm key={query.data.updatedAt ?? "unset"} current={query.data} />
      ) : null}
    </Card>
  );
}

function ReleaseNudgeForm({ current }: { current: AdminClientReleaseResponse }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [latest, setLatest] = useState(current.latestVersion ?? "");
  const [minimum, setMinimum] = useState(current.minimumVersion ?? "");
  const [storeUrl, setStoreUrl] = useState(current.storeUrl ?? "");
  const [message, setMessage] = useState(current.message ?? "");
  const [confirmText, setConfirmText] = useState("");

  const problem = validationProblem(latest.trim(), minimum.trim());
  const confirmed = confirmText.trim() === CONFIRM_WORD;

  const save = useMutation({
    mutationFn: () =>
      saveAdminClientRelease(token, {
        client: "highscore",
        platform: PLATFORM,
        latestVersion: latest.trim() || null,
        minimumVersion: minimum.trim() || null,
        storeUrl: storeUrl.trim() || null,
        message: message.trim() || null,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.admin.clientRelease("highscore", PLATFORM), saved);
      void queryClient.invalidateQueries({ queryKey: ["client", "release"] });
      showToast({ message: "Update nudge saved", tone: "success" });
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't save the nudge."), tone: "danger" }),
  });

  return (
    <View style={styles.form}>
      <Field
        label="Latest version"
        value={latest}
        onChange={setLatest}
        placeholder="e.g. 1.1.0"
        testID="release-latest"
      />
      <Field
        label="Minimum version"
        value={minimum}
        onChange={setMinimum}
        placeholder="e.g. 1.0.1"
        testID="release-minimum"
      />
      <Field
        label="Store URL (optional)"
        value={storeUrl}
        onChange={setStoreUrl}
        placeholder="Defaults to the HighScore App Store page"
        testID="release-store-url"
      />
      <Field
        label="Message (optional)"
        value={message}
        onChange={setMessage}
        placeholder="Shown under the headline"
        testID="release-message"
      />
      {problem ? (
        <Text variant="caption" style={{ color: tokens.status.danger }} testID="release-problem">
          {problem}
        </Text>
      ) : null}
      <Field
        label={`Type ${CONFIRM_WORD} to enable Save`}
        value={confirmText}
        onChange={setConfirmText}
        placeholder={CONFIRM_WORD}
        autoCapitalize="characters"
        testID="release-confirm"
      />
      <Button
        label="Save"
        disabled={!confirmed || problem !== null || save.isPending}
        loading={save.isPending}
        onPress={() => save.mutate()}
        testID="release-save"
      />
      <Text variant="caption" tone="muted" testID="release-updated">
        {current.updatedAt
          ? `Updated by ${current.updatedBy?.displayName ?? current.updatedBy?.id ?? "unknown"} at ${new Date(current.updatedAt).toLocaleString()}`
          : "Never set — no nudge is showing."}
      </Text>
    </View>
  );
}

function validationProblem(latest: string, minimum: string): string | null {
  if (latest && !CLIENT_RELEASE_VERSION_PATTERN.test(latest)) return "Latest must look like 1.2.3.";
  if (minimum && !CLIENT_RELEASE_VERSION_PATTERN.test(minimum))
    return "Minimum must look like 1.2.3.";
  if (latest && minimum && (compareReleaseVersions(minimum, latest) ?? 0) > 0) {
    return "Minimum must be at or below Latest.";
  }
  return null;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  testID,
  autoCapitalize = "none",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testID: string;
  autoCapitalize?: "none" | "characters";
}) {
  return (
    <View style={styles.field}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={tokens.text.secondary}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={styles.input}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: tokens.space.md },
  headerRow: { gap: 2 },
  form: { gap: tokens.space.sm },
  field: { gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  flex: { flex: 1 },
  input: {
    ...bodyType(),
    minHeight: 44,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.sm,
    paddingHorizontal: tokens.space.md,
    backgroundColor: tokens.bg.elevated,
    color: tokens.text.primary,
    // ≥16px: iOS Safari zooms on smaller focused inputs (root CLAUDE.md).
    fontSize: tokens.font.size.md,
  },
});
