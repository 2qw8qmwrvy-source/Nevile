import { formatCad } from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { Badge } from "@/components/badge.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { PrivatePhotoGrid } from "@/components/private-photos.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert, TextField } from "@/lib/auth-ui.tsx";
import { type CustomerBooking, statusColors } from "@/lib/bookings.ts";
import { openWebsitePage } from "@/lib/links.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage, apiFieldErrors } from "@/lib/trpc-client.ts";
import { colors, space } from "@/theme";

type Ongoing = NonNullable<CustomerBooking["ongoing"]>;
type Visit = Ongoing["visits"][number];

const shortDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  weekday: "short",
  month: "short",
  day: "numeric",
});

const MONTH_STATE: Record<string, string> = {
  charging: "Payment going through",
  charged: "Paid",
  cancelled: "Not charged",
  failed: "Card declined: we'll try again",
};

/** Where a visit's money stands, in a few words. */
function visitMoney(visit: Visit, ongoing: Ongoing): string | null {
  const { charge } = visit;
  switch (charge.state) {
    case "scheduled":
      return charge.dueAt ? `Charged ${shortDay.format(charge.dueAt)}` : null;
    case "charging":
      return "Payment going through";
    case "charged":
      return `Paid ${formatCad(charge.amountCents)}`;
    case "partly_refunded":
      return `Paid ${formatCad(charge.amountCents)} · ${formatCad(charge.refundedCents)} refunded`;
    case "refunded":
      return `Refunded ${formatCad(charge.refundedCents)}`;
    case "failed":
      return "Card declined: we'll try again";
    default:
      return ongoing.kind === "snow_contract" &&
        ongoing.pricing === "per_visit" &&
        visit.status === "completed_pending_confirmation"
        ? "Charged once you confirm"
        : null;
  }
}

