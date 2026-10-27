import {
  addCalendarDays,
  addCalendarMonths,
  FREQUENCY_LABELS,
  formatCad,
  formatIsoDate,
  parseIsoDate,
  type RecurrenceFrequency,
} from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { AddressFields, addressProblem, useJobAddress } from "@/components/address-fields.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { CardOnFile } from "@/components/card-on-file.tsx";
import { Chip } from "@/components/chip.tsx";
import { asDate, DayWindowPicker, longDay } from "@/components/day-window-picker.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { icons } from "@/components/icon.tsx";
import { RadioCard } from "@/components/radio-card.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { VerificationBanner } from "@/components/verification-banner.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { useMe } from "@/lib/me.ts";
import { askForPush } from "@/lib/push.ts";
import { useTRPC, useTRPCClient } from "@/lib/trpc.tsx";
import { apiErrorMessage, apiFieldErrors } from "@/lib/trpc-client.ts";
import { useEmailVerification } from "@/lib/verification.ts";
import { colors, radius, seasons, space } from "@/theme";
import { enterUp } from "@/theme/motion.ts";

const DAYS_PER_PAGE = 7;
/** How long the series runs from the first visit (6 months at most, SPEC §21). */
const LENGTHS = [1, 2, 3, 6] as const;
type Length = (typeof LENGTHS)[number];
const LENGTH_LABEL: Record<Length, string> = {
  1: "1 month",
  2: "2 months",
  3: "3 months",
  6: "6 months",
};

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant={strong ? "bodyStrong" : "body"}>{label}</Text>
      <Text variant={strong ? "bodyStrong" : "body"}>{value}</Text>
    </View>
  );
}

/**
 * Recurring visits (SPEC §21): how often, the first visit, how long it runs, then every
 * date checked against the pro's calendar (skip or move full ones). A listed service
 * needs the pro's OK within 24 hours; a pro's own recurring offer is confirmed straight
 * away. Each visit is charged to the saved card 3 days before it.
 */
