import { addCalendarDays, formatCad, formatIsoDate, parseIsoDate } from "@nevile/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { AddressFields, addressProblem, useJobAddress } from "@/components/address-fields.tsx";
import { Badge } from "@/components/badge.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { asDate, DayWindowPicker, longDay } from "@/components/day-window-picker.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { icons } from "@/components/icon.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { VerificationBanner } from "@/components/verification-banner.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { type BookingView, quoteView, serviceView } from "@/lib/booking-view.ts";
import { useMe } from "@/lib/me.ts";
import {
  type AppCheckout,
  outcomeProblem,
  presentStripeSheet,
  settleCheckout,
} from "@/lib/payments.ts";
import { askForPush } from "@/lib/push.ts";
import { useTRPC, useTRPCClient } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { useEmailVerification } from "@/lib/verification.ts";
import { colors, space } from "@/theme";
import { enterUp } from "@/theme/motion.ts";

const DAYS_PER_PAGE = 7;
/** Reuse a started payment for this long (the server holds the time for 30 minutes). */
const REUSE_CHECKOUT_MS = 20 * 60_000;
function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant={strong ? "bodyStrong" : "body"}>{label}</Text>
      <Text variant={strong ? "bodyStrong" : "body"}>{value}</Text>
    </View>
  );
}

/**
 * Book a pro's fixed-price service or an accepted quote, and pay inside the app
 * (SPEC §19, §20): a day, an arrival window, the address, then the payment sheet.
 * The server re-checks everything.
 */