/** One visit with what the customer can do to it now. */
function VisitRow({
  booking,
  ongoing,
  visit,
  divider,
  onChanged,
}: {
  booking: CustomerBooking;
  ongoing: Ongoing;
  visit: Visit;
  divider: boolean;
  onChanged: (next: CustomerBooking | null, announcement: string) => void;
}) {
  const trpc = useTRPC();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const skip = useMutation(
    trpc.recurring.skipVisit.mutationOptions({
      onSuccess: () => onChanged(null, "Visit skipped."),
    }),
  );
  const confirm = useMutation(
    trpc.bookings.confirmDone.mutationOptions({
      onSuccess: (next) => onChanged(next, "Thanks, the visit is confirmed."),
    }),
  );
  const report = useMutation(
    trpc.bookings.reportProblem.mutationOptions({
      onSuccess: (next) => {
        setReporting(false);
        setReason("");
        onChanged(next, "Problem sent to the pro.");
      },
    }),
  );
  const error = skip.error ?? confirm.error ?? report.error;
  const busy = skip.isPending || confirm.isPending || report.isPending;
  const actions = "skip" in visit.actions ? visit.actions : null;
  const money = visitMoney(visit, ongoing);
  const ids = { bookingId: booking.id, visitId: visit.id };
  const colours = statusColors(visit.status);

  const askToSkip = () =>
    Alert.alert("Skip this visit?", visit.skip?.text ?? undefined, [
      { text: "Keep it", style: "cancel" },
      { text: "Skip visit", style: "destructive", onPress: () => skip.mutate(ids) },
    ]);

  return (
    <View style={[styles.visit, divider && styles.divider]}>
      <View style={styles.visitHead}>
        <View style={styles.grow}>
          <Text variant="bodyStrong">{visit.window.label}</Text>
          {money ? (
            <Text variant="small" tone="muted">
              {money}
            </Text>
          ) : null}
        </View>
        <Badge
          size="sm"
          label={visit.statusLabel}
          background={colours.background}
          textColor={colours.text}
        />
      </View>
      <PrivatePhotoGrid photos={visit.photos} size={80} label="Photo from the pro" />
      {error ? (
        <FormAlert tone="error" message={apiFieldErrors(error).reason ?? apiErrorMessage(error)} />
      ) : null}
      {reporting ? (
        <>
          <TextField
            label="What's wrong?"
            hint="The pro gets 3 days to put it right."
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={1000}
            inputStyle={styles.multiline}
          />
          <View style={styles.buttons}>
            <Button
              label="Send to the pro"
              size="sm"
              loading={report.isPending}
              disabled={busy}
              onPress={() => report.mutate({ ...ids, reason })}
            />
            <Button
              label="Never mind"
              variant="ghost"
              size="sm"
              onPress={() => setReporting(false)}
            />
          </View>
        </>
      ) : actions?.confirmDone || actions?.reportProblem || actions?.skip ? (
        <View style={styles.buttons}>
          {actions.confirmDone ? (
            <Button
              label="Yes, it's done"
              size="sm"
              loading={confirm.isPending}
              disabled={busy}
              onPress={() => confirm.mutate(ids)}
            />
          ) : null}
          {actions.reportProblem ? (
            <Button
              label="Report a problem"
              variant="secondary"
              size="sm"
              disabled={busy}
              onPress={() => setReporting(true)}
            />
          ) : null}
          {actions.skip ? (
            <Button
              label="Skip"
              variant="secondary"
              size="sm"
              loading={skip.isPending}
              disabled={busy}
              onPress={askToSkip}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A recurring series or snow contract (SPEC §21): schedule or terms, season payments,
 * visits (skip, confirm, report a problem), and ending it.
 */
export function OngoingBooking({
  booking,
  onUpdated,
}: {
  booking: CustomerBooking;
  /** The booking after a change, to put in the cache (or refetch when null). */
  onUpdated: (next: CustomerBooking | null, announcement: string) => void;
}) {
  const trpc = useTRPC();
  const ongoing = booking.ongoing;
  const snow = ongoing?.kind === "snow_contract";
  const thing = snow ? "contract" : "series";
  const requested = booking.status === "requested";
  const end = useMutation(
    trpc.bookings.cancel.mutationOptions({
      onSuccess: (next) =>
        onUpdated(next, requested ? "Request cancelled." : `The ${thing} has ended.`),
    }),
  );
  if (!ongoing) return null;

  const askToEnd = () =>
    Alert.alert(
      requested ? "Cancel this request?" : `End the ${thing}?`,
      requested
        ? "Nothing has been charged."
        : snow
          ? ongoing.pricing === "season"
            ? "Visits already done stay paid. You keep paying for this month; later months aren't charged (or are refunded if you paid upfront)."
            : "Visits already done are still owed. No more visits after today."
          : "Upcoming visits are cancelled: free outside the cancellation window, otherwise the policy applies to that visit. Visits already done aren't affected.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: requested ? "Cancel request" : `End the ${thing}`,
          style: "destructive",
          onPress: () => end.mutate({ bookingId: booking.id }),
        },
      ],
    );

  return (
    <>
      {ongoing.paused ? (
        <View style={styles.section}>
          <FormAlert tone="error" message={ongoing.paused.text} />
          <Button
            label="Update your card"
            variant="secondary"
            fullWidth
            onPress={() => router.push("/card")}
          />
        </View>
      ) : null}

      {ongoing.kind === "recurring" ? (
        <Card style={styles.section}>
          <Text variant="heading">Schedule</Text>
          <Text variant="bodyStrong">{ongoing.schedule}</Text>
          <Text variant="small" tone="muted">
            {requested
              ? "Nothing is charged until the pro accepts."
              : `${ongoing.counts.upcoming} upcoming · ${ongoing.counts.done} done. Each visit is charged to your saved card 3 days before it, and you get a reminder the day before.`}
          </Text>
        </Card>
      ) : (
        <Card style={styles.section}>
          <Text variant="heading">Contract</Text>
          <Text variant="bodyStrong">{ongoing.terms.season}</Text>
          <Text variant="small" tone="muted">
            Cleared whenever snowfall reaches {ongoing.terms.triggerCm} cm.{" "}
            {ongoing.pricing === "per_visit"
              ? "Each visit is charged once you confirm it (or 48 hours after it's logged)."
              : `${ongoing.season?.paymentLabel}.`}
          </Text>
          {ongoing.agreement ? (
            <>
              <Text variant="small" tone="muted">
                Your PDF copy of the agreement was emailed to you. You can also download it from
                this booking on the Nevile website.
              </Text>
              <View style={styles.start}>
                <Button
                  label="Open on the website"
                  variant="ghost"
                  size="sm"
                  onPress={() => void openWebsitePage(`/bookings/${booking.id}`)}
                />
              </View>
            </>
          ) : null}
        </Card>
      )}

      {ongoing.kind === "snow_contract" && ongoing.season && ongoing.season.months.length > 0 ? (
        <Card style={styles.section}>
          <Text variant="heading">Season payments</Text>
          {ongoing.season.months.map((month) => (
            <View key={month.sequence} style={styles.line}>
              <Text variant="bodyStrong" style={styles.grow}>
                {month.label}
              </Text>
              <Text tone="muted">
                {formatCad(month.totalCents)} ·{" "}
                {month.state === "scheduled" && month.chargeDueAt
                  ? `Charged ${shortDay.format(month.chargeDueAt)}`
                  : month.refundedCents > 0
                    ? `${formatCad(month.refundedCents)} refunded`
                    : (MONTH_STATE[month.state] ?? "")}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Card style={styles.section}>
        <Text variant="heading">Visits</Text>
        {ongoing.visits.length === 0 ? (
          <Text tone="muted">
            {requested
              ? `The visits go on the calendar once ${booking.business.name} accepts.`
              : snow
                ? `${booking.business.name} logs a visit each time they clear your snow.`
                : "No visits left."}
          </Text>
        ) : (
          ongoing.visits.map((visit, index) => (
            <VisitRow
              key={visit.id}
              booking={booking}
              ongoing={ongoing}
              visit={visit}
              divider={index > 0}
              onChanged={onUpdated}
            />
          ))
        )}
      </Card>

      {booking.actions.cancel ? (
        <View style={styles.section}>
          {end.error ? <FormAlert tone="error" message={apiErrorMessage(end.error)} /> : null}
          <Button
            label={requested ? "Cancel request" : `End the ${thing}`}
            variant="secondary"
            fullWidth
            loading={end.isPending}
            onPress={askToEnd}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  start: { alignItems: "flex-start" },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  visit: { gap: 8, paddingTop: 4 },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  visitHead: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  multiline: { minHeight: 88, textAlignVertical: "top", paddingTop: 12 },
});
