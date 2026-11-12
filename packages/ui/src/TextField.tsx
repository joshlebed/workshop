import { type ReactNode, type Ref, useEffect, useId, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
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
  // A web textarea keeps its first height and clips what wraps past it (a
  // long item title lost its third line); native multiline inputs grow on
  // their own. Track the content height and size the textarea to it. The
  // handler is deliberately not memoized: react-native-web re-measures on
  // every new handler, which catches a value set from props, not typing.
  const growOnWeb = !!multiline && Platform.OS === "web";
  const [webHeight, setWebHeight] = useState<number | null>(null);
  // iOS has no live regions: say a new error out loud (web uses role="alert").
  useEffect(() => {
    if (error && Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(error);
  }, [error]);
  const search = variant === "search";
  const bare = variant === "bare";
  const help = error || hint;
  const flatInput = StyleSheet.flatten(inputStyle) ?? {};
  const fontSize = Math.max(MIN_INPUT_FONT_SIZE, flatInput.fontSize ?? MIN_INPUT_FONT_SIZE);
  const showClear = search && !!onClear && typeof rest.value === "string" && rest.value.length > 0;

  return (
    <View style={[styles.root, style]}>
      {label ? (
        <Text variant="label" tone="secondary" nativeID={labelId}>
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
          // The app is dark only (UX pass 0.15), so the iOS keyboard is too.
          keyboardAppearance="dark"
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
          onContentSizeChange={
            growOnWeb
              ? (e) => {
                  setWebHeight(e.nativeEvent.contentSize.height);
                  rest.onContentSizeChange?.(e);
                }
              : rest.onContentSizeChange
          }
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
            growOnWeb && webHeight ? { height: webHeight } : null,
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
          // An error is announced as it appears (and is the field's
          // description through aria-describedby); a hint is only described.
          role={error ? "alert" : undefined}
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
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: tokens.hit,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    // `border.control`: an input's edge clears 3:1 on canvas and surface.
    borderColor: tokens.border.control,
    backgroundColor: tokens.bg.surface,
  },
  fieldSearch: {
    borderRadius: tokens.radius.pill,
    paddingLeft: tokens.space.md,
    paddingRight: tokens.space.xs,
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
    lineHeight: tokens.font.lineHeight.md,
    paddingVertical: tokens.space.sm,
    // The input element itself is the click/tap target on web: 44pt.
    minHeight: tokens.hit,
  },
  inputMultiline: { textAlignVertical: "top", minHeight: 86 },
  inputBare: { minHeight: tokens.hit },
  clear: { borderRadius: tokens.radius.pill },
});
