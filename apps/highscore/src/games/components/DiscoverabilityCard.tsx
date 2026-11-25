// "Let friends find me" — the opt-in side of contacts matching (spike #3).
// Shown on every platform (web shows only this). On = the server keeps a
// peppered hash of the account email so someone with that email in their
// contacts can find this account; off = the hash is deleted. Phone numbers
// can't be opted in until they can be verified.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import type { DiscoverabilityResponse } from "@workshop/shared/contacts";
import { haptics } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
import { fetchDiscoverability, saveDiscoverability } from "../../api/contacts";
import { Text, tokens, useToast } from "../../theme";

export const DISCOVERABILITY_QUERY_KEY = ["contacts", "discoverability"] as const;

/** The line under the toggle: what it does for this account, honestly. */
export function discoverabilityDetail(state: DiscoverabilityResponse | undefined): string {
  if (!state) return "Checking…";
  const { address, isRelay, enabled } = state.email;
  if (!address) return "Your account has no email address, so there's nothing to be found by.";
  if (isRelay) {
    return `Your account email is an Apple Hide My Email address (${address}). Nobody has it in their contacts, so turning this on won't help people find you.`;
  }
  return enabled
    ? `People who have ${address} in their contacts can find you. Turn off to stop.`
    : `Off. Turn on so people who have ${address} in their contacts can find you.`;
}

export function DiscoverabilityCard({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const query = useQuery({
    queryKey: DISCOVERABILITY_QUERY_KEY,
    queryFn: () => fetchDiscoverability(token),
    enabled: !!token,
  });
  const save = useMutation({
    mutationFn: (email: boolean) => saveDiscoverability(email, token),
    onSuccess: (data) => {
      haptics.selection();
      queryClient.setQueryData(DISCOVERABILITY_QUERY_KEY, data);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't change that setting."), tone: "danger" });
    },
  });

  const state = query.data;
  const enabled = save.isPending ? (save.variables ?? false) : (state?.email.enabled ?? false);
  const disabled = !state || save.isPending || (!state.email.address && !enabled);

  return (
    <View style={styles.card} testID="discoverability-card">
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled, disabled }}
        // RNW drops `accessibilityState` (root CLAUDE.md); `aria-checked` reaches the DOM.
        aria-checked={enabled}
        accessibilityLabel="Let friends find me by email"
        testID="discoverability-toggle"
        onPress={disabled ? undefined : () => save.mutate(!enabled)}
        style={styles.toggleRow}
      >
        <View style={styles.toggleText}>
          <Text variant="label" style={styles.toggleLabel}>
            Let friends find me by email
          </Text>
          <Text variant="caption" tone="muted" testID="discoverability-detail">
            {discoverabilityDetail(state)}
          </Text>
        </View>
        <View style={[styles.track, enabled && styles.trackOn]}>
          <View style={[styles.thumb, enabled && styles.thumbOn]} />
        </View>
      </Pressable>
      <Text variant="caption" tone="muted">
        We keep a one-way code made from your email, never the address itself, and only to match
        people who look for you. Finding by phone number isn't available yet.
      </Text>
    </View>
  );
}

const TRACK_W = 44;
const THUMB = 18;

const styles = StyleSheet.create({
  card: {
    gap: tokens.space.md,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  toggleText: { flex: 1, minWidth: 0, gap: 2 },
  toggleLabel: { fontSize: tokens.font.size.md, color: tokens.text.primary },
  track: {
    width: TRACK_W,
    height: THUMB + 8,
    padding: 2,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.elevated,
    justifyContent: "center",
  },
  trackOn: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.text.muted,
  },
  thumbOn: { backgroundColor: tokens.neon.pink, alignSelf: "flex-end" },
});
