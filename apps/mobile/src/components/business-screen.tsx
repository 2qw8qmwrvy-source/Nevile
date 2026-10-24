import { router } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { FormAlert } from "@/lib/auth-ui.tsx";
import { type Membership, useBusiness } from "@/lib/business.ts";
import { colors, space } from "@/theme";

import { Button } from "./button.tsx";
import { Chip } from "./chip.tsx";
import { EmptyState } from "./empty-state.tsx";
import { icons } from "./icon.tsx";
import { Screen, type ScreenProps } from "./screen.tsx";
import { IconButton, TopBar, topBarIcons } from "./top-bar.tsx";

type BusinessScreenProps = Omit<ScreenProps, "children" | "header" | "footer" | "edges"> & {
  businessId: string | undefined;
  /** Owners and managers only (quotes, payouts). */
  managed?: boolean;
  /** Show a switcher when the person belongs to several businesses. */
  switcher?: boolean;
  children: (membership: Membership) => ReactNode;
  footer?: (membership: Membership) => ReactNode;
  /** Where Back goes when there's no screen to return to. */
  fallback?: () => void;
};

/**
 * Frame for every business tool: Back, the business switcher, and the states before the
 * tool can show (signed out, loading, no business, unconfirmed email, wrong role).
 */
export function BusinessScreen({
  businessId,
  managed = false,
  switcher = false,
  children,
  footer,
  fallback,
  ...screen
}: BusinessScreenProps) {
  const state = useBusiness(businessId, { managed });
  const back = () =>
    router.canGoBack() ? router.back() : (fallback ?? (() => router.replace("/account")))();
  const header = (
    <TopBar leading={<IconButton icon={topBarIcons.back} label="Back" onPress={back} />} />
  );
  const current = state.current;

  let body: ReactNode;
  if (!state.signedIn) {
    body = (
      <EmptyState
        icon={icons.business}
        title="Sign in to use your business tools"
        message="Your calendar, quotes, listing, team and payouts live in your Nevile account."
        action={<Button label="Sign in" onPress={() => router.push("/sign-in")} />}
      />
    );
  } else if (state.loading) {
    body = <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  } else if (state.error) {
    body = <FormAlert tone="error" message="We couldn't load your businesses right now." />;
  } else if (!state.verified) {
    body = (
      <FormAlert
        tone="info"
        message="Confirm your email address or phone number to use your business tools."
      />
    );
  } else if (!current) {
    body = (
      <EmptyState
        icon={icons.business}
        title={managed ? "For owners and managers" : "No business yet"}
        message={
          managed
            ? "Ask the owner of your business if you need this."
            : "Set up your business from your account to list services and take bookings."
        }
        action={
          <Button
            label="Go to Account"
            variant="secondary"
            onPress={() => router.navigate("/account")}
          />
        }
      />
    );
  }

  const switchable = switcher && current && state.memberships.length > 1;
  return (
    <Screen
      {...screen}
      edges={["top", "bottom", "left", "right"]}
      header={header}
      footer={current && !body && footer ? footer(current) : undefined}
    >
      {body ?? (
        <View style={styles.page}>
          {switchable ? (
            <View style={styles.switcher} accessibilityLabel="Your businesses">
              {state.memberships.map((membership) => (
                <Chip
                  key={membership.business.id}
                  label={membership.business.name}
                  selected={membership.business.id === current.business.id}
                  onPress={() => router.setParams({ businessId: membership.business.id })}
                />
              ))}
            </View>
          ) : null}
          {current ? children(current) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { gap: space.lg },
  switcher: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
