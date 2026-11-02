// Find-a-user box for the users tab: type a name or email, pick a match to
// select (and locate) them in whichever view is open.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { AdminGraphNode } from "@workshop/shared";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Avatar, bodyType, PixelIcon, Text, tokens } from "../../theme";
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
        placeholderTextColor={tokens.text.secondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, focused && styles.inputFocused]}
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
          <PixelIcon name="close" size={16} color={tokens.text.secondary} />
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
    ...bodyType(),
    minHeight: 40,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: 0,
    paddingLeft: tokens.space.md,
    paddingRight: 36,
    backgroundColor: tokens.bg.elevated,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
  },
  inputFocused: { borderColor: tokens.neon.pink },
  clear: { position: "absolute", right: 10, top: 10, padding: 2 },
  dropdown: {
    position: "absolute",
    top: 44,
    left: 0,
    right: 0,
    backgroundColor: tokens.bg.elevated,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: 0,
    overflow: "hidden",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  optionPressed: { backgroundColor: tokens.accent.muted },
  optionText: { flex: 1, minWidth: 0 },
});
