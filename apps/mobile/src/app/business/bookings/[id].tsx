import { formatCad } from "@nevile/core";
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
import { type BusinessJob, hours } from "@/components/business-job.tsx";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Chip } from "@/components/chip.tsx";
import { icons } from "@/components/icon.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert, TextField } from "@/lib/auth-ui.tsx";
import { deadlineFormat, statusColors } from "@/lib/bookings.ts";
import { canManage, type Membership } from "@/lib/business.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors } from "@/theme";

function Job({ membership, bookingId }: { membership: Membership; bookingId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const businessId = membership.business.id;
  const manager = canManage(membership.role);
  const input = { businessId, bookingId };
  const job = useQuery(trpc.businessBookings.get.queryOptions(input));
  const team = useQuery({ ...trpc.team.members.queryOptions({ businessId }), enabled: manager });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const done = (message: string) => ({
    onSuccess: async () => {
      AccessibilityInfo.announceForAccessibility(message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.businessBookings.get.queryKey(input) }),
        queryClient.invalidateQueries({ queryKey: trpc.businessBookings.calendar.queryKey() }),
        queryClient.invalidateQueries({
          queryKey: trpc.businessBookings.inbox.queryKey({ businessId }),
        }),
      ]);
    },
  });
  const accept = useMutation(trpc.businessBookings.accept.mutationOptions(done("Accepted.")));
  const decline = useMutation(trpc.businessBookings.decline.mutationOptions(done("Declined.")));
  const assign = useMutation(trpc.businessBookings.assign.mutationOptions(done("Crew updated.")));
  const markDone = useMutation(
    trpc.businessBookings.markDone.mutationOptions(done("Marked done.")),
  );
  const cancel = useMutation(
    trpc.businessBookings.cancel.mutationOptions({
      ...done("Job cancelled and refunded."),
      onSuccess: async () => {
        setCancelling(false);
        await done("Job cancelled and refunded.").onSuccess();
      },
    }),
  );
  const scheduleFix = useMutation(
    trpc.businessBookings.scheduleFix.mutationOptions(done("Fix scheduled.")),
  );
  const markFixed = useMutation(
    trpc.businessBookings.markFixed.mutationOptions(done("Marked fixed.")),
  );
  const mutations = [accept, decline, assign, markDone, cancel, scheduleFix, markFixed];
  const error = mutations.find((mutation) => mutation.error)?.error;
  const busy = mutations.some((mutation) => mutation.isPending);

  if (job.isPending)
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  if (job.isError) return <FormAlert tone="error" message={apiErrorMessage(job.error)} />;
  const data: BusinessJob = job.data;
  const { actions } = data;
  const tone = statusColors(data.status);
  const crew = (team.data ?? []).filter((member) => member.active);

  const confirmDecline = () =>
    Alert.alert(
      "Decline this request?",
      "The hold on the customer's card is released and they're told you can't take it.",
      [
        { text: "Keep it", style: "cancel" },
        { text: "Decline", style: "destructive", onPress: () => decline.mutate(input) },
      ],
    );

  return (
    <>
      <View style={styles.section}>
        <Badge label={data.statusLabel} background={tone.background} textColor={tone.text} />
        <Text variant="display">{data.service.title}</Text>
        <Text tone="muted">
          {data.customer.firstName} · {hours(data.workMinutes)} · you get{" "}
          {formatCad(data.payout.cents)}
        </Text>
      </View>

      {error ? <FormAlert tone="error" message={apiErrorMessage(error)} /> : null}

      <Card style={styles.section}>
        <Text variant="heading">When and where</Text>
        <Text variant="bodyStrong">{data.window.label}</Text>
        <Text>{data.address.join("\n")}</Text>
        {data.notes ? <Text tone="muted">“{data.notes}”</Text> : null}
        {data.approvalExpiresAt ? (
          <Text variant="small" tone="muted">
            Answer by {deadlineFormat.format(data.approvalExpiresAt)}, or the request expires.
          </Text>
        ) : null}
        {data.customer.phone ? (
          <Button
            label={`Call ${data.customer.firstName}`}
            variant="secondary"
            size="sm"
            onPress={() => void Linking.openURL(`tel:${data.customer.phone}`)}
          />
        ) : null}
        {data.customer.email ? (
          <Text variant="small" tone="muted">
            {data.customer.email}
          </Text>
        ) : null}
        {!data.customer.phone && !data.customer.email ? (
          <Text variant="small" tone="muted">
            Contact details show once the booking is paid.
          </Text>
        ) : null}
      </Card>

      {actions.assign && manager ? (
        <Card style={styles.section}>
          <Text variant="heading">Crew</Text>
          <View style={styles.chips}>
            <Chip
              label="Not assigned"
              selected={data.assignee === null}
              disabled={busy}
              onPress={() => assign.mutate({ ...input, memberId: null })}
            />
            {crew.map((member) => (
              <Chip
                key={member.id}
                label={member.isYou ? `${member.name} (you)` : member.name}
                selected={data.assignee?.id === member.id}
                disabled={busy}
                onPress={() => assign.mutate({ ...input, memberId: member.id })}
              />
            ))}
          </View>
        </Card>
      ) : data.assignee ? (
        <Card style={styles.section}>
          <Text variant="heading">Crew</Text>
          <Text>{data.assignee.name}</Text>
        </Card>
      ) : null}

      <View style={styles.section}>
        {actions.accept && manager ? (
          <Button
            label="Accept"
            fullWidth
            loading={accept.isPending}
            disabled={busy}
            onPress={() => accept.mutate(input)}
          />
        ) : null}
        {actions.decline && manager ? (
          <Button
            label="Decline"
            variant="secondary"
            fullWidth
            disabled={busy}
            onPress={confirmDecline}
          />
        ) : null}
        {actions.markDone ? (
          <Button
            label="Mark done"
            fullWidth
            loading={markDone.isPending}
            disabled={busy}
            onPress={() => markDone.mutate(input)}
          />
        ) : null}
        {actions.scheduleFix ? (
          <Button
            label="We'll come back to fix it"
            fullWidth
            loading={scheduleFix.isPending}
            disabled={busy}
            onPress={() => scheduleFix.mutate(input)}
          />
        ) : null}
        {actions.markFixed ? (
          <Button
            label="Mark fixed"
            fullWidth
            loading={markFixed.isPending}
            disabled={busy}
            onPress={() => markFixed.mutate(input)}
          />
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
      </View>

      {actions.cancel && manager ? (
        cancelling ? (
          <Card style={styles.section}>
            <Text variant="heading">Cancel this job?</Text>
            <Text tone="muted">
              The customer gets a full refund, and it counts on your reliability.
            </Text>
            <TextField
              label="Tell the customer why"
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={500}
              inputStyle={styles.multiline}
            />
            <Button
              label="Cancel and refund"
              fullWidth
              loading={cancel.isPending}
              disabled={busy || reason.trim().length < 3}
              onPress={() => cancel.mutate({ ...input, reason })}
            />
            <Button
              label="Keep the job"
              variant="ghost"
              fullWidth
              onPress={() => setCancelling(false)}
            />
          </Card>
        ) : (
          <Button
            label="Cancel job"
            variant="ghost"
            fullWidth
            onPress={() => setCancelling(true)}
          />
        )
      ) : null}
    </>
  );
}

/** One job in business mode: details, crew and every action the role allows (SPEC §19). */
export default function BusinessJobRoute() {
  const { id, businessId } = useLocalSearchParams<{ id: string; businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId} avoidKeyboard>
      {(membership) => <Job membership={membership} bookingId={id ?? ""} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  multiline: { minHeight: 88, textAlignVertical: "top", paddingTop: 12 },
});
