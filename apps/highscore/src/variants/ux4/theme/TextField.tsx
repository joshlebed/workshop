import { forwardRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { glow, MONO_FONT, tokens } from "./tokens";

export interface TextFieldProps extends TextInputProps {
  /** Pasted game results are monospace — the grids only line up that way. */
  mono?: boolean;
  containerStyle?: ViewStyle;
}

/**
 * The app's one input. A 2px bezel that lights pink and glows on focus, which
 * is the DESIGN.md-sanctioned use of glow (focused inputs) and replaces the
 * browser's white outline ring — the only place the app was rendering a colour
 * that isn't in the palette.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { mono = false, containerStyle, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.frame, focused && styles.frameFocused, containerStyle]}>
      <TextInput
        ref={ref}
        placeholderTextColor={tokens.text.secondary}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, mono && styles.mono, style]}
      />
    </View>
  );
});

// The frame owns the focus ring (a pink bezel + glow), so the browser's own
// white outline is redundant and off-palette.
const noOutline: TextStyle =
  Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as TextStyle) : {};

const styles = StyleSheet.create({
  frame: {
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
  },
  frameFocused: { borderColor: tokens.neon.pink, ...glow(tokens.neon.pinkGlow, 8) },
  input: {
    minHeight: 40,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    textAlignVertical: "top",
    ...noOutline,
  },
  mono: {
    fontFamily: MONO_FONT,
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 6,
  },
});
