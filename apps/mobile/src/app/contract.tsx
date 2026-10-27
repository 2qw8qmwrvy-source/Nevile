import { formatCad } from "@nevile/core";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { AddressFields, addressProblem, useJobAddress } from "@/components/address-fields.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { CardOnFile } from "@/components/card-on-file.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { icons } from "@/components/icon.tsx";
import { RadioCard } from "@/components/radio-card.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { VerificationBanner } from "@/components/verification-banner.tsx";
import { Checkbox, FormAlert } from "@/lib/auth-ui.tsx";
import { useMe } from "@/lib/me.ts";
import { askForPush } from "@/lib/push.ts";
import { useTRPC, useTRPCClient } from "@/lib/trpc.tsx";
import { apiErrorMessage, apiFieldErrors } from "@/lib/trpc-client.ts";
import { useEmailVerification } from "@/lib/verification.ts";
import { colors, radius, space } from "@/theme";
import { enterUp } from "@/theme/motion.ts";

type Plan = "upfront" | "monthly";

const PLANS = [
  { value: "upfront", label: "Upfront", hint: "The whole season when the pro accepts." },
  {
    value: "monthly",
    label: "Monthly",
    hint: "This month when the pro accepts, then each month on the 1st.",
  },
] as const satisfies readonly { value: Plan; label: string; hint: string }[];

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant={strong ? "bodyStrong" : "body"} style={styles.grow}>
        {label}
      </Text>
      <Text variant={strong ? "bodyStrong" : "body"}>{value}</Text>
    </View>
  );
}

/**
 * Signing up for a seasonal snow contract (SPEC §21): the terms and price (and the payment
 * plan, when the pro offers both), the agreement to read and agree to, the address and the
 * saved card. A listed contract needs the pro's OK within 24 hours; a pro's own quoted
 * terms are confirmed straight away.
 */
