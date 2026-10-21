import type { Ref } from "react";
import { Pressable, StyleSheet, TextInput, type TextInputProps, View } from "react-native";

import { colors, MIN_TOUCH, radius, typography } from "@/theme";

import { Icon, icons } from "./icon.tsx";

export type SearchFieldProps = Omit<TextInputProps, "style"> & {
  /** Accessible name for the field (there is no visible label). */
  label: string;
  onClear?: () => void;
  ref?: Ref<TextInput>;
};

/** Rounded search input with a leading magnifier and an optional clear button. */
export function SearchField({ label, value, onClear, placeholder, ref, ...rest }: SearchFieldProps) {
  const showClear = Boolean(onClear) && Boolean(value);
  return (
    <View style={styles.wrap}>
      <Icon name={icons.search} size={20} color={colors.muted} />
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        value={value}
        returnKeyType="search"
        autoCorrect={false}
        clearButtonMode="never"
        style={styles.input}
        {...rest}
      />
      {showClear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={onClear}
          hitSlop={8}
          style={styles.clear}
        >
          <Icon name={icons.clear} size={18} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 16,
    paddingRight: 6,
    borderRadius: radius.input + 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    ...typography.body,
    flex: 1,
    minHeight: MIN_TOUCH,
    color: colors.ink,
    paddingVertical: 0,
  },
  clear: { width: MIN_TOUCH - 8, height: MIN_TOUCH - 8, alignItems: "center", justifyContent: "center" },
});
