import { formatCad } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { Badge } from "@/components/badge.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { icons } from "@/components/icon.tsx";
import { OngoingBooking } from "@/components/ongoing-booking.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { FormAlert, TextField } from "@/lib/auth-ui.tsx";
import { type CustomerBooking, deadlineFormat, statusColors } from "@/lib/bookings.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { colors, radius, space } from "@/theme";
import { enterUp } from "@/theme/motion.ts";

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant={strong ? "bodyStrong" : "body"}>{label}</Text>
      <Text variant={strong ? "bodyStrong" : "body"}>{value}</Text>
    </View>
  );
}

/** One booking: when and where, what was paid, and what the customer can do now. */
export default function BookingRoute() {
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const queryOptions = trpc.bookings.get.queryOptions({ bookingId: id ?? "" });
  const booking = useQuery({ ...queryOptions, enabled: Boolean(id) });
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const back = () => (router.canGoBack() ? router.back() : router.replace("/bookings"));

  const updated = (next: CustomerBooking | null, announcement: string) => {
    if (next) queryClient.setQueryData(queryOptions.queryKey, next);
    else void queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
    void queryClient.invalidateQueries({ queryKey: trpc.bookings.list.queryKey() });
    AccessibilityInfo.announceForAccessibility(announcement);
  };
  const cancel = useMutation(
    trpc.bookings.cancel.mutationOptions({
      onSuccess: (next) => updated(next, "Booking cancelled."),
    }),
  );
  const confirm = useMutation(
    trpc.bookings.confirmDone.mutationOptions({
      onSuccess: (next) => updated(next, "Thanks, the job is confirmed."),
    }),
  );
  const report = useMutation(
    trpc.bookings.reportProblem.mutationOptions({
      onSuccess: (next) => {
        setReporting(false);
        setReason("");
        updated(next, "Problem sent to the pro.");
      },
    }),
  );
  const error = cancel.error ?? confirm.error ?? report.error;
  const busy = cancel.isPending || confirm.isPending || report.isPending;

  const askToCancel = (view: CustomerBooking) =>
    Alert.alert(
      "Cancel this booking?",
      view.cancelQuote?.text ?? "The hold on your card is released and you won't be charged.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel booking",
          style: "destructive",
          onPress: () => cancel.mutate({ bookingId: view.id }),
        },
      ],
    );

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      avoidKeyboard
      header={
        <TopBar leading={<IconButton icon={topBarIcons.back} label="Back" onPress={back} />} />
      }
    >
      {booking.isPending ? (
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading"
          style={styles.spinner}
        />
      ) : booking.isError ? (
        booking.error.data?.code === "NOT_FOUND" ? (
          <EmptyState
            icon={icons.bookings}
            title="We couldn't find that booking"
            message="It may belong to a different account."
            action={<Button label="Your bookings" variant="secondary" onPress={back} />}
          />
        ) : (
          <View style={styles.section}>
            <FormAlert tone="error" message="We couldn't load this booking right now." />
            <Button label="Try again" variant="secondary" onPress={() => booking.refetch()} />
          </View>
        )
      ) : (
        <Animated.View entering={enterUp} style={styles.page}>
          <View style={styles.section}>
            <Badge
              label={booking.data.statusLabel}
              background={statusColors(booking.data.status).background}
              textColor={statusColors(booking.data.status).text}
            />
            <Text variant="display">{booking.data.service.title}</Text>
            <Text tone="muted">with {booking.data.business.name}</Text>
          </View>

          {isNew ? (
            <FormAlert
              tone="success"
              message={
                booking.data.status === "requested"
                  ? booking.data.ongoing
                    ? `Request sent. ${booking.data.business.name} has 24 hours to accept; nothing is charged until then.`
                    : `Request sent. ${booking.data.business.name} has 24 hours to accept; your card is only held until then.`
                  : booking.data.ongoing
                    ? "You're booked. We've emailed you the details."
                    : "You're booked. We've emailed you a receipt."
              }
            />
          ) : null}
          {error ? <FormAlert tone="error" message={error.message} /> : null}

          {booking.data.ongoing ? (
            <>
              <OngoingBooking booking={booking.data} onUpdated={updated} />

              <Card style={styles.section}>
                <Text variant="heading">Where</Text>
                <Text>{booking.data.address.join("\n")}</Text>
                {booking.data.notes ? <Text tone="muted">“{booking.data.notes}”</Text> : null}
                {booking.data.approvalExpiresAt ? (
                  <Text variant="small" tone="muted">
                    Waiting for {booking.data.business.name} until{" "}
                    {deadlineFormat.format(booking.data.approvalExpiresAt)}.
                  </Text>
                ) : null}
                {booking.data.cancellationReason ? (
                  <Text>
                    {booking.data.business.name} ended it: “{booking.data.cancellationReason}”
                  </Text>
                ) : null}
              </Card>

              <Card style={styles.section}>
                <Text variant="heading">
                  {booking.data.ongoing.kind === "snow_contract" &&
                  booking.data.ongoing.pricing === "season"
                    ? "Season price"
                    : "Each visit"}
                </Text>
                <Line label="Price" value={formatCad(booking.data.amounts.priceCents)} />
                <Line label="Service fee" value={formatCad(booking.data.amounts.serviceFeeCents)} />
                {booking.data.amounts.taxCents > 0 ? (
                  <Line label="HST" value={formatCad(booking.data.amounts.taxCents)} />
                ) : null}
                <View style={styles.total}>
                  <Line label="Total" value={formatCad(booking.data.amounts.totalCents)} strong />
                </View>
                {booking.data.ongoing.kind === "recurring" ? (
                  <Text variant="small" tone="muted">
                    {booking.data.cancellationPolicy.label} cancellation applies to each visit.{" "}
                    {booking.data.cancellationPolicy.description}
                  </Text>
                ) : null}
              </Card>
            </>
          ) : (
            <>
              <Card style={styles.section}>
                <Text variant="heading">When and where</Text>
                <Text variant="bodyStrong">{booking.data.window.label}</Text>
                <Text variant="small" tone="muted">
                  The crew arrives during this window.
                </Text>
                <Text>{booking.data.address.join("\n")}</Text>
                {booking.data.notes ? <Text tone="muted">“{booking.data.notes}”</Text> : null}
                {booking.data.approvalExpiresAt ? (
                  <Text variant="small" tone="muted">
                    Waiting for {booking.data.business.name} until{" "}
                    {deadlineFormat.format(booking.data.approvalExpiresAt)}.
                  </Text>
                ) : null}
                {booking.data.cancellationReason ? (
                  <Text>
                    {booking.data.business.name} cancelled: “{booking.data.cancellationReason}”
                  </Text>
                ) : null}
                {booking.data.autoConfirmAt ? (
                  <Text variant="small" tone="muted">
                    {`Confirm or report a problem by ${deadlineFormat.format(booking.data.autoConfirmAt)}; after that it confirms automatically.`}
                  </Text>
                ) : null}
              </Card>

              {booking.data.actions.confirmDone || booking.data.actions.reportProblem ? (
                <Card style={styles.section}>
                  <Text variant="heading">Is the job done?</Text>
                  <Text tone="muted">
                    Confirm it&apos;s done, or tell the pro what&apos;s wrong. They have 3 days to
                    put it right, and payment waits until it&apos;s sorted.
                  </Text>
                  {reporting ? (
                    <>
                      <TextField
                        label="What's wrong?"
                        value={reason}
                        onChangeText={setReason}
                        multiline
                        maxLength={1000}
                        inputStyle={styles.multiline}
                      />
                      <Button
                        label="Send to the pro"
                        loading={report.isPending}
                        disabled={busy}
                        fullWidth
                        onPress={() => report.mutate({ bookingId: booking.data.id, reason })}
                      />
                      <Button
                        label="Never mind"
                        variant="ghost"
                        fullWidth
                        onPress={() => setReporting(false)}
                      />
                    </>
                  ) : (
                    <>
                      {booking.data.actions.confirmDone ? (
                        <Button
                          label="Yes, it's done"
                          loading={confirm.isPending}
                          disabled={busy}
                          fullWidth
                          onPress={() => confirm.mutate({ bookingId: booking.data.id })}
                        />
                      ) : null}
                      {booking.data.actions.reportProblem ? (
                        <Button
                          label="Report a problem"
                          variant="secondary"
                          disabled={busy}
                          fullWidth
                          onPress={() => setReporting(true)}
                        />
                      ) : null}
                    </>
                  )}
                </Card>
              ) : null}

              <Card style={styles.section}>
                <Text variant="heading">Payment</Text>
                <Line label="Job price" value={formatCad(booking.data.amounts.priceCents)} />
                <Line label="Service fee" value={formatCad(booking.data.amounts.serviceFeeCents)} />
                {booking.data.amounts.taxCents > 0 ? (
                  <Line label="HST" value={formatCad(booking.data.amounts.taxCents)} />
                ) : null}
                <View style={styles.total}>
                  <Line
                    label={booking.data.amounts.held ? "Held on your card" : "Total"}
                    value={formatCad(booking.data.amounts.totalCents)}
                    strong
                  />
                </View>
                {booking.data.amounts.refundedCents > 0 ? (
                  <Line label="Refunded" value={formatCad(booking.data.amounts.refundedCents)} />
                ) : null}
                <Text variant="small" tone="muted">
                  {booking.data.cancellationPolicy.label} cancellation.{" "}
                  {booking.data.cancellationPolicy.description}
                </Text>
              </Card>

              {booking.data.actions.cancel ? (
                <Button
                  label="Cancel booking"
                  variant="secondary"
                  disabled={busy}
                  loading={cancel.isPending}
                  fullWidth
                  onPress={() => askToCancel(booking.data)}
                />
              ) : null}
            </>
          )}

          <Button
            label={`See ${booking.data.business.name}`}
            variant="ghost"
            fullWidth
            onPress={() => router.push(`/pros/${booking.data.business.slug}`)}
          />
        </Animated.View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginVertical: space.xl },
  page: { gap: space.lg },
  section: { gap: 10 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  total: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    borderRadius: radius.input,
  },
  multiline: { minHeight: 96, textAlignVertical: "top", paddingTop: 12 },
});
