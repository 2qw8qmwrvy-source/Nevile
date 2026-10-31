import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import { addCalendarDays, endSentence, formatCad, formatIsoDate, parseIsoDate } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  View,
} from "react-native";

import { Badge } from "@/components/badge.tsx";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Chip } from "@/components/chip.tsx";
import { DayWindowPicker } from "@/components/day-window-picker.tsx";
import { icons } from "@/components/icon.tsx";
import { PrivatePhotoGrid } from "@/components/private-photos.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert, TextField } from "@/lib/auth-ui.tsx";
import { deadlineFormat, statusColors } from "@/lib/bookings.ts";
import { canManage, type Membership } from "@/lib/business.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors, radius, space } from "@/theme";

type SeriesView = inferRouterOutputs<AppRouter>["businessBookings"]["ongoing"];
type Visit = SeriesView["ongoing"]["visits"][number];
type Crew = ReadonlyArray<{ id: string; name: string; isYou: boolean }>;

const shortDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Halifax",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** Where a visit's money stands, as the business sees it. */
function money(visit: Visit): string | null {
  const { charge } = visit;
  if (charge.state === "scheduled" && charge.dueAt)
    return `Charged ${shortDay.format(charge.dueAt)}`;
  if (charge.state === "charged") return `Paid ${formatCad(charge.amountCents)}`;
  if (charge.state === "partly_refunded")
    return `Paid, ${formatCad(charge.refundedCents)} refunded`;
  if (charge.state === "refunded") return "Refunded";
  if (charge.state === "failed") return "Customer's card declined: retrying";
  if (charge.state === "charging") return "Payment going through";
  return null;
}

/** Refreshes this series and the calendar after a change, and announces it. */
function useChanged(businessId: string, bookingId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return async (message: string) => {
    AccessibilityInfo.announceForAccessibility(message);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.businessBookings.ongoing.queryKey({ businessId, bookingId }),
      }),
      queryClient.invalidateQueries({ queryKey: trpc.businessBookings.calendar.queryKey() }),
      queryClient.invalidateQueries({
        queryKey: trpc.businessBookings.inbox.queryKey({ businessId }),
      }),
      queryClient.invalidateQueries({ queryKey: trpc.businessBookings.snowRoute.queryKey() }),
    ]);
  };
}

/** Moving one visit: page through days, pick an open window. */
function MoveVisit({
  businessId,
  bookingId,
  visit,
  onDone,
}: {
  businessId: string;
  bookingId: string;
  visit: Visit;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const changed = useChanged(businessId, bookingId);
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const ids = { businessId, bookingId, visitId: visit.id };
  const options = useQuery(trpc.businessBookings.moveOptions.queryOptions({ ...ids, from }));
  const move = useMutation(
    trpc.businessBookings.moveVisit.mutationOptions({
      onSuccess: async () => {
        await changed("Visit moved. The customer has been told.");
        onDone();
      },
    }),
  );
  // The visit's own window can't be picked again.
  const days = (options.data?.days ?? []).map((day) => ({
    date: day.date,
    windows: day.windows.map((window) => ({
      startMinute: window.startMinute,
      label: window.current ? `${window.label} (now)` : window.label,
      available: window.available && !window.current,
    })),
  }));

  function turn(by: number) {
    const start = parseIsoDate(days[0]?.date ?? "");
    if (!start) return;
    setFrom(formatIsoDate(addCalendarDays(start, by * 7)));
    setPage((current) => current + by);
    setDate(null);
    setWindowStart(null);
  }

  return (
    <View style={styles.panel}>
      {options.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading open windows" />
      ) : options.isError ? (
        <FormAlert tone="error" message={apiErrorMessage(options.error)} />
      ) : (
        <DayWindowPicker
          title="Move to"
          hint="Pick a day, then an open arrival window."
          days={days}
          date={date}
          windowStart={windowStart}
          onDate={(next) => {
            setDate(next);
            setWindowStart(null);
          }}
          onWindow={setWindowStart}
          canGoBack={page > 0}
          canGoForward
          onPage={turn}
        />
      )}
      {move.error ? <FormAlert tone="error" message={apiErrorMessage(move.error)} /> : null}
      <Text variant="small" tone="muted">
        The customer is told and can reply in chat.
      </Text>
      <View style={styles.buttons}>
        <Button
          label="Move visit"
          size="sm"
          loading={move.isPending}
          disabled={!date || windowStart === null}
          onPress={() => {
            if (date && windowStart !== null) move.mutate({ ...ids, date, windowStart });
          }}
        />
        <Button label="Never mind" variant="ghost" size="sm" onPress={onDone} />
      </View>
    </View>
  );
}

