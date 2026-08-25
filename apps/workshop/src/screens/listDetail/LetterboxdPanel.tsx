// Letterboxd-match surface on the list-detail screen (`letterboxd` module):
//
//   1. Connect banner — shown while the viewer hasn't linked a Letterboxd
//      username (account-level, set once, reused by every match list).
//   2. Suggestions — pending films members brought from Letterboxd. Each row
//      shows who's in; "I'm in" records the viewer's acceptance (the first
//      acceptance from a non-suggester promotes the film into the list) and
//      offers to open the film on Letterboxd so they can add it to their
//      real watchlist (Workshop can't write to Letterboxd — no public API).
//   3. Suggest input — paste a letterboxd.com/film/… URL to bring a film.
//
// Match results themselves (films on ≥2 members' watchlists) render in the
// regular ItemList below; this panel owns everything above it.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { Item, List, ListMemberSummary } from "@workshop/shared";
import { Button, Card, Text, tokens, useToast } from "@workshop/ui";
import { useState } from "react";
import { Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import { acceptItem, fetchLetterboxdStatus, suggestFilm } from "../../api/letterboxd";
import { useAuth } from "../../hooks/useAuth";
import { confirm } from "../../lib/confirm";
import { haptics } from "../../lib/haptics";
import { openExternalUrl } from "../../lib/openUrl";

interface Props {
  list: List;
  members: ListMemberSummary[];
  suggested: Item[];
  token: string | null;
  accent: string;
  /** Kick the match source sync (the header ↻) — used right after connecting. */
  onRequestSync: () => void;
}

export function LetterboxdPanel({ list, members, suggested, token, accent, onRequestSync }: Props) {
  const { user, connectLetterboxd } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const selfId = user?.id ?? null;
  const connected = !!user?.letterboxdUsername;

  const statusQuery = useQuery({
    queryKey: queryKeys.letterboxd.status(list.id),
    queryFn: () => fetchLetterboxdStatus(list.id, token),
    enabled: !!token,
    staleTime: 30_000,
  });
  const connectedCount =
    statusQuery.data?.members.filter((m) => m.letterboxdUsername !== null).length ?? null;

  const [username, setUsername] = useState("");
  const connectMutation = useMutation({
    mutationFn: (name: string) => connectLetterboxd(name),
    onSuccess: (filmCount) => {
      haptics.medium();
      showToast({
        message: `Connected — ${filmCount} ${filmCount === 1 ? "film" : "films"} on your watchlist`,
        tone: "success",
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.letterboxd.status(list.id) });
      // Re-run the match now that a new watchlist participates.
      onRequestSync();
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't connect that username."), tone: "danger" });
    },
  });

  const [suggestUrl, setSuggestUrl] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const suggestMutation = useMutation({
    mutationFn: (letterboxdUrl: string) => suggestFilm(list.id, { letterboxdUrl }, token),
    onSuccess: () => {
      haptics.medium();
      setSuggestUrl("");
      setSuggestOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(list.id) });
      showToast({
        message: "Suggested — it joins the list when someone accepts.",
        tone: "success",
      });
    },
    onError: (e) => {
      showToast({
        message: errorMessage(e, "Couldn't suggest that film. Is it a letterboxd.com/film/… URL?"),
        tone: "danger",
      });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (item: Item) => acceptItem(item.id, token),
    onSuccess: async (_res, item) => {
      haptics.medium();
      queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(list.id) });
      const c = item.content as { letterboxdUrl?: string };
      if (c.letterboxdUrl) {
        const open = await confirm({
          title: "Add it on Letterboxd too?",
          message:
            "Workshop can't edit your Letterboxd watchlist — open the film page and tap the watchlist icon there.",
          confirmLabel: "Open Letterboxd",
        });
        if (open) openExternalUrl(c.letterboxdUrl);
      }
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't accept that suggestion."), tone: "danger" });
    },
  });

  const nameOf = (userId: string): string =>
    userId === selfId
      ? "you"
      : (members.find((m) => m.userId === userId)?.displayName ?? "someone");

  return (
    <View style={styles.root}>
      {!connected ? (
        <Card style={styles.connectCard} elevated testID="letterboxd-connect-banner">
          <Text variant="heading" style={styles.connectLead}>
            Connect your Letterboxd
          </Text>
          <Text variant="caption" tone="secondary" style={styles.connectCopy}>
            Films on your watchlist and{" "}
            {connectedCount === 1 ? "another member's" : "other members'"} show up here
            automatically.
          </Text>
          <View style={styles.connectRow}>
            <TextInput
              testID="letterboxd-username-input"
              value={username}
              onChangeText={setUsername}
              placeholder="Letterboxd username"
              placeholderTextColor={tokens.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              onSubmitEditing={() => {
                if (username.trim()) connectMutation.mutate(username.trim());
              }}
            />
            <Button
              testID="letterboxd-connect-submit"
              label="Connect"
              size="md"
              disabled={!username.trim() || connectMutation.isPending}
              loading={connectMutation.isPending}
              onPress={() => connectMutation.mutate(username.trim())}
            />
          </View>
        </Card>
      ) : null}

      {suggested.length > 0 ? (
        <View style={styles.suggestions} testID="letterboxd-suggestions">
          <Text variant="label" tone="secondary" style={styles.sectionLabel}>
            Suggestions
          </Text>
          {suggested.map((item) => {
            const lb = item.letterboxd;
            const acceptances = lb?.acceptances ?? [];
            const accepted = !!selfId && acceptances.some((a) => a.userId === selfId);
            const c = item.content as { posterUrl?: string; year?: number; letterboxdUrl?: string };
            const suggesterName = nameOf(item.addedBy);
            const inNames = acceptances.map((a) => nameOf(a.userId));
            return (
              <View key={item.id} style={styles.suggestionRow} testID={`suggestion-${item.id}`}>
                {c.posterUrl ? (
                  <Image
                    source={{ uri: c.posterUrl }}
                    style={styles.poster}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={[styles.poster, { backgroundColor: `${accent}1F` }]}>
                    <Text style={styles.posterGlyph}>🎬</Text>
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.title} on Letterboxd`}
                  onPress={() => openExternalUrl(c.letterboxdUrl ?? item.url)}
                  style={styles.suggestionBody}
                >
                  <Text numberOfLines={1} style={styles.suggestionTitle}>
                    {item.title}
                    {c.year ? <Text tone="muted"> ({c.year})</Text> : null}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    Suggested by {suggesterName}
                    {inNames.length > 0 ? ` · in: ${inNames.join(", ")}` : ""}
                  </Text>
                </Pressable>
                {accepted ? (
                  <Text variant="caption" tone="muted" style={styles.acceptedTag}>
                    ✓ in
                  </Text>
                ) : (
                  <Button
                    testID={`suggestion-accept-${item.id}`}
                    label="I'm in"
                    size="md"
                    variant="secondary"
                    disabled={acceptMutation.isPending}
                    onPress={() => acceptMutation.mutate(item)}
                  />
                )}
              </View>
            );
          })}
        </View>
      ) : null}

      {suggestOpen ? (
        <View style={styles.suggestForm}>
          <TextInput
            testID="letterboxd-suggest-input"
            value={suggestUrl}
            onChangeText={setSuggestUrl}
            placeholder="https://letterboxd.com/film/…"
            placeholderTextColor={tokens.text.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            keyboardType="url"
            style={styles.input}
            onSubmitEditing={() => {
              if (suggestUrl.trim()) suggestMutation.mutate(suggestUrl.trim());
            }}
          />
          <Button
            testID="letterboxd-suggest-submit"
            label="Suggest"
            size="md"
            disabled={!suggestUrl.trim() || suggestMutation.isPending}
            loading={suggestMutation.isPending}
            onPress={() => suggestMutation.mutate(suggestUrl.trim())}
          />
          <Button
            label="Cancel"
            size="md"
            variant="secondary"
            onPress={() => {
              setSuggestOpen(false);
              setSuggestUrl("");
            }}
          />
        </View>
      ) : (
        <View style={styles.footerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Suggest a film from Letterboxd"
            onPress={() => setSuggestOpen(true)}
            testID="letterboxd-suggest-open"
            style={({ pressed }) => [styles.suggestLink, pressed && styles.suggestLinkPressed]}
          >
            <Text variant="caption" style={{ color: accent }}>
              + Suggest a film from Letterboxd
            </Text>
          </Pressable>
          {connectedCount !== null ? (
            <Text variant="caption" tone="muted" testID="letterboxd-connected-count">
              {connectedCount} of {members.length} connected
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.sm,
    gap: tokens.space.sm,
  },
  connectCard: {
    gap: tokens.space.sm,
    padding: tokens.space.lg,
  },
  connectLead: { letterSpacing: -0.2 },
  connectCopy: { lineHeight: 18 },
  connectRow: {
    flexDirection: "row",
    gap: tokens.space.sm,
    alignItems: "center",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 10,
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    backgroundColor: tokens.bg.surface,
  },
  suggestions: { gap: tokens.space.sm },
  sectionLabel: { letterSpacing: 0.4, textTransform: "uppercase", fontSize: 11 },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  poster: {
    width: 36,
    height: 54,
    borderRadius: tokens.radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  posterGlyph: { fontSize: 16 },
  suggestionBody: { flex: 1, minWidth: 0, gap: 2 },
  suggestionTitle: { fontSize: tokens.font.size.sm },
  acceptedTag: { paddingHorizontal: tokens.space.sm },
  suggestForm: {
    flexDirection: "row",
    gap: tokens.space.sm,
    alignItems: "center",
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.sm,
  },
  suggestLink: { paddingVertical: tokens.space.xs },
  suggestLinkPressed: { opacity: 0.7 },
});
