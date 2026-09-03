// The one input in the app. Sharp corners, 2px bezel, and — per DESIGN.md's
// short list of things allowed to glow — a pink bezel plus halo while focused.
// Also kills react-native-web's default focus outline, which otherwise draws a
// second, non-brand ring on top of ours.

import { forwardRef, useState } from "react";
import { Platform, StyleSheet, TextInput, type TextInputProps, type TextStyle } from "react-native";
import { glow, tokens } from "./tokens";

export interface TextFieldProps extends TextInputProps {
  /** Monospace face — for pasted score blocks, which are grids of glyphs. */
  mono?: boolean;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { mono = false, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
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
      style={[styles.base, mono && styles.mono, focused && focusStyle, style]}
    />
  );
});

const focusStyle = {
  borderColor: tokens.neon.pink,
  ...glow(tokens.neon.pinkGlow, 8),
} as TextStyle;

const styles = StyleSheet.create({
  base: {
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: 0,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 10,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.canvas,
    // RNW-only; harmless on native.
    outlineWidth: 0,
  } as TextStyle,
  mono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 17,
    textAlignVertical: "top",
  },
});
