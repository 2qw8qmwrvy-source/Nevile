import {
  BUSINESS_NAME_MAX_LENGTH,
  LAUNCH_PROVINCES,
  MARKETING_CONSENT_SENDER,
  MARKETING_CONSENT_STATEMENT,
  PROVINCES,
  type ProvinceCode,
} from "@nevile/core";
import { type ReactNode, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, type TextInputInstance, View } from "react-native";

import { Badge } from "@/components/badge.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Icon, icons } from "@/components/icon.tsx";
import { ListRow } from "@/components/list-row.tsx";
import { PressableScale } from "@/components/pressable-scale.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import {
  VerificationBanner,
  type VerificationBannerProps,
} from "@/components/verification-banner.tsx";
import { Checkbox, FormAlert, TextField } from "@/lib/auth-ui.tsx";
import type { LegalPage } from "@/lib/links.ts";
import { NEIGHBOURS_COPY } from "@/lib/neighbours.ts";
import { colors, space } from "@/theme";

/** The minimal user shape the account screen renders; the route maps its session to this. */
export type AccountUser = {
  /** Empty for accounts created by phone that haven't added a name yet. */
  name: string;
  email?: string | null;
  emailVerified?: boolean;
  /** Display-formatted, e.g. "(902) 555-0123". */
  phone?: string | null;
  phoneVerified?: boolean;
};

export type AccountSession = {
  user: AccountUser;
};

/** SPEC §1: one login can act as a customer or a business. */
export type AccountMode = "customer" | "business";

export type AccountBusiness = {
  id: string;
  name: string;
  /** e.g. "Owner" */
  roleLabel: string;
  /** e.g. "Nova Scotia" */
  place: string;
};

export type BusinessFormInput = { name: string; province: ProvinceCode };

/** Nevile launches in Nova Scotia only (SPEC §2): new businesses are set up there. */
const LAUNCH_PROVINCE = LAUNCH_PROVINCES[0];
export type BusinessFormErrors = { name?: string; province?: string; form?: string };

export type AccountScreenProps = {
  /** `null`/`undefined` renders the signed-out state. */
  session?: AccountSession | null;
  mode?: AccountMode;
  /** True while the stored session is being restored. */
  loading?: boolean;
  signingOut?: boolean;
  /** Businesses the user belongs to; `undefined` while they load. */
  businesses?: readonly AccountBusiness[];
  /** Shown instead of the business section when the account details failed to load. */
  businessesError?: string | null;
  onRetry?: () => void;
  creatingBusiness?: boolean;
  businessErrors?: BusinessFormErrors;
  onCreateBusiness?: (input: BusinessFormInput) => void;
  /** Opens the business tools for one of the person's businesses. */
  onOpenBusiness?: (businessId: string) => void;
  onSignIn?: () => void;
  onCreateAccount?: () => void;
  onSignOut?: () => void;
  onOpenProfile?: () => void;
  onOpenPaymentMethods?: () => void;
  /** Set while the account has no verified contact (SPEC §1): banner + business gate. */
  verification?: VerificationBannerProps | null;
  /** Postal code and interests from the welcome (SPEC §16). */
  preferences?: { postalCode: string | null; interests: readonly string[] };
  onOpenPreferences?: () => void;
  /** CASL marketing consent (SPEC §17); one tap to give or withdraw. */
  marketingConsent?: { consented: boolean; saving: boolean; onChange: (consent: boolean) => void };
  onOpenNeighbours?: () => void;
  onOpenLegal?: (page: LegalPage) => void;
};

const legalIcons = {
  privacy: { ios: "lock.shield", android: "shield" },
  terms: { ios: "doc.text", android: "description" },
  accessibility: { ios: "accessibility", android: "accessibility_new" },
} as const;
const preferencesIcon = { ios: "slider.horizontal.3", android: "tune" } as const;

const verifiedIcon = { ios: "checkmark.seal.fill", android: "verified" } as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((part) => part?.[0]?.toUpperCase() ?? "").join("");
}

