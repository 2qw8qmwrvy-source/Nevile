import {
  addCalendarDays,
  formatIsoDate,
  formatMinuteOfDay,
  fromLocal,
  parseIsoDate,
  toLocal,
} from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";

import { Badge } from "@/components/badge.tsx";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Stepper } from "@/components/stepper.tsx";
import { Text } from "@/components/text.tsx";
import { Checkbox, FormAlert, TextField } from "@/lib/auth-ui.tsx";
import { canManage, type Membership } from "@/lib/business.ts";
import { dateLabel, HOURS_RANGE, type TeamMember, TIME_STEP, WEEKDAYS } from "@/lib/team.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage } from "@/lib/trpc-client.ts";
import { colors } from "@/theme";

type Span = { weekday: number; startMinute: number; endMinute: number };
const MAX_DAYS_OFF = 60;
// Calendar dates are local days; format them in UTC so they don't shift.
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);

function HoursEditor({
  member,
  businessId,
  onSaved,
}: {
  member: TeamMember;
  businessId: string;
  onSaved: () => Promise<unknown>;
}) {
  const trpc = useTRPC();
  const [hours, setHours] = useState(
    () => new Map<number, Span>(member.hours.map((span) => [span.weekday, span])),
  );
  const [saved, setSaved] = useState(false);
  const save = useMutation(
    trpc.team.setHours.mutationOptions({
      onSuccess: async () => {
        setSaved(true);
        await onSaved();
      },
    }),
  );
  const update = (weekday: number, span: Span | null) => {
    setSaved(false);
    setHours((current) => {
      const next = new Map(current);
      if (span) next.set(weekday, span);
      else next.delete(weekday);
      return next;
    });
  };
  return (
    <Card style={styles.section}>
      <Text variant="heading">Working hours</Text>
      {WEEKDAYS.map(({ weekday, label }) => {
        const span = hours.get(weekday);
        return (
          <View key={weekday} style={styles.day}>
            <Checkbox
              checked={Boolean(span)}
              onChange={(on) =>
                update(weekday, on ? { weekday, startMinute: 480, endMinute: 1020 } : null)
              }
              label={label}
              description={span ? undefined : "Off"}
            />
            {span ? (
              <View style={styles.pair}>
                <Stepper
                  label={`${label} start`}
                  value={formatMinuteOfDay(span.startMinute)}
                  canLess={span.startMinute - TIME_STEP >= HOURS_RANGE.min}
                  canMore={span.startMinute + TIME_STEP < span.endMinute}
                  onLess={() =>
                    update(weekday, { ...span, startMinute: span.startMinute - TIME_STEP })
                  }
                  onMore={() =>
                    update(weekday, { ...span, startMinute: span.startMinute + TIME_STEP })
                  }
                />
                <Stepper
                  label={`${label} end`}
                  value={formatMinuteOfDay(span.endMinute)}
                  canLess={span.endMinute - TIME_STEP > span.startMinute}
                  canMore={span.endMinute + TIME_STEP <= HOURS_RANGE.max}
                  onLess={() => update(weekday, { ...span, endMinute: span.endMinute - TIME_STEP })}
                  onMore={() => update(weekday, { ...span, endMinute: span.endMinute + TIME_STEP })}
                />
              </View>
            ) : null}
          </View>
        );
      })}
      {save.error ? <FormAlert tone="error" message={apiErrorMessage(save.error)} /> : null}
      {saved && !save.isPending ? <FormAlert tone="success" message="Hours saved." /> : null}
      <Button
        label="Save hours"
        loading={save.isPending}
        onPress={() => save.mutate({ businessId, memberId: member.id, hours: [...hours.values()] })}
      />
    </Card>
  );
}

