// Friends tab → Crews (spike #8): "Start a crew" (name → link → share sheet /
// copy → the crew screen) and the crews I'm in. One link makes everyone who
// joins friends with everyone already in the crew.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { createCrew, fetchMyCrews } from "@workshop/api-client/crews";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { CREW_NAME_MAX_LENGTH } from "@workshop/shared/crews";
import { haptics } from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, type TextStyle, View } from "react-native";
import {
  Button,
  bodyType,
  glow,
  PixelIcon,
  sectionLabelType,
  Text,
  tokens,
  useToast,
} from "../../theme";
import { memberCountLabel } from "../lib/crews";
import { prewarmShareCard } from "../lib/prewarmShareCard";
import { shareOrCopyLink } from "../lib/share";
import { useGamesRuntime } from "../runtime";

export function CrewsSection() {
  const { token, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [focused, setFocused] = useState(false);

  const crewsQuery = useQuery({
    queryKey: queryKeys.crews.mine,
    queryFn: () => fetchMyCrews(token),
    enabled: !!token,
  });
  const crews = crewsQuery.data?.crews ?? [];
  const atLimit = crewsQuery.data ? crews.length >= crewsQuery.data.limit : false;

  const createMutation = useMutation({
    mutationFn: () => createCrew(name, token),
    onSuccess: async ({ crew }) => {
      haptics.medium();
      setCreating(false);
      setName("");
      prewarmShareCard(crew.url);
      await queryClient.invalidateQueries({ queryKey: queryKeys.crews.mine });
      const result = await shareOrCopyLink(crew.url);
      if (result === "copied") showToast({ message: "Crew link copied", tone: "success" });
      router.push(routes.crew(crew.id) as Href);
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't start the crew."), tone: "danger" }),
  });

  const trimmed = name.trim();
  return (
    <View style={styles.card} testID="friends-crews">
      <Text variant="heading" style={styles.title}>
        Start a crew
      </Text>
      <Text variant="caption" tone="muted">
        One link for your group chat. Everyone who joins becomes friends with everyone in the crew,
        and you all share a crew board.
      </Text>
      {creating ? (
        <>
          <TextInput
            testID="friends-crew-name"
            value={name}
            onChangeText={setName}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Crew name, e.g. Sunday Puzzlers"
            placeholderTextColor={tokens.text.secondary}
            maxLength={CREW_NAME_MAX_LENGTH}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={() => {
              if (trimmed) createMutation.mutate();
            }}
            style={[styles.input, focused && styles.inputFocused]}
          />
          <View style={styles.actions}>
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => {
                setCreating(false);
                setName("");
              }}
              disabled={createMutation.isPending}
              testID="friends-crew-cancel"
            />
            <View style={styles.flex}>
              <Button
                label="Create & share link"
                onPress={() => createMutation.mutate()}
                loading={createMutation.isPending}
                disabled={!trimmed || createMutation.isPending}
                testID="friends-crew-create"
              />
            </View>
          </View>
        </>
      ) : atLimit ? (
        <Text variant="caption" tone="secondary">
          You're in {crewsQuery.data?.limit} crews — leave one to start another.
        </Text>
      ) : (
        <Button
          label="Start a crew"
          onPress={() => setCreating(true)}
          testID="friends-crew-start"
        />
      )}

      {crews.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.listLabel}>{crews.length === 1 ? "Your crew" : "Your crews"}</Text>
          {crews.map((crew) => (
            <Pressable
              key={crew.id}
              onPress={() => router.push(routes.crew(crew.id) as Href)}
              accessibilityLabel={`${crew.name}, ${memberCountLabel(crew.memberCount)}`}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.row,
                (pressed || hovered) && styles.rowHover,
              ]}
              testID={`friends-crew-row-${crew.id}`}
            >
              <View style={styles.rowText}>
                <Text variant="label" numberOfLines={1} style={styles.rowName}>
                  {crew.name}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {memberCountLabel(crew.memberCount)}
                  {crew.isCreator ? " · you started it" : ""}
                </Text>
              </View>
              <PixelIcon name="chevron-right" size={16} color={tokens.text.secondary} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: tokens.space.md,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  title: { letterSpacing: -0.2 },
  input: {
    ...bodyType(),
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.sm,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: 12,
    color: tokens.text.primary,
    // ≥16 so iOS Safari doesn't zoom the page on focus.
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.elevated,
  },
  inputFocused: { borderColor: tokens.neon.pink, ...(glow(tokens.neon.pinkGlow, 8) as TextStyle) },
  actions: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  flex: { flex: 1 },
  list: { gap: tokens.space.xs },
  listLabel: { ...sectionLabelType(), color: tokens.text.secondary },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 52,
    marginHorizontal: -tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.default,
  },
  rowHover: { backgroundColor: tokens.bg.elevated },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { ...bodyType("medium"), fontSize: tokens.font.size.md, color: tokens.text.primary },
});