export default function BookRoute() {
  const params = useLocalSearchParams<{ serviceId?: string; quoteId?: string }>();
  const quoteId = params.quoteId ?? "";
  const serviceId = quoteId ? "" : (params.serviceId ?? "");
  const kind = quoteId ? "quote" : "service";
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const { user, me, session } = useMe();
  const verification = useEmailVerification();

  const [from, setFrom] = useState<string | undefined>(undefined);
  const [date, setDate] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const { address, change: changeAddress } = useJobAddress(me.data?.onboarding.postalCode);
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<{ key: string; at: number; checkout: AppCheckout } | null>(null);

  const serviceOptions = useQuery({
    ...trpc.bookings.availability.queryOptions({ serviceId, from, days: DAYS_PER_PAGE }),
    enabled: kind === "service" && Boolean(serviceId) && user !== null,
  });
  const quoteOptions = useQuery({
    ...trpc.quotes.bookingOptions.queryOptions({ quoteId, from, days: DAYS_PER_PAGE }),
    enabled: kind === "quote" && user !== null,
  });
  const options = kind === "service" ? serviceOptions : quoteOptions;
  const data: BookingView | null =
    kind === "service"
      ? serviceOptions.data
        ? serviceView(serviceOptions.data)
        : null
      : quoteOptions.data
        ? quoteView(quoteOptions.data)
        : null;
  const day = data?.days.find((candidate) => candidate.date === date) ?? null;
  const chosenWindow = day?.windows.find((window) => window.startMinute === windowStart) ?? null;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/search"));

  function page(by: number) {
    const start = parseIsoDate(data?.days[0]?.date ?? data?.firstDate ?? "");
    if (!start) return;
    setFrom(formatIsoDate(addCalendarDays(start, by * DAYS_PER_PAGE)));
    setDate(null);
    setWindowStart(null);
  }

  async function finish(checkoutId: string) {
    const outcome = await settleCheckout(() =>
      client.bookings.finishAppCheckout.mutate({ checkoutId }),
    );
    void queryClient.invalidateQueries({ queryKey: trpc.bookings.list.queryKey() });
    if (outcome.status === "booked" || outcome.status === "requested") {
      setHeld(null);
      router.replace({ pathname: "/bookings/[id]", params: { id: outcome.bookingId, new: "1" } });
      void askForPush(client);
      return;
    }
    setHeld(null);
    if (outcome.status === "pending") {
      // Paid, but the booking isn't confirmed yet: it appears in Bookings by itself.
      Alert.alert("Payment received", outcomeProblem(outcome) ?? undefined);
      router.replace("/bookings");
      return;
    }
    setProblem(outcomeProblem(outcome));
  }

  async function pay() {
    setProblem(null);
    if (!date || windowStart === null) {
      setProblem("Pick a day and an arrival window.");
      return;
    }
    const addressIssue = addressProblem(address);
    if (addressIssue) {
      setProblem(addressIssue);
      return;
    }
    const request = { date, windowStart, address, notes };
    const key = JSON.stringify(request);
    setBusy(true);
    try {
      // Coming back after closing the payment sheet: carry on with the same payment.
      let checkout =
        held && held.key === key && Date.now() - held.at < REUSE_CHECKOUT_MS ? held.checkout : null;
      if (!checkout) {
        checkout =
          kind === "quote"
            ? await client.quotes.appCheckout.mutate({ quoteId, ...request })
            : await client.bookings.appCheckout.mutate({ serviceId, ...request });
        setHeld({ key, at: Date.now(), checkout });
      }
      if (checkout.provider !== "stripe") {
        router.push({
          pathname: "/pay-test",
          params: {
            checkoutId: checkout.checkoutId,
            amountCents: String(checkout.amountCents),
            capture: checkout.capture,
            description: checkout.description,
          },
        });
        return;
      }
      const result = await presentStripeSheet(checkout);
      if (result.kind === "canceled") {
        AccessibilityInfo.announceForAccessibility("Payment cancelled. Nothing was charged.");
        return;
      }
      if (result.kind === "failed") {
        setProblem(result.message);
        return;
      }
      await finish(checkout.checkoutId);
    } catch (error) {
      setProblem(apiErrorMessage(error, "We couldn't start the payment. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <TopBar leading={<IconButton icon={topBarIcons.back} label="Back" onPress={back} />} />
  );

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
          title="Sign in to book"
          message="Booking and paying need a Nevile account, so the pro knows who's coming."
          action={<Button label="Sign in" onPress={() => router.push("/sign-in")} />}
        />
      </Screen>
    );
  }

  const firstShown = data?.days[0]?.date;
  const lastShown = data?.days.at(-1)?.date;
  const canGoBack = Boolean(data && firstShown && firstShown > data.firstDate);
  const canGoForward = Boolean(data && lastShown && lastShown < data.lastDate);
  const locked = me.data?.verified === false;

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      avoidKeyboard
      header={header}
      footer={
        data ? (
          <View style={styles.footer}>
            {problem ? <FormAlert tone="error" message={problem} /> : null}
            <Button
              label={`${data.instantBook ? "Pay" : "Hold"} ${formatCad(data.price.totalCents)}`}
              icon={icons.card}
              fullWidth
              loading={busy}
              disabled={locked || !data.bookingOpen}
              onPress={() => void pay()}
            />
            <Text variant="small" tone="muted" style={styles.center}>
              Secure payment by Stripe. Nevile never sees your card number.
            </Text>
          </View>
        ) : null
      }
    >
      {options.isPending ? (
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading"
          style={styles.spinner}
        />
      ) : options.isError || !data ? (
        <View style={styles.section}>
          <FormAlert
            tone="error"
            message={
              options.error
                ? apiErrorMessage(options.error, "We couldn't load the times right now.")
                : "This quote can't be booked any more."
            }
          />
          <Button label="Try again" variant="secondary" onPress={() => options.refetch()} />
        </View>
      ) : (
        <Animated.View entering={enterUp} style={styles.page}>
          <View style={styles.section}>
            <Text variant="display">{data.title}</Text>
            <Text tone="muted">
              with {data.businessName} · about {data.duration}
            </Text>
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
          {data.bookingOpen ? null : (
            <FormAlert
              tone="info"
              message={`${data.businessName} isn't taking bookings right now.`}
            />
          )}

          <DayWindowPicker
            title="When"
            hint="Pick a day, then the window when the crew can arrive."
            days={data.days}
            date={date}
            windowStart={windowStart}
            onDate={(next) => {
              setDate(next);
              setWindowStart(null);
            }}
            onWindow={setWindowStart}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onPage={page}
          />

          <AddressFields
            hint="The pro sees the address once the booking is paid."
            postalHint={
              data.postalArea
                ? `The quote is for ${data.postalArea}, so the postal code starts with ${data.postalArea}.`
                : undefined
            }
            address={address}
            onChange={changeAddress}
            notes={notes}
            onNotes={setNotes}
          />

          <Card style={styles.section}>
            <Text variant="heading">Summary</Text>
            <Text variant="bodyStrong">{data.title}</Text>
            {day && chosenWindow ? (
              <Text variant="small" tone="muted">
                {longDay.format(asDate(day.date))}, {chosenWindow.label}
              </Text>
            ) : null}
            <Line label="Job price" value={formatCad(data.price.priceCents)} />
            <Line label="Service fee" value={formatCad(data.price.serviceFeeCents)} />
            {data.price.taxCents > 0 ? (
              <Line label="HST" value={formatCad(data.price.taxCents)} />
            ) : null}
            <View style={styles.total}>
              <Line label="Total" value={formatCad(data.price.totalCents)} strong />
            </View>
            {data.instantBook ? (
              <View style={styles.row}>
                <Badge label="Instant Book" size="sm" />
                <Text variant="small" tone="muted" style={styles.grow}>
                  Confirmed as soon as you pay.
                </Text>
              </View>
            ) : (
              <Text variant="small" tone="muted">
                Needs the pro&apos;s OK. Your card is held, not charged, until they accept (within
                24 hours). If they don&apos;t, the hold is released.
              </Text>
            )}
            <Text variant="small" tone="muted">
              {data.cancellationPolicy.label} cancellation. {data.cancellationPolicy.description}{" "}
              The service fee isn&apos;t refunded when you cancel.
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
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  grow: { flex: 1, minWidth: 0 },
  center: { textAlign: "center" },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
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
