import { interaction, Text, TextField, tokens } from "@workshop/ui";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, type TextStyle } from "react-native";

/**
 * The list's name in its header, editable in place (UX pass 4.3): a list
 * made from a template in one tap starts with the template's name, and this
 * is where it gets its own. Tap the name, type, Return (or leave the field)
 * saves; an empty name puts the old one back. Owners only; everyone else
 * sees plain text.
 */
export function ListNameEditor({
  name,
  onRename,
  style,
}: {
  name: string;
  onRename?: (next: string) => Promise<void>;
  style?: TextStyle;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  if (!onRename) {
    return (
      <Text variant="title" numberOfLines={2} style={style} testID="list-detail-name">
        {name}
      </Text>
    );
  }

  const commit = () => {
    const next = draft.replace(/\s+/g, " ").trim();
    setEditing(false);
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    void onRename(next.slice(0, 80)).catch(() => setDraft(name));
  };

  if (editing) {
    return (
      <TextField
        value={draft}
        onChangeText={setDraft}
        accessibilityLabel="List name"
        autoFocus
        selectTextOnFocus
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={commit}
        onBlur={commit}
        testID="list-detail-name-input"
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}. Rename list`}
      onPress={() => setEditing(true)}
      testID="list-detail-name"
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.target,
        hovered && { backgroundColor: interaction.hover },
        pressed && { backgroundColor: interaction.pressed },
      ]}
    >
      <Text variant="title" numberOfLines={2} style={style}>
        {name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    alignSelf: "flex-start",
    minHeight: tokens.hit,
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
    marginHorizontal: -tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
    maxWidth: "100%",
  },
});
