/**
 * Form building blocks for the sign-in, sign-up and account screens, in the Seasons style.
 * Generic enough to move into `src/components/` once other forms need them.
 */
import { router } from "expo-router";
import { type ReactNode, type Ref, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  TextInput,
  type TextInputInstance,
  type TextInputProps,
  type TextStyle,
  View,
} from "react-native";

import { Icon, type IconName, icons } from "@/components/icon.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { colors, MIN_TOUCH, radius, space, typography } from "@/theme";

export const formIcons = {
  close: { ios: "xmark", android: "close" },
  mail: { ios: "envelope", android: "mail" },
  phone: { ios: "iphone", android: "smartphone" },
  error: { ios: "exclamationmark.circle", android: "error" },
  info: { ios: "info.circle", android: "info" },
  success: icons.check,
} as const satisfies Record<string, IconName>;

/** Leaves the sign-in flow: back to where it was opened from, or the Account tab. */
export function closeAuthFlow() {
  if (router.canGoBack()) router.back();
  else router.replace("/account");
}

/** Full-height modal page with a Close button, keyboard avoidance and a large title. */
export function AuthScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen
        title={title}
        subtitle={subtitle}
        edges={["top", "bottom", "left", "right"]}
        header={
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={closeAuthFlow}
              hitSlop={4}
              style={({ pressed }) => [styles.closeButton, pressed && styles.closePressed]}
            >
              <Icon name={formIcons.close} size={18} color={colors.ink} />
            </Pressable>
          </View>
        }
      >
        {children}
      </Screen>
    </KeyboardAvoidingView>
  );
}

export type TextFieldProps = Omit<TextInputProps, "style"> & {
  /** Visible label; also the input's accessible name. */
  label: string;
  hint?: string;
  error?: string | null;
  /** Rendered inside the field after the input (e.g. a show-password toggle). */
  trailing?: ReactNode;
  inputStyle?: StyleProp<TextStyle>;
  ref?: Ref<TextInputInstance>;
};

/** Labelled text input with hint and inline error. */
export function TextField({
  label,
  hint,
  error,
  trailing,
  inputStyle,
  ref,
  onFocus,
  onBlur,
  editable,
  ...rest
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const description = error || hint;
  return (
    <View style={styles.field}>
      <Text
        variant="bodyStrong"
        style={styles.label}
        // The input carries the label as its accessible name; don't read it twice.
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
      </Text>
      <View
        style={[
          styles.inputWrap,
          focused && styles.inputFocused,
          error ? styles.inputError : null,
          editable === false && styles.inputDisabled,
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={description || undefined}
          placeholderTextColor={colors.placeholder}
          editable={editable}
          style={[styles.input, inputStyle]}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />
        {trailing}
      </View>
      {error ? (
        <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Password input with a Show/Hide toggle. */
export function PasswordField(props: Omit<TextFieldProps, "secureTextEntry" | "trailing">) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      {...props}
      secureTextEntry={!visible}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? "Hide password" : "Show password"}
          onPress={() => setVisible((value) => !value)}
          style={styles.toggle}
        >
          <Text variant="bodyStrong" tone="primary" style={styles.toggleText}>
            {visible ? "Hide" : "Show"}
          </Text>
        </Pressable>
      }
    />
  );
}

export type FormAlertTone = "error" | "info" | "success";

const alertTones: Record<
  FormAlertTone,
  { background: string; border: string; color: string; icon: IconName }
> = {
  error: { background: "#FCEDEB", border: "#F3C9C3", color: colors.danger, icon: formIcons.error },
  info: {
    background: colors.tabPill,
    border: "#CBE1C5",
    color: colors.primary,
    icon: formIcons.info,
  },
  success: {
    background: colors.tabPill,
    border: "#CBE1C5",
    color: colors.primary,
    icon: formIcons.success,
  },
};

/** Inline status message above a form; announced to screen readers when it appears. */
export function FormAlert({ tone, message }: { tone: FormAlertTone; message: string }) {
  const palette = alertTones[tone];
  useEffect(() => {
    // Android announces via the live region; iOS needs an explicit announcement.
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  return (
    <View
      accessible
      accessibilityRole={tone === "error" ? "alert" : "text"}
      accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
      style={[styles.alert, { backgroundColor: palette.background, borderColor: palette.border }]}
    >
      <Icon name={palette.icon} size={20} color={palette.color} />
      <Text style={styles.alertText}>{message}</Text>
    </View>
  );
}

export type SegmentOption<T extends string> = { value: T; label: string; icon?: IconName };

/** Two or three mutually exclusive tabs, e.g. Email | Phone code. */
export function SegmentedTabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** Accessible name of the tab list. */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={styles.track}>
      {options.map((option, index) => {
        const selected = option.value === value;
        const tint = selected ? colors.primary : colors.muted;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={`${option.label}, ${index + 1} of ${options.length}`}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            {option.icon ? <Icon name={option.icon} size={18} color={tint} /> : null}
            <Text
              variant="bodyStrong"
              numberOfLines={1}
              style={{ color: selected ? colors.ink : tint }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "Prompt? Action" line under a form, e.g. "New to Nevile? Create an account". */
export function SwitchPrompt({
  prompt,
  action,
  onPress,
}: {
  prompt: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.switchRow}>
      <Text tone="muted">{prompt}</Text>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={action}
        onPress={onPress}
        hitSlop={8}
        style={styles.switchAction}
      >
        {({ pressed }) => (
          <Text variant="bodyStrong" tone="primary" style={pressed && styles.pressedText}>
            {action}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingTop: space.sm,
  },
  closeButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closePressed: { backgroundColor: colors.ghostPressed },
  field: { gap: 6 },
  label: { fontSize: 14 },
  inputWrap: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    paddingRight: 4,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  inputFocused: { borderColor: colors.primary, borderWidth: 1.5 },
  inputError: { borderColor: colors.danger },
  inputDisabled: { backgroundColor: colors.ground },
  input: {
    ...typography.body,
    fontSize: 16,
    flex: 1,
    minHeight: MIN_TOUCH,
    color: colors.ink,
    paddingVertical: 0,
  },
  toggle: {
    minWidth: MIN_TOUCH + 12,
    height: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleText: { fontSize: 14 },
  alert: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: radius.input,
    borderWidth: 1,
  },
  alertText: { flex: 1 },
  track: {
    flexDirection: "row",
    padding: 4,
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.ghostPressed,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "transparent",
  },
  segmentSelected: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    boxShadow: "0px 1px 2px rgba(24, 33, 29, 0.08)",
  },
  switchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 6,
  },
  switchAction: { minHeight: MIN_TOUCH, justifyContent: "center" },
  pressedText: { opacity: 0.7 },
});