function TimeOffEditor({
  member,
  businessId,
  timeZone,
  onSaved,
}: {
  member: TeamMember;
  businessId: string;
  timeZone: string;
  onSaved: () => Promise<unknown>;
}) {
  const trpc = useTRPC();
  const today = (() => {
    const local = toLocal(new Date(), timeZone);
    return formatIsoDate({ year: local.year, month: local.month, day: local.day });
  })();
  const [first, setFirst] = useState(today);
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState("");
  const add = useMutation(
    trpc.team.addTimeOff.mutationOptions({
      onSuccess: async () => {
        setDays(1);
        setReason("");
        await onSaved();
      },
    }),
  );
  const remove = useMutation(trpc.team.removeTimeOff.mutationOptions({ onSuccess: onSaved }));
  const shiftFirst = (by: number) => {
    const date = parseIsoDate(first);
    if (date) setFirst(formatIsoDate(addCalendarDays(date, by)));
  };
  const firstDate = parseIsoDate(first);
  const lastIso = firstDate ? formatIsoDate(addCalendarDays(firstDate, days - 1)) : first;

  return (
    <Card style={styles.section}>
      <Text variant="heading">Time off</Text>
      {member.timeOff.length === 0 ? (
        <Text tone="muted">No time off booked.</Text>
      ) : (
        member.timeOff.map((block) => (
          <View key={block.id} style={styles.block}>
            <Text style={styles.grow}>
              {dateLabel.format(block.startsAt)} to{" "}
              {dateLabel.format(new Date(block.endsAt.getTime() - 1))}
              {block.reason ? ` · ${block.reason}` : ""}
            </Text>
            <Button
              label="Remove"
              variant="ghost"
              size="sm"
              disabled={remove.isPending}
              onPress={() => remove.mutate({ businessId, timeOffId: block.id })}
            />
          </View>
        ))
      )}
      <Text variant="bodyStrong">Add time off</Text>
      <View style={styles.pair}>
        <Stepper
          label="First day off"
          value={dayFormat.format(asDate(first))}
          canLess={first > today}
          canMore
          onLess={() => shiftFirst(-1)}
          onMore={() => shiftFirst(1)}
        />
        <Stepper
          label="Days off"
          value={`${days} ${days === 1 ? "day" : "days"}`}
          canLess={days > 1}
          canMore={days < MAX_DAYS_OFF}
          onLess={() => setDays((value) => value - 1)}
          onMore={() => setDays((value) => value + 1)}
        />
      </View>
      <Text variant="small" tone="muted">
        {days === 1
          ? `Off on ${dayFormat.format(asDate(first))}.`
          : `Off from ${dayFormat.format(asDate(first))} to ${dayFormat.format(asDate(lastIso))}.`}
      </Text>
      <TextField label="Note (optional)" value={reason} onChangeText={setReason} maxLength={120} />
      {add.error || remove.error ? (
        <FormAlert tone="error" message={apiErrorMessage(add.error ?? remove.error)} />
      ) : null}
      <Button
        label="Add time off"
        variant="secondary"
        loading={add.isPending}
        onPress={() => {
          if (!firstDate) return;
          add.mutate({
            businessId,
            memberId: member.id,
            startsAt: fromLocal(firstDate, timeZone),
            endsAt: fromLocal(addCalendarDays(firstDate, days), timeZone),
            reason: reason || undefined,
          });
        }}
      />
    </Card>
  );
}

function Member({ membership, memberId }: { membership: Membership; memberId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const businessId = membership.business.id;
  const members = useQuery(trpc.team.members.queryOptions({ businessId }));
  const settings = useQuery(trpc.team.settings.queryOptions({ businessId }));
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.team.members.queryKey({ businessId }) }),
      queryClient.invalidateQueries({ queryKey: trpc.businessBookings.calendar.queryKey() }),
    ]);
  const deactivate = useMutation(
    trpc.team.deactivate.mutationOptions({
      onSuccess: async () => {
        await refresh();
        if (router.canGoBack()) router.back();
      },
    }),
  );

  if (members.isPending || settings.isPending) {
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  }
  if (members.isError) return <FormAlert tone="error" message={apiErrorMessage(members.error)} />;
  const member = members.data.find((candidate) => candidate.id === memberId);
  if (!member) return <FormAlert tone="error" message="That team member isn't on the team." />;
  const canEdit = canManage(membership.role) || member.isYou;
  const canRemove =
    !member.isYou &&
    member.role !== "owner" &&
    (membership.role === "owner" || (membership.role === "manager" && member.role === "crew"));
  const timeZone = settings.data?.timezone ?? "America/Halifax";

  const confirmRemove = () =>
    Alert.alert(
      `Remove ${member.name} from the team?`,
      "Their upcoming jobs go back to unassigned.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => deactivate.mutate({ businessId, memberId: member.id }),
        },
      ],
    );

  return (
    <>
      <View style={styles.section}>
        <Text variant="display">
          {member.name}
          {member.isYou ? <Text tone="muted"> (you)</Text> : null}
        </Text>
        <View style={styles.row}>
          <Badge label={member.roleLabel} size="sm" />
          {member.email ? (
            <Text variant="small" tone="muted">
              {member.email}
            </Text>
          ) : null}
        </View>
      </View>
      {canEdit ? (
        <>
          <HoursEditor member={member} businessId={businessId} onSaved={refresh} />
          <TimeOffEditor
            member={member}
            businessId={businessId}
            timeZone={timeZone}
            onSaved={refresh}
          />
        </>
      ) : (
        <Text tone="muted">You can see your own hours here; ask a manager to change others.</Text>
      )}
      {deactivate.error ? (
        <FormAlert tone="error" message={apiErrorMessage(deactivate.error)} />
      ) : null}
      {canRemove ? (
        <Button
          label="Remove from team"
          variant="ghost"
          fullWidth
          loading={deactivate.isPending}
          onPress={confirmRemove}
        />
      ) : null}
    </>
  );
}

/** One team member: weekly hours, time off, and removing them (SPEC §19). */
export default function BusinessMemberRoute() {
  const { businessId, memberId } = useLocalSearchParams<{
    businessId?: string;
    memberId: string;
  }>();
  return (
    <BusinessScreen businessId={businessId} avoidKeyboard>
      {(membership) => <Member membership={membership} memberId={memberId ?? ""} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  day: { gap: 6 },
  pair: { gap: 8 },
  block: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1, minWidth: 0 },
});
