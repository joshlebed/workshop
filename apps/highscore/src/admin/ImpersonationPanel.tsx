// Admin impersonation, in two pieces: `ImpersonationStatus` (the "you are
// impersonating X · Stop" strip, shown wherever the session menu is) and
// `ImpersonationPanel` (the dashboard's Tools tab: a searchable user list with
// a one-tap Sign in per row). Hidden unless the server says the signed-in user
// is an admin; the backend enforces the same gate on both the target list and
// the impersonate endpoint, so the client check is presentation-only.

import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { ImpersonationTargetUser } from "@workshop/shared";
import { Avatar, Button, Card, Text, tokens, useToast } from "@workshop/ui";
import { useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { fetchImpersonationTargets } from "../api/users";
import { useAuth } from "../hooks/useAuth";

function labelFor(u: { displayName: string | null; email: string | null }): string {
  return u.displayName?.trim() || u.email || "user";
}

/** Shown while an impersonation session is active (any surface). */
export function ImpersonationStatus({ onSessionChanged }: { onSessionChanged: () => void }) {
  const { impersonation, stopImpersonating } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!impersonation) return null;
  const adminLabel = impersonation.adminDisplayName?.trim() || impersonation.adminEmail || "Admin";

  const onStop = async () => {
    setBusy(true);
    try {
      await stopImpersonating();
      showToast({ message: "Back to your account", tone: "success" });
      onSessionChanged();
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't stop impersonating."), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.status} testID="admin-impersonation-status">
      <Text variant="caption" tone="muted" style={styles.note}>
        Impersonating. Started by {adminLabel}.
      </Text>
      <Button
        label="Stop impersonating"
        variant="secondary"
        loading={busy}
        onPress={onStop}
        testID="stop-impersonating"
      />
    </View>
  );
}

interface PanelProps {
  onSessionChanged: () => void;
  /** Pre-fill the search (e.g. from the users web's "Impersonate" action). */
  initialQuery?: string;
}

export function ImpersonationPanel({ onSessionChanged, initialQuery = "" }: PanelProps) {
  const { user, token, impersonation, impersonateUser } = useAuth();
  const { showToast } = useToast();
  const [query, setQuery] = useState(initialQuery);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  const targetsQuery = useQuery({
    queryKey: queryKeys.users.impersonationTargets,
    queryFn: () => fetchImpersonationTargets(token),
    enabled: Boolean(user?.isAdmin && token && !impersonation),
    staleTime: 60_000,
  });

  const targets = useMemo(() => {
    const all = targetsQuery.data?.users ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (u) =>
            u.email.toLowerCase().includes(q) || (u.displayName ?? "").toLowerCase().includes(q),
        )
      : all;
    return [...filtered].sort((a, b) => labelFor(a).localeCompare(labelFor(b)));
  }, [targetsQuery.data, query]);

  const onImpersonate = async (target: ImpersonationTargetUser) => {
    setBusyEmail(target.email);
    try {
      const nextUser = await impersonateUser(target.email);
      showToast({ message: `Signed in as ${labelFor(nextUser)}`, tone: "success" });
      onSessionChanged();
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't impersonate that user."), tone: "danger" });
    } finally {
      setBusyEmail(null);
    }
  };

  if (impersonation) {
    return (
      <Card>
        <ImpersonationStatus onSessionChanged={onSessionChanged} />
      </Card>
    );
  }

  return (
    <Card style={styles.panel} testID="admin-impersonation-form">
      <View style={styles.headerRow}>
        <Text variant="label">Impersonate a user</Text>
        <Text variant="caption" tone="muted">
          Signs you in as them until you stop. Every request is audited.
        </Text>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name or email"
        placeholderTextColor={tokens.text.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        testID="admin-impersonation-search"
      />
      {targetsQuery.isError ? (
        <View style={styles.retryRow}>
          <Text variant="caption" tone="muted" style={styles.retryText}>
            User emails could not be loaded.
          </Text>
          <Button
            label="Retry"
            variant="secondary"
            disabled={targetsQuery.isFetching}
            loading={targetsQuery.isFetching}
            onPress={() => targetsQuery.refetch()}
          />
        </View>
      ) : null}
      {targetsQuery.isLoading ? (
        <Text variant="caption" tone="muted">
          Loading users…
        </Text>
      ) : null}
      {targetsQuery.data && targets.length === 0 ? (
        <Text variant="caption" tone="muted">
          No users match.
        </Text>
      ) : null}
      <View style={styles.list}>
        {targets.slice(0, 60).map((t) => (
          <View key={t.id} style={styles.row} testID={`admin-impersonation-option-${t.email}`}>
            <Avatar name={labelFor(t)} size="sm" />
            <View style={styles.rowText}>
              <Text numberOfLines={1}>{labelFor(t)}</Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {t.email}
              </Text>
            </View>
            <Button
              label="Sign in"
              variant="secondary"
              loading={busyEmail === t.email}
              disabled={busyEmail !== null}
              onPress={() => void onImpersonate(t)}
              testID={`admin-impersonation-submit-${t.email}`}
            />
          </View>
        ))}
        {targets.length > 60 ? (
          <Text variant="caption" tone="muted">
            Showing the first 60 — narrow the search.
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { gap: tokens.space.md },
  headerRow: { gap: 2 },
  status: { gap: tokens.space.sm },
  note: { paddingHorizontal: tokens.space.xs },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    backgroundColor: tokens.bg.surface,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
  },
  retryRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm, flexWrap: "wrap" },
  retryText: { flex: 1, minWidth: 160 },
  list: { gap: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
  },
  rowText: { flex: 1, minWidth: 0 },
});
