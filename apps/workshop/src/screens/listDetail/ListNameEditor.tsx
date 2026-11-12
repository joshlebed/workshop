import { interaction, Text, TextField, tokens, webAria } from "@workshop/ui";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, type TextStyle, View } from "react-native";

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

  // Web: the heading wraps the rename button (a heading inside a button is
  // flattened into the button's name and stops being a heading), so the
  // screen keeps its level-1 heading and the post-navigation focus can land
  // on it. Native keeps the plain button.
  return (
    <View {...webAria({ role: "heading", "aria-level": 1 })} style={styles.heading}>
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
        <Text variant="title" numberOfLines={2} style={style} headerRole={false}>
          {name}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { maxWidth: "100%" },
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