export default function RecurringRoute() {
  const params = useLocalSearchParams<{ serviceId?: string; quoteId?: string }>();
  const quoteId = params.quoteId ?? "";
  const serviceId = quoteId ? "" : (params.serviceId ?? "");
  const kind = quoteId ? "quote" : "service";
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const { user, me, session } = useMe();
  const verification = useEmailVerification();

  const [frequency, setFrequency] = useState<RecurrenceFrequency | null>(null);
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [date, setDate] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [length, setLength] = useState<Length>(3);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, number | null>>(new Map());
  const { address, change: changeAddress } = useJobAddress(me.data?.onboarding.postalCode);
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const service = useQuery({
    ...trpc.bookings.availability.queryOptions({ serviceId, from, days: DAYS_PER_PAGE }),
    enabled: kind === "service" && Boolean(serviceId) && user !== null,
  });
  const quote = useQuery({
    ...trpc.quotes.bookingOptions.queryOptions({ quoteId, from, days: DAYS_PER_PAGE }),
    enabled: kind === "quote" && user !== null,
  });
  const card = useQuery({ ...trpc.cards.get.queryOptions(), enabled: user !== null });
  const options = kind === "service" ? service : quote;
  const days = options.data?.days ?? [];
  const frequencies: RecurrenceFrequency[] =
    kind === "service"
      ? (service.data?.service.recurrenceFrequencies ?? [])
      : (quote.data?.quote?.frequencies.map((option) => option.value) ?? []);
  const chosenFrequency = frequency ?? (frequencies.length === 1 ? (frequencies[0] ?? null) : null);
  const title = kind === "service" ? service.data?.service.title : quote.data?.title;
  const businessName = options.data?.business.name ?? "";
  const duration =
    kind === "service" ? service.data?.service.duration : quote.data?.quote?.duration;
  const policy = options.data?.cancellationPolicy;
  const bookingOpen = options.data?.bookingOpen ?? true;

  const first = date ? parseIsoDate(date) : null;
  const endDate = first ? formatIsoDate(addCalendarMonths(first, length)) : null;
  const schedule = useMemo(
    () =>
      chosenFrequency && date && windowStart !== null && endDate
        ? {
            frequency: chosenFrequency,
            date,
            windowStart,
            endDate,
            overrides: [...overrides].map(([day, start]) => ({ date: day, windowStart: start })),
          }
        : null,
    [chosenFrequency, date, windowStart, endDate, overrides],
  );
  const previewInput = schedule ?? {
    frequency: "weekly" as const,
    date: "2000-01-03",
    windowStart: 0,
    endDate: "2000-01-10",
    overrides: [],
  };
  const servicePreview = useQuery({
    ...trpc.recurring.preview.queryOptions({ ...previewInput, serviceId }),
    enabled: kind === "service" && schedule !== null,
  });
  const quotePreview = useQuery({
    ...trpc.recurring.previewQuote.queryOptions({ ...previewInput, quoteId }),
    enabled: kind === "quote" && schedule !== null,
  });
  const preview = kind === "service" ? servicePreview : quotePreview;
  const plan = schedule ? preview.data : undefined;

  const booked = {
    onSuccess: ({ bookingId }: { bookingId: string }) => {
      void queryClient.invalidateQueries({ queryKey: trpc.bookings.list.queryKey() });
      router.replace({ pathname: "/bookings/[id]", params: { id: bookingId, new: "1" } });
      void askForPush(client);
    },
  };
  const request = useMutation(trpc.recurring.request.mutationOptions(booked));
  const requestQuote = useMutation(trpc.recurring.requestFromQuote.mutationOptions(booked));
  const sending = kind === "service" ? request : requestQuote;
  const fieldErrors = sending.error ? apiFieldErrors(sending.error) : {};

  const back = () => (router.canGoBack() ? router.back() : router.replace("/search"));
  const header = (
    <TopBar leading={<IconButton icon={topBarIcons.back} label="Back" onPress={back} />} />
  );

  function page(by: number) {
    const start = parseIsoDate(days[0]?.date ?? options.data?.firstDate ?? "");
    if (!start) return;
    setFrom(formatIsoDate(addCalendarDays(start, by * DAYS_PER_PAGE)));
  }

  function change(day: string, start: number | null | undefined) {
    setOverrides((current) => {
      const next = new Map(current);
      if (start === undefined) next.delete(day);
      else next.set(day, start);
      return next;
    });
  }

  function send() {
    setProblem(null);
    if (!schedule) {
      setProblem("Pick how often and the first visit.");
      return;
    }
    if (plan?.problem) {
      setProblem(plan.problem);
      return;
    }
    const addressIssue = addressProblem(address);
    if (addressIssue) {
      setProblem(addressIssue);
      return;
    }
    if (kind === "quote") requestQuote.mutate({ ...schedule, quoteId, address, notes });
    else request.mutate({ ...schedule, serviceId, address, notes });
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
          title="Sign in to book"
          message="Recurring visits need a Nevile account and a saved card."
          action={<Button label="Sign in" onPress={() => router.push("/sign-in")} />}
        />
      </Screen>
    );
  }

  const data = options.data;
  const firstShown = days[0]?.date;
  const lastShown = days.at(-1)?.date;
  const canGoBack = Boolean(data && firstShown && firstShown > data.firstDate);
  const canGoForward = Boolean(data && lastShown && lastShown < data.lastDate);
  const locked = me.data?.verified === false;
  const sendError =
    problem ??
    (sending.error
      ? (fieldErrors.address ?? fieldErrors.endDate ?? apiErrorMessage(sending.error))
      : null);

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      avoidKeyboard
      header={header}
      footer={
        data ? (
          <View style={styles.footer}>
            {sendError ? <FormAlert tone="error" message={sendError} /> : null}
            <Button
              label={kind === "quote" ? "Book these visits" : "Send request"}
              fullWidth
              loading={sending.isPending || sending.isSuccess}
              disabled={locked || !bookingOpen || !card.data}
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
                : "This offer can't be booked any more."
            }
          />
          <Button label="Try again" variant="secondary" onPress={() => options.refetch()} />
        </View>
      ) : (
        <Animated.View entering={enterUp} style={styles.page}>
          <View style={styles.section}>
            <Text variant="display">{title}</Text>
            <Text tone="muted">
              with {businessName}
              {duration ? ` · about ${duration} a visit` : ""}
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
          {bookingOpen ? null : (
            <FormAlert tone="info" message={`${businessName} isn't taking bookings right now.`} />
          )}

          <CardOnFile
            charged="Each visit is charged 3 days before it to"
            missing="Recurring visits are charged to a saved card, 3 days before each visit. Add one to continue."
          />

          <Card style={styles.section}>
            <Text variant="heading">How often</Text>
            <View accessibilityRole="radiogroup" style={styles.choices}>
              {frequencies.map((option) => (
                <RadioCard
                  key={option}
                  label={FREQUENCY_LABELS[option]}
                  checked={chosenFrequency === option}
                  onPress={() => {
                    setFrequency(option);
                    setOverrides(new Map());
                  }}
                />
              ))}
            </View>
          </Card>

          <DayWindowPicker
            title="First visit"
            hint="Later visits keep this weekday (or day of the month) and arrival window."
            days={days}
            date={date}
            windowStart={windowStart}
            onDate={(next) => {
              setDate(next);
              setWindowStart(null);
              setOverrides(new Map());
            }}
            onWindow={(start) => {
              setWindowStart(start);
              setOverrides(new Map());
            }}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onPage={page}
          />

          <Card style={styles.section}>
            <Text variant="heading">For how long</Text>
            <View style={styles.chips}>
              {LENGTHS.map((months) => (
                <Chip
                  key={months}
                  label={LENGTH_LABEL[months]}
                  selected={length === months}
                  onPress={() => {
                    setLength(months);
                    setOverrides(new Map());
                  }}
                />
              ))}
            </View>
            <Text variant="small" tone="muted">
              {endDate
                ? `Visits until ${longDay.format(asDate(endDate))}. You can end it early any time.`
                : "Up to 6 months. You can end it early any time."}
            </Text>
          </Card>

          {schedule ? (
            <Card style={styles.section}>
              <Text variant="heading">Your visits</Text>
              {preview.isPending ? (
                <ActivityIndicator color={colors.primary} accessibilityLabel="Checking dates" />
              ) : preview.isError ? (
                <FormAlert tone="error" message={apiErrorMessage(preview.error)} />
              ) : plan ? (
                <>
                  <Text tone="muted">{plan.summary}</Text>
                  {plan.dates.map((visit) => {
                    const flagged = visit.status !== "ok" && visit.status !== "skipped";
                    return (
                      <View key={visit.date} style={[styles.visit, flagged && styles.flagged]}>
                        <View style={styles.line}>
                          <Text variant="bodyStrong" style={styles.grow}>
                            {visit.label}
                          </Text>
                          <Text tone="muted">
                            {visit.status === "ok"
                              ? visit.windowLabel
                              : visit.status === "skipped"
                                ? "Skipped"
                                : "Full"}
                          </Text>
                        </View>
                        {visit.status === "skipped" ? (
                          <View style={styles.start}>
                            <Button
                              label="Undo skip"
                              variant="ghost"
                              size="sm"
                              onPress={() => change(visit.date, undefined)}
                            />
                          </View>
                        ) : flagged ? (
                          <View style={styles.chips}>
                            <Button
                              label="Skip this date"
                              variant="secondary"
                              size="sm"
                              onPress={() => change(visit.date, null)}
                            />
                            {visit.alternatives.map((alternative) => (
                              <Button
                                key={alternative.startMinute}
                                label={`Move to ${alternative.label}`}
                                variant="secondary"
                                size="sm"
                                onPress={() => change(visit.date, alternative.startMinute)}
                              />
                            ))}
                          </View>
                        ) : overrides.has(visit.date) ? (
                          <View style={styles.start}>
                            <Button
                              label="Back to the usual window"
                              variant="ghost"
                              size="sm"
                              onPress={() => change(visit.date, undefined)}
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {plan.problem ? <FormAlert tone="error" message={plan.problem} /> : null}
                </>
              ) : null}
            </Card>
          ) : null}

          <AddressFields
            hint="The pro sees the address once the first visit is paid."
            postalHint={
              kind === "quote" && quote.data?.postalArea
                ? `The quote is for ${quote.data.postalArea}, so the postal code starts with ${quote.data.postalArea}.`
                : undefined
            }
            address={address}
            onChange={changeAddress}
            notes={notes}
            onNotes={setNotes}
          />

          <Card style={styles.section}>
            <Text variant="heading">Summary</Text>
            {plan ? (
              <>
                <Text tone="muted">{plan.summary}</Text>
                <Line label="Each visit" value={formatCad(plan.price.priceCents)} />
                <Line label="Service fee" value={formatCad(plan.price.serviceFeeCents)} />
                {plan.price.taxCents > 0 ? (
                  <Line label="HST" value={formatCad(plan.price.taxCents)} />
                ) : null}
                <View style={styles.total}>
                  <Line label="Per visit" value={formatCad(plan.price.totalCents)} strong />
                </View>
                <Line label={`${plan.visits} visits`} value={formatCad(plan.totalCents)} />
              </>
            ) : (
              <Text tone="muted">Pick a schedule to see your visits and the price.</Text>
            )}
            <Text variant="small" tone="muted">
              {kind === "quote"
                ? "Confirmed straight away: it's the pro's own offer."
                : "Needs the pro's OK. Nothing is charged until they accept (within 24 hours)."}{" "}
              Each visit is charged 3 days before it, and you get a reminder the day before.
            </Text>
            {policy ? (
              <Text variant="small" tone="muted">
                {policy.label} cancellation applies to each visit you skip. {policy.description}
              </Text>
            ) : null}
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  start: { alignItems: "flex-start" },
  grow: { flex: 1, minWidth: 0 },
  center: { textAlign: "center" },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  visit: {
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  flagged: { borderColor: seasons.summer.accent, backgroundColor: seasons.summer.tint },
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
