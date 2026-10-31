import { formatArrivalWindow } from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Badge } from "@/components/badge.tsx";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Chip } from "@/components/chip.tsx";
import { Icon, type IconName, icons } from "@/components/icon.tsx";
import { ListRow } from "@/components/list-row.tsx";
import { PressableScale } from "@/components/pressable-scale.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert, TextField } from "@/lib/auth-ui.tsx";
import { canManage, type Membership } from "@/lib/business.ts";
import { dateLabel, hoursSummary } from "@/lib/team.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage, apiFieldErrors } from "@/lib/trpc-client.ts";
import { colors } from "@/theme";

const windowIcon = { ios: "clock", android: "schedule" } as const satisfies IconName;

function Invites({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const businessId = membership.business.id;
  const invites = useQuery(trpc.team.invites.queryOptions({ businessId }));
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"crew" | "manager">("crew");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.team.invites.queryKey({ businessId }) });
  const invite = useMutation(
    trpc.team.invite.mutationOptions({
      onSuccess: async () => {
        setSentTo(email);
        setEmail("");
        await refresh();
      },
    }),
  );
  const revoke = useMutation(trpc.team.revokeInvite.mutationOptions({ onSuccess: refresh }));
  const fieldErrors = apiFieldErrors(invite.error);

  return (
    <Card style={styles.section}>
      <Text variant="heading">Invite your crew</Text>
      <Text variant="small" tone="muted">
        We email them a link that works for 7 days. They join with that email address.
      </Text>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        error={fieldErrors.email}
      />
      {membership.role === "owner" ? (
        <View style={styles.chips} accessibilityRole="radiogroup">
          <Chip
            label="Crew"
            selected={role === "crew"}
            accessibilityRole="radio"
            accessibilityState={{ checked: role === "crew" }}
            onPress={() => setRole("crew")}
          />
          <Chip
            label="Manager"
            selected={role === "manager"}
            accessibilityRole="radio"
            accessibilityState={{ checked: role === "manager" }}
            onPress={() => setRole("manager")}
          />
        </View>
      ) : null}
      {invite.error && !fieldErrors.email ? (
        <FormAlert tone="error" message={apiErrorMessage(invite.error)} />
      ) : sentTo ? (
        <FormAlert tone="success" message={`Invite sent to ${sentTo}.`} />
      ) : null}
      <Button
        label="Send invite"
        loading={invite.isPending}
        disabled={!email.trim()}
        onPress={() => {
          setSentTo(null);
          invite.mutate({ businessId, email, role });
        }}
      />
      {invites.data && invites.data.length > 0 ? (
        <View style={styles.section}>
          <Text variant="bodyStrong">Waiting to join</Text>
          {invites.data.map((pending) => (
            <View key={pending.id} style={styles.invite}>
              <View style={styles.grow}>
                <Text numberOfLines={1}>{pending.email}</Text>
                <Text variant="small" tone="muted">
                  {pending.roleLabel} · link works until {dateLabel.format(pending.expiresAt)}
                </Text>
              </View>
              <Button
                label="Cancel"
                variant="ghost"
                size="sm"
                accessibilityLabel={`Cancel the invite to ${pending.email}`}
                disabled={revoke.isPending}
                onPress={() => revoke.mutate({ businessId, inviteId: pending.id })}
              />
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function Team({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const businessId = membership.business.id;
  const manager = canManage(membership.role);
  const members = useQuery(trpc.team.members.queryOptions({ businessId }));
  const settings = useQuery(trpc.team.settings.queryOptions({ businessId }));
  const refetch = members.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  return (
    <>
      <Text variant="display">Team</Text>
      <Text tone="muted">
        {manager
          ? "Everyone's working hours and time off decide which arrival windows customers can book."
          : "Your working hours and time off decide when you can be booked."}
      </Text>
      {members.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
      ) : members.isError ? (
        <FormAlert tone="error" message={apiErrorMessage(members.error)} />
      ) : (
        <View style={styles.section}>
          {members.data
            .filter((member) => member.active)
            .map((member) => {
              const editable = manager || member.isYou;
              return (
                <PressableScale
                  key={member.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${member.name}${member.isYou ? " (you)" : ""}, ${member.roleLabel}. ${hoursSummary(member)}`}
                  disabled={!editable}
                  pressedScale={0.98}
                  onPress={() =>
                    router.push({
                      pathname: "/business/member",
                      params: { businessId, memberId: member.id },
                    })
                  }
                  style={styles.member}
                >
                  <View style={styles.grow}>
                    <Text variant="bodyStrong">
                      {member.name}
                      {member.isYou ? <Text tone="muted"> (you)</Text> : null}
                    </Text>
                    <Text variant="small" tone="muted">
                      {hoursSummary(member)}
                      {member.timeOff.length > 0
                        ? ` · ${member.timeOff.length} time off booked`
                        : ""}
                    </Text>
                  </View>
                  <Badge label={member.roleLabel} size="sm" />
                  {editable ? (
                    <Icon name={icons.chevronRight} size={16} color={colors.muted} />
                  ) : null}
                </PressableScale>
              );
            })}
        </View>
      )}

      <Card flush style={styles.card}>
        <ListRow
          label="Booking windows"
          description={
            settings.data
              ? settings.data.windows.map((window) => formatArrivalWindow(window)).join(", ")
              : "Arrival windows and how far ahead customers book"
          }
          icon={windowIcon}
          onPress={() => router.push({ pathname: "/business/windows", params: { businessId } })}
        />
      </Card>

      {manager ? <Invites membership={membership} /> : null}
    </>
  );
}

/** Team members, their hours and time off, invites, and booking windows (SPEC §19). */
export default function BusinessTeamRoute() {
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId} avoidKeyboard>
      {(membership) => <Team key={membership.business.id} membership={membership} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  card: { overflow: "hidden" },
  chips: { flexDirection: "row", gap: 8 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  member: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  invite: { flexDirection: "row", alignItems: "center", gap: 8 },
});
