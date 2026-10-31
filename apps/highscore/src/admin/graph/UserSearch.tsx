// Find-a-user box for the users tab: type a name or email, pick a match to
// select (and locate) them in whichever view is open.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { AdminGraphNode } from "@workshop/shared";
import { Avatar, Text, tokens } from "@workshop/ui";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { displayName } from "./model";

interface Props {
  nodes: AdminGraphNode[];
  onPick: (id: string) => void;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function UserSearch({ nodes, onPick, value, onChange, placeholder }: Props) {
  const [focused, setFocused] = useState(false);
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter(
        (n) =>
          displayName(n).toLowerCase().includes(q) || (n.email ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [nodes, value]);
  const open = focused && matches.length > 0;

  return (
    <View style={styles.wrap}>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder ?? "Find a user by name or email"}
        placeholderTextColor={tokens.text.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        testID="admin-user-search"
        accessibilityLabel="Find a user"
      />
      {value ? (
        <Pressable
          onPress={() => onChange("")}
          style={styles.clear}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Text tone="muted">✕</Text>
        </Pressable>
      ) : null}
      {open ? (
        <View style={styles.dropdown} testID="admin-user-search-results">
          {matches.map((n) => (
            <Pressable
              key={n.id}
              onPress={() => {
                onPick(n.id);
                onChange("");
                setFocused(false);
              }}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              accessibilityRole="button"
              testID={`admin-user-search-option-${n.id}`}
            >
              <Avatar
                name={displayName(n)}
                imageUrl={userAvatarImageUrl(n.id, n.avatarVersion)}
                size="sm"
              />
              <View style={styles.optionText}>
                <Text numberOfLines={1}>{displayName(n)}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {n.email ?? "—"} · {n.friendCount} friends · {n.scoreCount} scores
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", zIndex: 20, flexGrow: 1, minWidth: 220, maxWidth: 420 },
  input: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingLeft: tokens.space.md,
    paddingRight: 36,
    backgroundColor: tokens.bg.surface,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
  },
  clear: { position: "absolute", right: 10, top: 9, padding: 2 },
  dropdown: {
    position: "absolute",
    top: 44,
    left: 0,
    right: 0,
    backgroundColor: tokens.bg.elevated,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  optionPressed: { backgroundColor: tokens.bg.surface },
  optionText: { flex: 1, minWidth: 0 },
});
