import { StyleSheet, View } from "react-native";

import { Badge } from "@/components/badge.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Icon, icons } from "@/components/icon.tsx";
import { ListRow } from "@/components/list-row.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { colors, space } from "@/theme";

/** The minimal user shape the account screen renders; the auth layer maps its session to this. */
export type AccountUser = {
  name: string;
  email?: string | null;
  phone?: string | null;
};

export type AccountSession = {
  user: AccountUser;
};

/** SPEC §1: one login can act as a customer or a business. */
export type AccountMode = "customer" | "business";

export type AccountScreenProps = {
  /** `null`/`undefined` renders the signed-out state. */
  session?: AccountSession | null;
  mode?: AccountMode;
  /** True while the session is being restored or a sign-out is in flight. */
  loading?: boolean;
  onSignIn?: () => void;
  onSignOut?: () => void;
  onOpenProfile?: () => void;
  onOpenPaymentMethods?: () => void;
  onSwitchMode?: () => void;
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((part) => part?.[0]?.toUpperCase() ?? "").join("") || "?";
}

export function AccountScreen({
  session,
  mode = "customer",
  loading = false,
  onSignIn,
  onSignOut,
  onOpenProfile,
  onOpenPaymentMethods,
  onSwitchMode,
}: AccountScreenProps) {
  const user = session?.user;
  const switchLabel = mode === "customer" ? "Switch to business mode" : "Switch to customer mode";

  return (
    <Screen title="Account">
      {user ? (
        <Card style={styles.profile}>
          <View style={styles.avatar} accessible={false}>
            <Text variant="title" tone="onPrimary" accessibilityRole="text">
              {initialsOf(user.name)}
            </Text>
          </View>
          <View style={styles.profileText}>
            <Text variant="heading" accessibilityRole="text">
              {user.name}
            </Text>
            {user.email || user.phone ? (
              <Text variant="small" tone="muted" numberOfLines={1}>
                {user.email ?? user.phone}
              </Text>
            ) : null}
            <View style={styles.modeBadge}>
              <Badge
                size="sm"
                label={mode === "customer" ? "Customer" : "Business"}
                icon={mode === "customer" ? icons.person : icons.business}
                iconColor={colors.primary}
                background={colors.tabPill}
              />
            </View>
          </View>
        </Card>
      ) : (
        <Card style={styles.signIn}>
          <View style={styles.signInIcon}>
            <Icon name={icons.account} size={28} color={colors.primary} />
          </View>
          <Text variant="heading">Sign in to book and chat</Text>
          <Text tone="muted">
            Save your address, keep track of visits and message businesses — with email or a text
            code.
          </Text>
          <Button
            label="Sign in or create account"
            fullWidth
            loading={loading}
            onPress={onSignIn}
            disabled={!onSignIn}
          />
        </Card>
      )}

      <Card flush style={styles.rows}>
        <ListRow
          label="Profile"
          description="Name, phone and saved addresses"
          icon={icons.person}
          onPress={onOpenProfile}
          disabled={!onOpenProfile}
        />
        <ListRow
          divider
          label="Payment methods"
          description="Cards are stored securely by Stripe"
          icon={icons.card}
          onPress={onOpenPaymentMethods}
          disabled={!onOpenPaymentMethods}
        />
        <ListRow
          divider
          label={switchLabel}
          description={
            mode === "customer"
              ? "Manage your services, calendar and crew"
              : "Find and book local pros"
          }
          icon={icons.switchMode}
          onPress={onSwitchMode}
          disabled={!onSwitchMode}
        />
      </Card>

      {user ? (
        <Card flush style={styles.rows}>
          <ListRow
            destructive
            label="Sign out"
            icon={icons.signOut}
            onPress={onSignOut}
            disabled={!onSignOut || loading}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  profileText: { flex: 1, minWidth: 0, gap: 2 },
  modeBadge: { marginTop: 6 },
  signIn: { gap: space.sm, alignItems: "flex-start" },
  signInIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: colors.tabPill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  rows: { marginTop: space.lg, overflow: "hidden" },
});
