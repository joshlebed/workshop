// Admin impersonation, lifted out of the old profile sheet onto the YOU screen.
//
// Hidden unless the server says the signed-in user is an admin (`user.isAdmin`);
// the backend enforces the same gate on both the target list and the
// impersonate endpoint, so the client check is presentation-only.

import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { fetchImpersonationTargets } from "../api/users";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../theme/Button";
import { PixelIcon } from "../theme/PixelIcon";
import { Text } from "../theme/Text";
import { useToast } from "../theme/Toast";
import { tokens } from "../theme/tokens";

export function AdminImpersonation({ onSessionChanged }: { onSessionChanged: () => void }) {
  const { user, token, impersonation, impersonateUser, stopImpersonating } = useAuth();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const targetsQuery = useQuery({
    queryKey: queryKeys.users.impersonationTargets,
    queryFn: () => fetchImpersonationTargets(token),
    enabled: Boolean(user?.isAdmin && editing && token && !impersonation),
    staleTime: 60_000,
  });

  const labelFor = (u: { displayName: string | null; email: string | null }) =>
    u.displayName?.trim() || u.email || "user";

  const targets = targetsQuery.data?.users ?? [];
  const selectedTarget = targets.find((u) => u.email === target) ?? null;
  const loadingTargets = targetsQuery.isLoading || (targetsQuery.isFetching && !targetsQuery.data);
  const selectDisabled = busy || loadingTargets || targetsQuery.isError || targets.length === 0;

  const onImpersonate = async () => {
    const trimmed = target.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const nextUser = await impersonateUser(trimmed);
      showToast({ message: `Signed in as ${labelFor(nextUser)}`, tone: "success" });
      setEditing(false);
      setTarget("");
      setDropdownOpen(false);
      onSessionChanged();
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't impersonate that user."), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

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

  if (impersonation) {
    const adminLabel =
      impersonation.adminDisplayName?.trim() || impersonation.adminEmail || "Admin";
    return (
      <View style={styles.form} testID="admin-impersonation-status">
        <Text variant="caption" tone="secondary">
          {`Impersonating. Started by ${adminLabel}.`}
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

  if (!user?.isAdmin) return null;

  if (!editing) {
    return (
      <Button
        label="Admin: impersonate"
        variant="secondary"
        onPress={() => setEditing(true)}
        testID="open-admin-impersonation"
      />
    );
  }

  return (
    <View style={styles.form} testID="admin-impersonation-form">
      <Pressable
        testID="admin-impersonation-select"
        accessibilityRole="button"
        accessibilityLabel="User to impersonate"
        accessibilityState={{ disabled: selectDisabled, expanded: dropdownOpen }}
        onPress={selectDisabled ? undefined : () => setDropdownOpen((o) => !o)}
        style={({ pressed }) => [
          styles.select,
          pressed && !selectDisabled ? styles.selectPressed : null,
          selectDisabled ? styles.selectDisabled : null,
        ]}
      >
        <Text variant="label" numberOfLines={1} style={styles.selectText}>
          {selectedTarget?.email ??
            (loadingTargets
              ? "Loading users..."
              : targetsQuery.isError
                ? "Couldn't load users"
                : targets.length === 0
                  ? "No users with email"
                  : "Select a user")}
        </Text>
        <PixelIcon
          name={dropdownOpen ? "chevron-up" : "chevron-down"}
          size={16}
          color={tokens.text.secondary}
        />
      </Pressable>
      {dropdownOpen && !selectDisabled ? (
        <ScrollView
          style={styles.optionList}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {targets.map((targetUser) => {
            const selected = targetUser.email === target;
            const displayName = targetUser.displayName?.trim();
            return (
              <Pressable
                key={targetUser.id}
                testID={`admin-impersonation-option-${targetUser.email}`}
                accessibilityRole="button"
                accessibilityLabel={`Impersonate ${targetUser.email}`}
                accessibilityState={{ selected }}
                onPress={() => {
                  setTarget(targetUser.email);
                  setDropdownOpen(false);
                }}
                style={({ pressed }) => [
                  styles.option,
                  selected ? styles.optionSelected : null,
                  pressed ? styles.optionPressed : null,
                ]}
              >
                <Text variant="label" numberOfLines={1} style={styles.optionEmail}>
                  {targetUser.email}
                </Text>
                {displayName ? (
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {displayName}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {targetsQuery.isError ? (
        <View style={styles.retryRow}>
          <Text variant="caption" tone="secondary" style={styles.retryText}>
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
      <View style={styles.actions}>
        <Button
          label="Sign in"
          disabled={!target.trim() || busy}
          loading={busy}
          onPress={onImpersonate}
          testID="admin-impersonation-submit"
        />
        <Button
          label="Cancel"
          variant="ghost"
          disabled={busy}
          onPress={() => {
            setEditing(false);
            setTarget("");
            setDropdownOpen(false);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: tokens.space.sm },
  select: {
    minHeight: 44,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    backgroundColor: tokens.bg.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  selectPressed: { backgroundColor: tokens.bg.raised },
  selectDisabled: { opacity: 0.6 },
  selectText: { flex: 1, minWidth: 0, color: tokens.text.primary },
  optionList: {
    maxHeight: 220,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  option: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    gap: tokens.space.xs,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  optionPressed: { backgroundColor: tokens.bg.raised },
  optionSelected: { backgroundColor: tokens.accent.muted },
  optionEmail: { color: tokens.text.primary },
  retryRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm, flexWrap: "wrap" },
  retryText: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", gap: tokens.space.md },
});