/** One visit with the actions the role allows. */
function VisitPanel({
  view,
  visit,
  businessId,
  crew,
  manager,
}: {
  view: SeriesView;
  visit: Visit;
  businessId: string;
  crew: Crew;
  manager: boolean;
}) {
  const trpc = useTRPC();
  const changed = useChanged(businessId, view.id);
  const [panel, setPanel] = useState<"move" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const done = (message: string) => ({ onSuccess: () => changed(message) });
  const markDone = useMutation(
    trpc.businessBookings.markDone.mutationOptions(done("Marked done.")),
  );
  const scheduleFix = useMutation(
    trpc.businessBookings.scheduleFix.mutationOptions(done("Fix scheduled.")),
  );
  const markFixed = useMutation(
    trpc.businessBookings.markFixed.mutationOptions(done("Marked fixed.")),
  );
  const assign = useMutation(trpc.businessBookings.assign.mutationOptions(done("Crew updated.")));
  const cancel = useMutation(
    trpc.businessBookings.cancel.mutationOptions({
      onSuccess: async () => {
        setPanel(null);
        await changed("Visit cancelled. Anything charged goes back to the customer.");
      },
    }),
  );
  const all = [markDone, scheduleFix, markFixed, assign, cancel];
  const error = all.find((mutation) => mutation.error)?.error;
  const busy = all.some((mutation) => mutation.isPending);
  const input = { businessId, bookingId: view.id, visitId: visit.id };
  const actions = "move" in visit.actions ? visit.actions : null;
  const note = money(visit);
  const tone = statusColors(visit.status);
  if (!actions) return null;

  return (
    <View style={styles.visit}>
      <View style={styles.visitHead}>
        <View style={styles.grow}>
          <Text variant="bodyStrong">{visit.window.label}</Text>
          <Text variant="small" tone="muted">
            Visit {visit.sequence}
            {note ? ` · ${note}` : ""}
          </Text>
        </View>
        <Badge
          size="sm"
          label={visit.statusLabel}
          background={tone.background}
          textColor={tone.text}
        />
      </View>
      <PrivatePhotoGrid photos={visit.photos} size={72} label="Photo of the cleared driveway" />
      {error ? <FormAlert tone="error" message={apiErrorMessage(error)} /> : null}
      {actions.assign && manager ? (
        <View style={styles.chips}>
          <Chip
            label="Not assigned"
            selected={visit.assignee === null}
            disabled={busy}
            onPress={() => assign.mutate({ ...input, memberId: null })}
          />
          {crew.map((member) => (
            <Chip
              key={member.id}
              label={member.isYou ? `${member.name} (you)` : member.name}
              selected={visit.assignee?.id === member.id}
              disabled={busy}
              onPress={() => assign.mutate({ ...input, memberId: member.id })}
            />
          ))}
        </View>
      ) : visit.assignee ? (
        <Text variant="small">Crew: {visit.assignee.name}</Text>
      ) : null}
      <View style={styles.buttons}>
        {actions.markDone ? (
          <Button
            label="Mark done"
            size="sm"
            loading={markDone.isPending}
            disabled={busy}
            onPress={() => markDone.mutate(input)}
          />
        ) : null}
        {actions.scheduleFix ? (
          <Button
            label="We'll come back to fix it"
            size="sm"
            loading={scheduleFix.isPending}
            disabled={busy}
            onPress={() => scheduleFix.mutate(input)}
          />
        ) : null}
        {actions.markFixed ? (
          <Button
            label="Mark fixed"
            size="sm"
            loading={markFixed.isPending}
            disabled={busy}
            onPress={() => markFixed.mutate(input)}
          />
        ) : null}
        {actions.move && manager && panel === null ? (
          <Button label="Move" variant="secondary" size="sm" onPress={() => setPanel("move")} />
        ) : null}
        {actions.cancel && manager && panel === null ? (
          <Button
            label="Cancel this visit"
            variant="ghost"
            size="sm"
            onPress={() => setPanel("cancel")}
          />
        ) : null}
      </View>
      {panel === "move" ? (
        <MoveVisit
          businessId={businessId}
          bookingId={view.id}
          visit={visit}
          onDone={() => setPanel(null)}
        />
      ) : null}
      {panel === "cancel" ? (
        <View style={styles.panel}>
          <TextField
            label="Why are you cancelling this visit?"
            hint="The customer sees this. If it was charged, they get it back in full."
            value={reason}
            onChangeText={setReason}
            maxLength={500}
          />
          <View style={styles.buttons}>
            <Button
              label="Cancel visit"
              size="sm"
              loading={cancel.isPending}
              disabled={busy || reason.trim().length < 3}
              onPress={() => cancel.mutate({ ...input, reason })}
            />
            <Button label="Keep it" variant="ghost" size="sm" onPress={() => setPanel(null)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Ending a series or contract early, with the reason the customer is told. */
function EndCard({ view, businessId }: { view: SeriesView; businessId: string }) {
  const trpc = useTRPC();
  const changed = useChanged(businessId, view.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const end = useMutation(
    trpc.businessBookings.endOngoing.mutationOptions({ onSuccess: () => changed("Ended.") }),
  );
  const snow = view.ongoing.kind === "snow_contract";
  const thing = snow ? "contract" : "series";
  if (end.data) {
    return (
      <FormAlert
        tone="success"
        message={`Ended. ${
          end.data.refundCents > 0
            ? `${formatCad(end.data.refundCents)} goes back to the customer.`
            : "Nothing needed refunding."
        }`}
      />
    );
  }
  if (!open) {
    return (
      <Button label={`End the ${thing}`} variant="ghost" fullWidth onPress={() => setOpen(true)} />
    );
  }
  return (
    <Card style={styles.section}>
      <Text variant="heading">End the {thing}?</Text>
      <Text tone="muted">
        {snow
          ? "Visits already done stay paid. With a season price, the rest of this month is refunded day by day and later months aren't charged (or are refunded)."
          : "Upcoming visits are cancelled and refunded in full. Visits already done aren't affected."}
      </Text>
      <TextField
        label="Why? The customer sees this."
        value={reason}
        onChangeText={setReason}
        maxLength={500}
      />
      {end.error ? <FormAlert tone="error" message={apiErrorMessage(end.error)} /> : null}
      <Button
        label="End it"
        fullWidth
        loading={end.isPending}
        disabled={reason.trim().length < 3}
        onPress={() => end.mutate({ businessId, bookingId: view.id, reason })}
      />
      <Button label="Keep it" variant="ghost" fullWidth onPress={() => setOpen(false)} />
    </Card>
  );
}

function Series({
  membership,
  bookingId,
  visitId,
}: {
  membership: Membership;
  bookingId: string;
  visitId: string | undefined;
}) {
  const trpc = useTRPC();
  const businessId = membership.business.id;
  const manager = canManage(membership.role);
  const changed = useChanged(businessId, bookingId);
  const view = useQuery(trpc.businessBookings.ongoing.queryOptions({ businessId, bookingId }));
  const team = useQuery({ ...trpc.team.members.queryOptions({ businessId }), enabled: manager });
  const accept = useMutation(
    trpc.businessBookings.accept.mutationOptions({ onSuccess: () => changed("Accepted.") }),
  );
  const decline = useMutation(
    trpc.businessBookings.decline.mutationOptions({ onSuccess: () => changed("Declined.") }),
  );
  const assignAll = useMutation(
    trpc.businessBookings.assign.mutationOptions({
      onSuccess: () => changed("Crew set for every upcoming visit."),
    }),
  );

  if (view.isPending)
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  if (view.isError) return <FormAlert tone="error" message={apiErrorMessage(view.error)} />;
  const data = view.data;
  const { ongoing } = data;
  const snow = ongoing.kind === "snow_contract";
  const crew = (team.data ?? []).filter((member) => member.active);
  const tone = statusColors(data.status);
  const highlighted = visitId ? ongoing.visits.find((visit) => visit.id === visitId) : undefined;
  const others = ongoing.visits.filter((visit) => visit !== highlighted);
  const answering = accept.isPending || decline.isPending;

  const confirmDecline = () =>
    Alert.alert(
      snow ? "Decline this sign-up?" : "Decline this request?",
      "Nothing has been charged. The customer is told you can't take it.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: () => decline.mutate({ businessId, bookingId }),
        },
      ],
    );

  return (
    <>
      <View style={styles.section}>
        <Text variant="small" tone="primary">
          {snow ? "SNOW CONTRACT" : "RECURRING JOB"}
        </Text>
        <Text variant="display">{data.title}</Text>
        <Text tone="muted">{data.customer.firstName}</Text>
        <View style={styles.start}>
          <Badge label={data.statusLabel} background={tone.background} textColor={tone.text} />
        </View>
      </View>

      {ongoing.paused ? <FormAlert tone="error" message={ongoing.paused.text} /> : null}

      {data.actions.accept || data.actions.decline ? (
        <Card style={styles.section}>
          <Text variant="heading">
            {snow ? "Sign-up waiting for you" : "Request waiting for you"}
          </Text>
          <Text tone="muted">
            Accept or decline by{" "}
            {endSentence(
              data.approvalExpiresAt ? deadlineFormat.format(data.approvalExpiresAt) : "tomorrow",
            )}{" "}
            {snow
              ? "Accepting signs the agreement on your side and puts the address on your snow route."
              : "Accepting puts every visit that still fits on your calendar."}
          </Text>
          {accept.error || decline.error ? (
            <FormAlert tone="error" message={apiErrorMessage(accept.error ?? decline.error)} />
          ) : null}
          <Button
            label="Accept"
            fullWidth
            loading={accept.isPending}
            disabled={answering}
            onPress={() => accept.mutate({ businessId, bookingId })}
          />
          <Button
            label="Decline"
            variant="secondary"
            fullWidth
            disabled={answering}
            onPress={confirmDecline}
          />
        </Card>
      ) : null}
      {accept.data && accept.data.skipped.length > 0 ? (
        <FormAlert
          tone="success"
          message={`Accepted. These dates no longer fit and are skipped: ${accept.data.skipped.join(", ")}.`}
        />
      ) : null}

      {highlighted ? (
        <Card style={styles.section}>
          <Text variant="heading">This visit</Text>
          <VisitPanel
            view={data}
            visit={highlighted}
            businessId={businessId}
            crew={crew}
            manager={manager}
          />
        </Card>
      ) : null}

      <Card style={styles.section}>
        <Text variant="heading">{snow ? "Terms" : "Schedule"}</Text>
        <Text>
          {ongoing.kind === "recurring"
            ? ongoing.schedule
            : `${ongoing.terms.season}. Cleared from ${ongoing.terms.triggerCm} cm.`}
        </Text>
        {ongoing.perVisit ? (
          <Text variant="small" tone="muted">
            You get {formatCad(ongoing.perVisit.payoutCents)} per visit (price and HST, less
            Nevile&apos;s 3%).
          </Text>
        ) : null}
        {ongoing.kind === "snow_contract" && ongoing.agreement ? (
          <Text variant="small" tone="muted">
            {ongoing.agreement.acceptedByBusinessAt
              ? "The signed agreement (PDF) was emailed to your business when you accepted."
              : "Accepting signs the agreement; the PDF is emailed to your business."}
          </Text>
        ) : null}
        <Text>{data.address.join("\n")}</Text>
        {data.notes ? <Text tone="muted">“{data.notes}”</Text> : null}
        {data.customer.phone ? (
          <View style={styles.start}>
            <Button
              label={`Call ${data.customer.firstName}`}
              variant="secondary"
              size="sm"
              onPress={() => void Linking.openURL(`tel:${data.customer.phone}`)}
            />
          </View>
        ) : null}
        {data.customer.email ? (
          <Text variant="small" tone="muted">
            {data.customer.email}
          </Text>
        ) : null}
        {data.cancellationReason ? (
          <Text variant="small" tone="muted">
            Ended: “{data.cancellationReason}”
          </Text>
        ) : null}
        {data.conversationId ? (
          <Button
            label={`Message ${data.customer.firstName}`}
            variant="secondary"
            icon={icons.chat}
            fullWidth
            onPress={() =>
              router.push({
                pathname: "/inbox/[conversationId]",
                params: { conversationId: data.conversationId ?? "" },
              })
            }
          />
        ) : null}
      </Card>

      {manager && data.status === "confirmed" && crew.length > 0 ? (
        <Card style={styles.section}>
          <Text variant="heading">Crew for every upcoming visit</Text>
          <Text variant="small" tone="muted">
            Sets who does each upcoming visit. You can still change single visits below.
          </Text>
          {assignAll.error ? (
            <FormAlert tone="error" message={apiErrorMessage(assignAll.error)} />
          ) : null}
          <View style={styles.chips}>
            <Chip
              label="Not assigned"
              disabled={assignAll.isPending}
              onPress={() => assignAll.mutate({ businessId, bookingId, memberId: null })}
            />
            {crew.map((member) => (
              <Chip
                key={member.id}
                label={member.isYou ? `${member.name} (you)` : member.name}
                disabled={assignAll.isPending}
                onPress={() => assignAll.mutate({ businessId, bookingId, memberId: member.id })}
              />
            ))}
          </View>
        </Card>
      ) : null}

      {snow && ongoing.season && ongoing.season.months.length > 0 ? (
        <Card style={styles.section}>
          <Text variant="heading">Season payments</Text>
          <Text variant="small" tone="muted">
            {ongoing.season.paymentLabel}. You&apos;re paid each month&apos;s share after the month
            ends.
          </Text>
          {ongoing.season.months.map((month) => (
            <View key={month.sequence} style={styles.line}>
              <Text variant="bodyStrong" style={styles.fixed}>
                {month.label}
              </Text>
              <Text tone="muted" style={styles.detail}>
                you get {formatCad(month.payoutCents)} ·{" "}
                {month.state === "scheduled" && month.chargeDueAt
                  ? `charged ${shortDay.format(month.chargeDueAt)}`
                  : month.state === "cancelled"
                    ? "not charged"
                    : month.state === "failed"
                      ? "card declined"
                      : month.refundedCents > 0
                        ? `${formatCad(month.refundedCents)} refunded`
                        : "paid"}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Card style={styles.section}>
        <Text variant="heading">{highlighted ? "Other visits" : "Visits"}</Text>
        {others.length === 0 ? (
          <Text tone="muted">
            {snow
              ? "Mark the address Cleared on your snow route after each storm."
              : data.status === "requested"
                ? "Visits go on your calendar when you accept."
                : "No other visits."}
          </Text>
        ) : (
          others.map((visit, index) => (
            <View key={visit.id} style={index > 0 ? styles.divider : undefined}>
              <VisitPanel
                view={data}
                visit={visit}
                businessId={businessId}
                crew={crew}
                manager={manager}
              />
            </View>
          ))
        )}
      </Card>

      {data.actions.end ? <EndCard view={data} businessId={businessId} /> : null}
    </>
  );
}

/** A recurring series or snow contract as the business manages it (SPEC §21). */
export default function BusinessSeriesRoute() {
  const { id, businessId, visitId } = useLocalSearchParams<{
    id: string;
    businessId?: string;
    visitId?: string;
  }>();
  return (
    <BusinessScreen businessId={businessId} avoidKeyboard>
      {(membership) => (
        <Series membership={membership} bookingId={id ?? ""} visitId={visitId || undefined} />
      )}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  start: { alignItems: "flex-start" },
  grow: { flex: 1, minWidth: 0 },
  fixed: { flexShrink: 0 },
  detail: { flex: 1, minWidth: 0, textAlign: "right" },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  visit: { gap: 8 },
  visitHead: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  panel: {
    gap: 10,
    padding: 12,
    borderRadius: radius.input,
    backgroundColor: colors.ground,
  },
});
