import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { colors, radius, seasons, space } from "@/theme";
import { enterUp, exitFade, layoutShift } from "@/theme/motion.ts";

import { Button } from "./button.tsx";
import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";

const mailIcon = { ios: "envelope.badge", android: "mark_email_unread" } as const satisfies IconName;

export type VerificationBannerProps = {
  /** The address waiting for confirmation; null when there is no email to resend to. */
  email: string | null;
  sending: boolean;
  cooldown: number;
  notice: { tone: "error" | "info" | "success"; text: string } | null;
  onResend: () => void;
};

/**
 * SPEC §1: shown until the email is confirmed. Booking, paying, messaging and business
 * tools stay locked until then; browsing and onboarding do not.
 */
export function VerificationBanner({
  email,
  sending,
  cooldown,
  notice,
  onResend,
}: VerificationBannerProps) {
  const palette = seasons.winter;
  return (
    <Animated.View
      entering={enterUp}
      exiting={exitFade}
      layout={layoutShift}
      style={[styles.banner, { backgroundColor: palette.tint }]}
      accessibilityRole="summary"
    >
      <View style={styles.row}>
        <View style={styles.iconTile}>
          <Icon name={mailIcon} size={20} color={palette.accent} />
        </View>
        <View style={styles.text}>
          <Text variant="bodyStrong">Confirm your email</Text>
          <Text variant="small" tone="muted">
            {email ? (
              <>
                We sent a link to <Text variant="small">{email}</Text>. Booking, messaging and
                business tools unlock once it's confirmed.
              </>
            ) : (
              "Booking, messaging and business tools unlock once your contact is confirmed."
            )}
          </Text>
        </View>
      </View>
      {notice ? (
        <Animated.View entering={enterUp} exiting={exitFade}>
          <Text
            variant="small"
            tone={notice.tone === "error" ? "danger" : "primary"}
            accessibilityLiveRegion="polite"
            style={styles.notice}
          >
            {notice.text}
          </Text>
        </Animated.View>
      ) : null}
      {email ? (
        <Button
          variant="secondary"
          size="sm"
          label={cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
          loading={sending}
          disabled={cooldown > 0}
          onPress={onResend}
          accessibilityHint="Sends a new confirmation link to your email"
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    gap: space.sm + 4,
    padding: 16,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: "#C9DCEC",
  },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, gap: 2 },
  notice: { marginLeft: 52 },
});
