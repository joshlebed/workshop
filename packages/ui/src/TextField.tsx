import { type ReactNode, type Ref, useId, useState } from "react";
import {
  StyleSheet,
  TextInput,
  type TextInputInstance,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { interaction, webAria } from "./interaction";
import { Text } from "./Text";
import { tokens } from "./theme";

/** iOS Safari zooms into any focused input under 16px and never zooms back. */
const MIN_INPUT_FONT_SIZE = tokens.font.size.md;

export interface TextFieldProps extends Omit<TextInputProps, "style"> {
  ref?: Ref<TextInputInstance>;
  /** Visible label, wired to the input for assistive tech. */
  label?: string;
  /** Quiet helper line under the input. Replaced by `error` when set. */
  hint?: string;
  /** Error line (danger tone); also marks the input invalid. */
  error?: string | null;
  /**
   * `search`: pill-shaped, leading search icon, a clear button while it has
   * text (needs `onClear`). Search fields usually pass `accessibilityLabel`
   * instead of a visible label.
   *
   * `bare`: no box: for inline edits where the text itself is the surface
   * (item title, note). Focus shows as the same low-emphasis accent, as an
   * underline.
   */
  variant?: "default" | "search" | "bare";
  onClear?: () => void;
  /** Inline trailing content inside the field (a count, a key hint). */
  trailing?: ReactNode;
  /** Outer wrapper style (margins, flex). */
  style?: ViewStyle;
  /** Input text style. `fontSize` is floored at 16. */
  inputStyle?: TextStyle;
}

/**
 * The one text input. 16px floor, one focus style (accent border at low
 * emphasis), a label wired via `aria-labelledby`, hint and error lines wired
 * via `aria-describedby`.
 */
export function TextField({
  ref,
  label,
  hint,
  error,
  variant = "default",
  onClear,
  trailing,
  style,
  inputStyle,
  multiline,
  onFocus,
  onBlur,
  editable = true,
  accessibilityLabel,
  testID,
  ...rest
}: TextFieldProps) {
  const id = useId().replace(/:/g, "");
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  const [focused, setFocused] = useState(false);
  const search = variant === "search";
  const bare = variant === "bare";
  const help = error || hint;
  const flatInput = StyleSheet.flatten(inputStyle) ?? {};
  const fontSize = Math.max(MIN_INPUT_FONT_SIZE, flatInput.fontSize ?? MIN_INPUT_FONT_SIZE);
  const showClear = search && !!onClear && typeof rest.value === "string" && rest.value.length > 0;

  return (
    <View style={[styles.root, style]}>
      {label ? (
        <Text variant="label" tone="secondary" nativeID={labelId} style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          search ? styles.fieldSearch : null,
          multiline ? styles.fieldMultiline : null,
          bare ? styles.fieldBare : null,
          focused ? styles.fieldFocused : null,
          error ? styles.fieldError : null,
          !editable ? styles.fieldDisabled : null,
        ]}
      >
        {search ? <Icon name="search" size={16} tone="muted" /> : null}
        <TextInput
          ref={ref}
          {...rest}
          testID={testID}
          editable={editable}
          multiline={multiline}
          placeholderTextColor={rest.placeholderTextColor ?? tokens.text.muted}
          accessibilityLabel={accessibilityLabel ?? (label ? undefined : rest.placeholder)}
          aria-labelledby={label ? labelId : undefined}
          {...webAria({
            "aria-describedby": help ? helpId : undefined,
            "aria-invalid": error ? true : undefined,
          })}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.input,
            multiline ? styles.inputMultiline : null,
            bare ? styles.inputBare : null,
            flatInput,
            { fontSize },
          ]}
        />
        {trailing}
        {showClear ? (
          <IconButton
            icon="close"
            iconSize={14}
            iconTone="muted"
            accessibilityLabel="Clear"
            onPress={onClear}
            style={styles.clear}
            testID={testID ? `${testID}-clear` : undefined}
          />
        ) : null}
      </View>
      {help ? (
        <Text
          variant="caption"
          tone={error ? "danger" : "muted"}
          nativeID={helpId}
          accessibilityLiveRegion={error ? "polite" : undefined}
        >
          {help}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: tokens.space.xsm },
  label: { marginLeft: tokens.space.xxs },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: tokens.hit,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  fieldSearch: {
    borderRadius: tokens.radius.pill,
    paddingLeft: tokens.space.md,
    paddingRight: tokens.space.xs,
    borderColor: tokens.border.subtle,
  },
  fieldMultiline: { alignItems: "flex-start", minHeight: 88 },
  fieldBare: {
    minHeight: tokens.hit,
    paddingHorizontal: 0,
    borderRadius: 0,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  fieldFocused: { borderColor: interaction.focus },
  fieldError: { borderColor: tokens.status.danger },
  fieldDisabled: { opacity: 0.6 },
  input: {
    flex: 1,
    minWidth: 0,
    color: tokens.text.primary,
    fontSize: MIN_INPUT_FONT_SIZE,
    lineHeight: 22,
    paddingVertical: 10,
    // The input element itself is the click/tap target on web: 44pt.
    minHeight: tokens.hit,
  },
  inputMultiline: { textAlignVertical: "top", minHeight: 86 },
  inputBare: { minHeight: tokens.hit },
  clear: { borderRadius: tokens.radius.pill },
});