function ContactLine({ value, verified }: { value: string; verified?: boolean }) {
  return (
    <View
      style={styles.contactLine}
      accessible
      accessibilityLabel={verified ? `${value}, confirmed` : value}
    >
      <Text variant="small" tone="muted" numberOfLines={1} style={styles.shrink}>
        {value}
      </Text>
      {verified ? <Icon name={verifiedIcon} size={14} color={colors.primary} /> : null}
    </View>
  );
}

function ProfileCard({ user, mode }: { user: AccountUser; mode: AccountMode }) {
  const name = user.name.trim();
  const initials = initialsOf(name);
  return (
    <Card style={styles.profile}>
      <View style={styles.avatar} accessible={false}>
        {initials ? (
          <Text variant="title" tone="onPrimary" accessibilityRole="text">
            {initials}
          </Text>
        ) : (
          <Icon name={icons.person} size={28} color={colors.onPrimary} />
        )}
      </View>
      <View style={styles.profileText}>
        <Text variant="heading" accessibilityRole="text">
          {name || "Your account"}
        </Text>
        {user.email ? <ContactLine value={user.email} verified={user.emailVerified} /> : null}
        {user.phone ? <ContactLine value={user.phone} verified={user.phoneVerified} /> : null}
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
  );
}

function BusinessForm({
  pending,
  errors,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  errors?: BusinessFormErrors;
  onSubmit: (input: BusinessFormInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<TextInputInstance>(null);

  function submit() {
    if (pending) return;
    if (name.trim().length < 2) {
      setNameError("Enter your business name.");
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    onSubmit({ name: name.trim(), province: LAUNCH_PROVINCE });
  }

  return (
    <View style={styles.businessForm}>
      <Text tone="muted">
        Tell us about your business. You can add services, your team and payout details next.
      </Text>
      {errors?.form ? <FormAlert tone="error" message={errors.form} /> : null}
      <TextField
        ref={nameRef}
        label="Business name"
        value={name}
        onChangeText={(value) => {
          setName(value);
          if (nameError) setNameError(null);
        }}
        error={nameError ?? errors?.name}
        maxLength={BUSINESS_NAME_MAX_LENGTH}
        autoCapitalize="words"
        autoComplete="organization"
        textContentType="organizationName"
        returnKeyType="done"
        editable={!pending}
        autoFocus
      />
      <View style={styles.provinceField} accessible>
        <Text variant="bodyStrong">{PROVINCES[LAUNCH_PROVINCE].name}</Text>
        <Text variant="small" tone="muted">
          Nevile is only in Nova Scotia for now. You'll set your exact service area when you add
          your services.
        </Text>
        {errors?.province ? (
          <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
            {errors.province}
          </Text>
        ) : null}
      </View>
      <Button
        label={pending ? "Setting up your business…" : "Create business and switch"}
        fullWidth
        loading={pending}
        onPress={submit}
      />
      <Button variant="ghost" label="Not now" fullWidth disabled={pending} onPress={onCancel} />
    </View>
  );
}

function BusinessSection({
  businesses,
  error,
  onRetry,
  creating,
  errors,
  onCreate,
  onOpenBusiness,
  verificationNeeded,
}: {
  businesses?: readonly AccountBusiness[];
  error?: string | null;
  onRetry?: () => void;
  creating: boolean;
  errors?: BusinessFormErrors;
  onCreate?: (input: BusinessFormInput) => void;
  onOpenBusiness?: (businessId: string) => void;
  verificationNeeded: boolean;
}) {
  const [formOpen, setFormOpen] = useState(false);

  let content: ReactNode;
  if (error) {
    content = (
      <>
        <FormAlert tone="error" message={error} />
        {onRetry ? <Button variant="secondary" label="Try again" onPress={onRetry} /> : null}
      </>
    );
  } else if (!businesses) {
    content = (
      <ActivityIndicator
        color={colors.primary}
        accessibilityLabel="Loading your businesses"
        style={styles.spinner}
      />
    );
  } else if (businesses.length > 0) {
    content = (
      <>
        <Text tone="muted">Your calendar, quotes, listing, team and payouts.</Text>
        <View style={styles.businessList}>
          {businesses.map((business) => (
            <PressableScale
              key={business.id}
              style={styles.businessRow}
              accessibilityRole="button"
              accessibilityLabel={`${business.name}, ${business.roleLabel}, ${business.place}`}
              accessibilityHint="Opens your business tools"
              disabled={!onOpenBusiness}
              pressedScale={0.98}
              onPress={() => onOpenBusiness?.(business.id)}
            >
              <View style={styles.businessIcon}>
                <Icon name={icons.business} size={20} color={colors.primary} />
              </View>
              <View style={styles.shrink}>
                <Text variant="bodyStrong">{business.name}</Text>
                <Text variant="small" tone="muted">
                  {business.roleLabel} · {business.place}
                </Text>
              </View>
              <Icon name={icons.chevronRight} size={16} color={colors.muted} />
            </PressableScale>
          ))}
        </View>
      </>
    );
  } else if (verificationNeeded) {
    content = (
      <FormAlert
        tone="info"
        message="Confirm your email to switch to business mode. Use the link we sent you, or resend it above."
      />
    );
  } else if (formOpen && onCreate) {
    content = (
      <BusinessForm
        pending={creating}
        errors={errors}
        onSubmit={onCreate}
        onCancel={() => setFormOpen(false)}
      />
    );
  } else {
    content = (
      <>
        <Text tone="muted">
          List your services, take bookings and get paid every Monday. Teams are free on every plan.
        </Text>
        <Button
          label="Switch to business mode"
          icon={icons.switchMode}
          fullWidth
          disabled={!onCreate}
          onPress={() => setFormOpen(true)}
        />
      </>
    );
  }

  return (
    <Card style={styles.section}>
      <Text variant="heading">Business mode</Text>
      {content}
    </Card>
  );
}

export function AccountScreen({
  session,
  mode = "customer",
  loading = false,
  signingOut = false,
  businesses,
  businessesError,
  onRetry,
  creatingBusiness = false,
  businessErrors,
  onCreateBusiness,
  onOpenBusiness,
  onSignIn,
  onCreateAccount,
  onSignOut,
  onOpenProfile,
  onOpenPaymentMethods,
  verification,
  preferences,
  onOpenPreferences,
  marketingConsent,
  onOpenNeighbours,
  onOpenLegal,
}: AccountScreenProps) {
  const user = session?.user;

  if (!user) {
    return (
      <Screen title="Account">
        <Card style={styles.signIn}>
          <View style={styles.signInIcon}>
            <Icon name={icons.account} size={28} color={colors.primary} />
          </View>
          <Text variant="heading">Sign in to book and chat</Text>
          <Text tone="muted">
            Save your address, keep track of visits and message businesses — with email or a text
            code.
          </Text>
          <View style={styles.actions}>
            <Button
              label="Sign in"
              fullWidth
              loading={loading}
              onPress={onSignIn}
              disabled={!onSignIn}
            />
            <Button
              label="Create account"
              variant="secondary"
              fullWidth
              disabled={loading || !onCreateAccount}
              onPress={onCreateAccount}
            />
          </View>
        </Card>

        <Card style={[styles.section, styles.spaced]}>
          <View style={styles.teaserIcon}>
            <Icon name={icons.business} size={22} color={colors.primary} />
          </View>
          <Text variant="heading">Run a home services business?</Text>
          <Text tone="muted">
            Create an account, then switch to business mode to list services and take bookings.
            Teams are free on every plan.
          </Text>
        </Card>

        <MoreRows onOpenNeighbours={onOpenNeighbours} onOpenLegal={onOpenLegal} />
      </Screen>
    );
  }

  return (
    <Screen title="Account">
      <ProfileCard user={user} mode={mode} />

      {verification ? (
        <View style={styles.spaced}>
          <VerificationBanner {...verification} />
        </View>
      ) : null}

      <View style={styles.spaced}>
        <BusinessSection
          verificationNeeded={Boolean(verification)}
          businesses={businesses}
          error={businessesError}
          onRetry={onRetry}
          creating={creatingBusiness}
          errors={businessErrors}
          onCreate={onCreateBusiness}
          onOpenBusiness={onOpenBusiness}
        />
      </View>

      <Card flush style={[styles.rows, styles.spaced]}>
        <ListRow
          label="Profile"
          description="Name, phone and saved addresses"
          icon={icons.person}
          onPress={onOpenProfile}
          disabled={!onOpenProfile}
        />
        <ListRow
          divider
          label="Payment method"
          description="Your saved card for recurring visits and snow contracts"
          icon={icons.card}
          onPress={onOpenPaymentMethods}
          disabled={!onOpenPaymentMethods}
        />
        <ListRow
          divider
          label="Your preferences"
          description={
            preferences?.postalCode
              ? `${preferences.postalCode} · ${
                  preferences.interests.length === 0
                    ? "no services picked"
                    : `${preferences.interests.length} service${preferences.interests.length === 1 ? "" : "s"} picked`
                }`
              : "Postal code and the services you need"
          }
          icon={preferencesIcon}
          onPress={onOpenPreferences}
          disabled={!onOpenPreferences}
        />
      </Card>

      {marketingConsent ? (
        <Card style={[styles.section, styles.spaced]}>
          <Text variant="heading">Email updates</Text>
          <Checkbox
            checked={marketingConsent.consented}
            onChange={marketingConsent.onChange}
            label={MARKETING_CONSENT_STATEMENT}
            description={MARKETING_CONSENT_SENDER}
            disabled={marketingConsent.saving}
          />
        </Card>
      ) : null}

      <MoreRows onOpenNeighbours={onOpenNeighbours} onOpenLegal={onOpenLegal} />

      <Card flush style={[styles.rows, styles.spaced]}>
        <ListRow
          destructive
          label={signingOut ? "Signing out…" : "Sign out"}
          icon={icons.signOut}
          onPress={onSignOut}
          disabled={!onSignOut || signingOut}
          accessibilityState={{ busy: signingOut, disabled: !onSignOut || signingOut }}
        />
      </Card>
    </Screen>
  );
}

/** Nevile Neighbours and the legal pages (SPEC §15, §17), signed in or not. */
function MoreRows({
  onOpenNeighbours,
  onOpenLegal,
}: {
  onOpenNeighbours?: () => void;
  onOpenLegal?: (page: LegalPage) => void;
}) {
  return (
    <Card flush style={[styles.rows, styles.spaced]}>
      <ListRow
        label={NEIGHBOURS_COPY.name}
        description="Our community program"
        icon={NEIGHBOURS_COPY.icon}
        onPress={onOpenNeighbours}
        disabled={!onOpenNeighbours}
      />
      <ListRow
        divider
        label="Privacy Policy"
        icon={legalIcons.privacy}
        onPress={() => onOpenLegal?.("privacy")}
        disabled={!onOpenLegal}
        accessibilityHint="Opens the page in your browser"
      />
      <ListRow
        divider
        label="Terms of Service"
        icon={legalIcons.terms}
        onPress={() => onOpenLegal?.("terms")}
        disabled={!onOpenLegal}
        accessibilityHint="Opens the page in your browser"
      />
      <ListRow
        divider
        label="Accessibility"
        icon={legalIcons.accessibility}
        onPress={() => onOpenLegal?.("accessibility")}
        disabled={!onOpenLegal}
        accessibilityHint="Opens the page in your browser"
      />
    </Card>
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
  contactLine: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
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
  actions: { alignSelf: "stretch", gap: space.sm, marginTop: space.sm },
  teaserIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.ground,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { gap: space.md },
  spaced: { marginTop: space.lg },
  spinner: { alignSelf: "flex-start", marginVertical: space.sm },
  businessList: { gap: space.sm },
  businessRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ground,
  },
  businessIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  businessForm: { gap: space.md },
  provinceField: {
    gap: 4,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ground,
  },
  rows: { overflow: "hidden" },
});
