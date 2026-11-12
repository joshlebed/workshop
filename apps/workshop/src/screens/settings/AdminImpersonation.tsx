import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { Button, Icon, ListRow, Text, tokens, useToast } from "@workshop/ui";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { fetchImpersonationTargets } from "../../api/users";
import { useAuth } from "../../hooks/useAuth";

/**
 * Admin impersonation, moved from the old profile sheet into Settings → Admin
 * (3.5). While impersonating it shows "Stop impersonating" for everyone (the
 * impersonated session is not an admin), exactly as the sheet did.
 */
export function AdminImpersonationRow({ onSessionChanged }: { onSessionChanged: () => void }) {
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
      <View style={accountActionStyles.form} testID="admin-impersonation-status">
        <Text variant="caption" tone="muted" style={accountActionStyles.note}>
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

  if (!user?.isAdmin) return null;

  if (!editing) {
    return (
      <ListRow
        title="Impersonate a user"
        subtitle="See the app as someone else"
        onPress={() => setEditing(true)}
        testID="open-admin-impersonation"
      />
    );
  }

  return (
    <View style={accountActionStyles.form} testID="admin-impersonation-form">
      <Pressable
        testID="admin-impersonation-select"
        accessibilityRole="button"
        accessibilityLabel="User to impersonate"
        accessibilityState={{ disabled: selectDisabled, expanded: dropdownOpen }}
        onPress={selectDisabled ? undefined : () => setDropdownOpen((open) => !open)}
        style={({ pressed }) => [
          accountActionStyles.select,
          pressed && !selectDisabled ? accountActionStyles.selectPressed : null,
          selectDisabled ? accountActionStyles.selectDisabled : null,
        ]}
      >
        <Text
          variant="label"
          numberOfLines={1}
          style={[
            accountActionStyles.selectText,
            !selectedTarget ? accountActionStyles.selectPlaceholder : null,
          ]}
        >
          {selectedTarget?.email ??
            (loadingTargets
              ? "Loading users..."
              : targetsQuery.isError
                ? "Couldn't load users"
                : targets.length === 0
                  ? "No users with email"
                  : "Select a user")}
        </Text>
        <Icon
          name="chevron-down"
          size={16}
          tone="muted"
          style={dropdownOpen ? accountActionStyles.selectChevronOpen : null}
        />
      </Pressable>
      {dropdownOpen && !selectDisabled ? (
        <ScrollView
          style={accountActionStyles.optionList}
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
                  accountActionStyles.option,
                  selected ? accountActionStyles.optionSelected : null,
                  pressed ? accountActionStyles.optionPressed : null,
                ]}
              >
                <Text variant="label" numberOfLines={1} style={accountActionStyles.optionEmail}>
                  {targetUser.email}
                </Text>
                {displayName ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {displayName}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {targetsQuery.isError ? (
        <View style={accountActionStyles.retryRow}>
          <Text variant="caption" tone="muted" style={accountActionStyles.retryText}>
            User emails could not be loaded.
          </Text>
          <Button
            label="Retry"
            size="md"
            variant="secondary"
            disabled={targetsQuery.isFetching}
            loading={targetsQuery.isFetching}
            onPress={() => targetsQuery.refetch()}
          />
        </View>
      ) : null}
      <View style={accountActionStyles.actions}>
        <Button
          label="Sign in"
          size="md"
          disabled={!target.trim() || busy}
          loading={busy}
          onPress={onImpersonate}
          testID="admin-impersonation-submit"
        />
        <Button
          label="Cancel"
          size="md"
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

const accountActionStyles = StyleSheet.create({
  form: { gap: tokens.space.sm, paddingHorizontal: tokens.space.lg, paddingTop: tokens.space.xs },
  select: {
    minHeight: tokens.hit,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 10,
    backgroundColor: tokens.bg.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  selectPressed: { backgroundColor: tokens.bg.elevated },
  selectDisabled: { borderColor: tokens.border.subtle },
  selectText: { flex: 1, minWidth: 0, color: tokens.text.primary },
  selectPlaceholder: { color: tokens.text.muted },
  selectChevronOpen: { transform: [{ rotate: "180deg" }] },
  optionList: {
    maxHeight: 220,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  option: {
    minHeight: tokens.hit,
    justifyContent: "center",
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    gap: tokens.space.xxs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
  },
  optionPressed: { backgroundColor: tokens.bg.elevated },
  optionSelected: { backgroundColor: tokens.accent.muted },
  optionEmail: { color: tokens.text.primary },
  retryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    flexWrap: "wrap",
  },
  retryText: { flex: 1, minWidth: 160 },
  actions: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap" },
  note: {},
});
