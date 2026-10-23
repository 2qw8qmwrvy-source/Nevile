import { PROVINCES } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Alert } from "react-native";

import { authClient, callAuth, contactEmail, formatPhone, useSession } from "@/lib/auth.ts";
import { openLegalPage, openWebsitePage } from "@/lib/links.ts";
import { useUpdateMe } from "@/lib/me.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import {
  apiErrorCode,
  apiErrorMessage,
  apiErrorReason,
  apiFieldErrors,
} from "@/lib/trpc-client.ts";
import { useEmailVerification } from "@/lib/verification.ts";
import {
  type AccountBusiness,
  AccountScreen,
  type AccountSession,
  type BusinessFormErrors,
} from "@/screens/account-screen.tsx";

const ROLE_LABELS = { owner: "Owner", manager: "Manager", crew: "Crew" } as const;

function comingSoon(feature: string) {
  Alert.alert(feature, "This is coming soon.");
}

export default function AccountRoute() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: session, isPending: sessionPending, refetch: refetchSession } = useSession();
  const user = session?.user ?? null;
  const [signingOut, setSigningOut] = useState(false);

  const me = useQuery({ ...trpc.me.get.queryOptions(), enabled: user !== null });
  const meQueryKey = trpc.me.get.queryKey();
  const updateMe = useUpdateMe();
  const verification = useEmailVerification();

  const setConsent = useMutation(
    trpc.profile.setMarketingConsent.mutationOptions({
      onSuccess: (marketingConsent) => {
        updateMe((current) => ({ ...current, marketingConsent }));
        AccessibilityInfo.announceForAccessibility(
          marketingConsent.consented
            ? "You're subscribed to Nevile emails."
            : "You're unsubscribed from Nevile emails.",
        );
      },
      onError: (error) => Alert.alert("Couldn't save that", apiErrorMessage(error, "Try again.")),
    }),
  );

  // The server no longer accepts the stored session (expired or revoked elsewhere): reload
  // it, which signs this device out if the server agrees.
  const unauthorized = apiErrorCode(me.error) === "UNAUTHORIZED";
  useEffect(() => {
    if (unauthorized) void refetchSession();
  }, [unauthorized, refetchSession]);

  const createBusiness = useMutation(
    trpc.business.create.mutationOptions({
      onSuccess: async (business) => {
        await queryClient.invalidateQueries({ queryKey: meQueryKey });
        AccessibilityInfo.announceForAccessibility(
          `${business.name} is set up. You're now in business mode.`,
        );
      },
      onError: (error) => {
        // "You already have a business", or the email was confirmed elsewhere: refresh.
        if (
          apiErrorCode(error) === "CONFLICT" ||
          apiErrorReason(error) === "VERIFICATION_REQUIRED"
        ) {
          void queryClient.invalidateQueries({ queryKey: meQueryKey });
        }
      },
    }),
  );

  let accountSession: AccountSession | null = null;
  if (user) {
    // Prefer the API's view (it hides placeholder emails); fall back to the cached session.
    const account = me.data?.user;
    const email = account ? account.email : contactEmail(user.email);
    const phone = account ? account.phoneNumber : (user.phoneNumber ?? null);
    accountSession = {
      user: {
        name: account?.name ?? user.name,
        email,
        emailVerified: account ? account.emailVerified : Boolean(email && user.emailVerified),
        phone: phone ? formatPhone(phone) : null,
        phoneVerified: account ? account.phoneNumberVerified : Boolean(user.phoneNumberVerified),
      },
    };
  }

  const businesses: AccountBusiness[] | undefined = me.data?.businesses.map(
    ({ business, role }) => ({
      id: business.id,
      name: business.name,
      roleLabel: ROLE_LABELS[role],
      place: PROVINCES[business.province].name,
    }),
  );

  let businessErrors: BusinessFormErrors | undefined;
  if (createBusiness.error) {
    const fields = apiFieldErrors(createBusiness.error);
    businessErrors = {
      name: fields.name,
      province: fields.province,
      form:
        fields.name || fields.province
          ? undefined
          : apiErrorMessage(
              createBusiness.error,
              "We couldn't set up your business. Please try again.",
            ),
    };
  }

  async function signOut() {
    setSigningOut(true);
    // The Expo plugin forgets the stored session before the request is sent, so this device
    // is signed out even when the server can't be reached.
    const { error } = await callAuth(() => authClient.signOut());
    if (error) console.warn("[auth] sign-out request failed", error.status, error.code);
    setSigningOut(false);
  }

  function confirmSignOut() {
    Alert.alert("Sign out?", "You'll need to sign in again to book or message businesses.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  }

  return (
    <AccountScreen
      session={accountSession}
      mode={me.data?.profile?.activeMode ?? "customer"}
      loading={sessionPending}
      signingOut={signingOut}
      businesses={businesses}
      businessesError={
        me.error ? apiErrorMessage(me.error, "We couldn't load your account details.") : null
      }
      onRetry={() => void me.refetch()}
      creatingBusiness={createBusiness.isPending}
      businessErrors={businessErrors}
      onCreateBusiness={(input) => createBusiness.mutate(input)}
      onManageListing={() => void openWebsitePage("/business")}
      onSignIn={() => router.push("/sign-in")}
      onCreateAccount={() => router.push("/sign-up")}
      onSignOut={confirmSignOut}
      onOpenProfile={() => comingSoon("Profile")}
      onOpenPaymentMethods={() => comingSoon("Payment methods")}
      verification={
        verification.needed
          ? {
              email: verification.email,
              sending: verification.sending,
              cooldown: verification.cooldown,
              notice: verification.notice,
              onResend: () => void verification.resend(),
            }
          : null
      }
      preferences={
        me.data
          ? { postalCode: me.data.onboarding.postalCode, interests: me.data.onboarding.interests }
          : undefined
      }
      onOpenPreferences={() => router.push("/welcome")}
      marketingConsent={
        me.data
          ? {
              consented: setConsent.isPending
                ? Boolean(setConsent.variables?.consent)
                : me.data.marketingConsent.consented,
              saving: setConsent.isPending,
              onChange: (consent) => setConsent.mutate({ consent }),
            }
          : undefined
      }
      onOpenNeighbours={() => router.push("/neighbours")}
      onOpenLegal={(page) => void openLegalPage(page)}
    />
  );
}