export default function ContractRoute() {
  const params = useLocalSearchParams<{ serviceId?: string; quoteId?: string }>();
  const quoteId = params.quoteId ?? "";
  const serviceId = quoteId ? "" : (params.serviceId ?? "");
  const kind = quoteId ? "quote" : "service";
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const { user, me, session } = useMe();
  const verification = useEmailVerification();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [agreed, setAgreed] = useState(false);
  const { address, change: changeAddress } = useJobAddress(me.data?.onboarding.postalCode);
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const listed = useQuery({
    ...trpc.snow.offer.queryOptions({ serviceId, seasonPayment: plan }),
    enabled: kind === "service" && Boolean(serviceId),
    placeholderData: keepPreviousData,
  });
  const quoted = useQuery({
    ...trpc.snow.quoteOffer.queryOptions({ quoteId, seasonPayment: plan }),
    enabled: kind === "quote" && user !== null,
    placeholderData: keepPreviousData,
  });
  const offer = kind === "service" ? listed : quoted;
  const card = useQuery({ ...trpc.cards.get.queryOptions(), enabled: user !== null });
  const signedUp = {
    onSuccess: ({ bookingId }: { bookingId: string }) => {
      void queryClient.invalidateQueries({ queryKey: trpc.bookings.list.queryKey() });
      router.replace({ pathname: "/bookings/[id]", params: { id: bookingId, new: "1" } });
      void askForPush(client);
    },
  };
  const signUp = useMutation(trpc.snow.signUp.mutationOptions(signedUp));
  const signUpQuote = useMutation(trpc.snow.signUpFromQuote.mutationOptions(signedUp));
  const sending = kind === "service" ? signUp : signUpQuote;
  const data = offer.data;
  const choosesPlan = data?.terms.pricing === "season" && data.terms.seasonBilling === "either";

  const back = () => (router.canGoBack() ? router.back() : router.replace("/search"));
  const header = (
    <TopBar leading={<IconButton icon={topBarIcons.back} label="Back" onPress={back} />} />
  );

  function send() {
    setProblem(null);
    const addressIssue = addressProblem(address);
    if (addressIssue) {
      setProblem(addressIssue);
      return;
    }
    if (choosesPlan && !plan) {
      setProblem("Choose to pay upfront or monthly.");
      return;
    }
    if (!agreed) {
      setProblem("Read the agreement and tick “I agree” to sign up.");
      return;
    }
    const input = { address, notes, seasonPayment: plan, agreed: true as const };
    if (kind === "quote") signUpQuote.mutate({ ...input, quoteId });
    else signUp.mutate({ ...input, serviceId });
  }

  if (session.isPending) {
    return (
      <Screen edges={["top", "bottom", "left", "right"]} header={header}>
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
      </Screen>
    );
  }
  if (!user) {
    return (
      <Screen edges={["top", "bottom", "left", "right"]} header={header}>
        <EmptyState
          icon={icons.bookings}
          title="Sign in to sign up"
          message="Snow contracts need a Nevile account and a saved card."
          action={<Button label="Sign in" onPress={() => router.push("/sign-in")} />}
        />
      </Screen>
    );
  }

  const locked = me.data?.verified === false;
  const fieldErrors = sending.error ? apiFieldErrors(sending.error) : {};
  const sendError =
    problem ??
    (sending.error
      ? (fieldErrors.address ?? fieldErrors.agreed ?? apiErrorMessage(sending.error))
      : null);
  const closed = data && !data.open;

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      avoidKeyboard
      header={header}
      footer={
        data && !closed ? (
          <View style={styles.footer}>
            {sendError ? <FormAlert tone="error" message={sendError} /> : null}
            <Button
              label="Sign up"
              fullWidth
              loading={sending.isPending || sending.isSuccess}
              disabled={locked || !card.data}
              onPress={send}
            />
            {!card.data && !card.isPending ? (
              <Text variant="small" tone="muted" style={styles.center}>
                Add a card above to continue.
              </Text>
            ) : null}
          </View>
        ) : null
      }
    >
      {offer.isPending ? (
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading"
          style={styles.spinner}
        />
      ) : offer.isError || !data ? (
        <View style={styles.section}>
          <FormAlert
            tone="error"
            message={
              offer.error
                ? apiErrorMessage(offer.error, "We couldn't load this contract right now.")
                : "This contract isn't available."
            }
          />
          <Button label="Try again" variant="secondary" onPress={() => offer.refetch()} />
        </View>
      ) : closed ? (
        <EmptyState
          icon={icons.bookings}
          title={data.seasonOver ? "This season is over" : "Sign-ups are closed"}
          message={
            data.seasonOver
              ? "Look for next winter's contract later in the year."
              : data.spotsLeft === 0
                ? "No spots left on this contract. Ask the pro for a quote, or find another pro nearby."
                : `${data.business.name} isn't taking new sign-ups right now.`
          }
          action={<Button label="Back" variant="secondary" onPress={back} />}
        />
      ) : (
        <Animated.View entering={enterUp} style={styles.page}>
          <View style={styles.section}>
            <Text variant="display">{data.service.title}</Text>
            <Text tone="muted">with {data.business.name}</Text>
          </View>

          {locked ? (
            <VerificationBanner
              email={verification.email}
              sending={verification.sending}
              cooldown={verification.cooldown}
              notice={verification.notice}
              onResend={() => void verification.resend()}
            />
          ) : null}

          <Card style={styles.section}>
            <Text variant="heading">The contract</Text>
            <Line label="Season" value={data.terms.season} />
            <Line label="Cleared when" value={`Snowfall reaches ${data.terms.triggerCm} cm`} />
            <Line
              label="Price"
              value={`${formatCad(data.terms.priceCents)} ${
                data.terms.pricing === "season" ? "for the season" : "per visit"
              }`}
            />
            {data.spotsLeft !== null ? (
              <Line label="Spots left" value={String(data.spotsLeft)} />
            ) : null}
            {data.service.description ? <Text tone="muted">{data.service.description}</Text> : null}
          </Card>

          {choosesPlan ? (
            <Card style={styles.section}>
              <Text variant="heading">How you pay</Text>
              <View accessibilityRole="radiogroup" style={styles.choices}>
                {PLANS.map((option) => (
                  <RadioCard
                    key={option.value}
                    label={option.label}
                    description={option.hint}
                    checked={plan === option.value}
                    onPress={() => setPlan(option.value)}
                  />
                ))}
              </View>
            </Card>
          ) : null}

          <CardOnFile
            charged="Charged to"
            missing="Contracts are charged to a saved card. Add one to continue."
          />

          <AddressFields
            hint="The pro sees the address once the contract is confirmed."
            address={address}
            onChange={changeAddress}
            notes={notes}
            onNotes={setNotes}
          />

          <Card style={styles.section}>
            <Text variant="heading">The agreement</Text>
            <Text variant="small" tone="muted">
              Please read it. You and the pro both get a PDF copy by email.
            </Text>
            <ScrollView
              nestedScrollEnabled
              style={styles.agreement}
              contentContainerStyle={styles.agreementText}
              accessibilityLabel="Agreement text"
            >
              {data.agreement.map((section) => (
                <View key={section.heading} style={styles.clause}>
                  <Text variant="bodyStrong">{section.heading}</Text>
                  {section.paragraphs.map((paragraph) => (
                    <Text key={paragraph}>{paragraph}</Text>
                  ))}
                </View>
              ))}
            </ScrollView>
            <Checkbox
              label="I agree to this agreement"
              description="Ticking this is your signature."
              checked={agreed}
              onChange={setAgreed}
            />
          </Card>

          <Card style={styles.section}>
            <Text variant="heading">Summary</Text>
            {data.price ? (
              <>
                <Line
                  label={data.terms.pricing === "season" ? "Season price" : "Each visit"}
                  value={formatCad(data.price.priceCents)}
                />
                <Line label="Service fee" value={formatCad(data.price.serviceFeeCents)} />
                {data.price.taxCents > 0 ? (
                  <Line label="HST" value={formatCad(data.price.taxCents)} />
                ) : null}
                <View style={styles.total}>
                  <Line
                    label={data.terms.pricing === "season" ? "Total" : "Per visit"}
                    value={formatCad(data.price.totalCents)}
                    strong
                  />
                </View>
              </>
            ) : null}
            {data.seasonPayment === "monthly"
              ? data.instalments.map((instalment) => (
                  <Line
                    key={instalment.label}
                    label={instalment.label}
                    value={`${formatCad(instalment.totalCents)}, ${instalment.charged}`}
                  />
                ))
              : null}
            <Text variant="small" tone="muted">
              {kind === "quote"
                ? "Confirmed straight away: these are the pro's own terms."
                : "Needs the pro's OK. Nothing is charged until they accept (within 24 hours)."}
            </Text>
          </Card>
        </Animated.View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginVertical: space.xl },
  page: { gap: space.lg },
  section: { gap: 10 },
  choices: { gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  center: { textAlign: "center" },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  agreement: {
    maxHeight: 360,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ground,
  },
  agreementText: { gap: 14, padding: 14 },
  clause: { gap: 4 },
  footer: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
