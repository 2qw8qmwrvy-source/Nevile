import {
  centsToDollarInput,
  endSentence,
  FREQUENCY_LABELS,
  formatCad,
  formatDurationMinutes,
  parseDollarsToCents,
  QUOTE_LIMITS,
  type QuoteKind,
  RECURRENCE_FREQUENCIES,
  type RecurrenceFrequency,
  SERVICE_DURATION_CHOICES,
} from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, StyleSheet, View } from "react-native";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Chip } from "@/components/chip.tsx";
import {
  type ContractDraft,
  ContractFields,
  defaultContractDraft,
} from "@/components/contract-fields.tsx";
import { icons } from "@/components/icon.tsx";
import { PrivatePhotoGrid } from "@/components/private-photos.tsx";
import { Text } from "@/components/text.tsx";
import { Checkbox, FormAlert, TextField } from "@/lib/auth-ui.tsx";
import type { Membership } from "@/lib/business.ts";
import { replyByFormat } from "@/lib/quotes.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage, apiFieldErrors } from "@/lib/trpc-client.ts";
import { colors } from "@/theme";

function Reply({ membership, requestId }: { membership: Membership; requestId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const businessId = membership.business.id;
  const input = { businessId, requestId };
  const query = useQuery(trpc.businessQuotes.get.queryOptions(input));
  const [price, setPrice] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [kind, setKind] = useState<QuoteKind | null>(null);
  const [frequencies, setFrequencies] = useState<RecurrenceFrequency[] | null>(null);
  const [contract, setContract] = useState<ContractDraft | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.businessQuotes.get.queryKey(input) }),
      queryClient.invalidateQueries({
        queryKey: trpc.businessQuotes.list.queryKey({ businessId }),
      }),
    ]);
  const reply = useMutation(
    trpc.businessQuotes.reply.mutationOptions({
      onSuccess: async () => {
        setSent(true);
        AccessibilityInfo.announceForAccessibility("Quote sent.");
        await refresh();
      },
    }),
  );
  const decline = useMutation(
    trpc.businessQuotes.decline.mutationOptions({
      onSuccess: async () => {
        setDeclining(false);
        AccessibilityInfo.announceForAccessibility("Request declined.");
        await refresh();
      },
    }),
  );

  if (query.isPending) {
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  }
  if (query.isError) return <FormAlert tone="error" message={apiErrorMessage(query.error)} />;
  const request = query.data;
  // Start from the quote already sent, until the pro edits a field.
  const priceValue = price ?? (request.quote ? centsToDollarInput(request.quote.priceCents) : "");
  const durationValue = duration ?? request.quote?.durationMinutes ?? 60;
  const noteValue = note ?? request.quote?.note ?? "";
  // What the quote offers (SPEC §21): one job, recurring visits, or snow contract terms.
  const snowRequest = request.category.slug === "snow-ice-removal";
  const sentKind = request.quote?.kind;
  const kindValue: QuoteKind =
    kind ?? (sentKind === "recurring" || sentKind === "snow_contract" ? sentKind : "one_off");
  const frequenciesValue = frequencies ??
    request.quote?.frequencies.map((option) => option.value) ?? ["weekly"];
  const sentContract = request.quote?.contract;
  const contractValue: ContractDraft =
    contract ??
    (sentContract
      ? {
          triggerCm: sentContract.triggerCm,
          seasonStart: sentContract.seasonStart,
          seasonEnd: sentContract.seasonEnd,
          pricing: sentContract.pricing,
          seasonBilling: sentContract.seasonBilling ?? "either",
        }
      : defaultContractDraft());
  const kinds: Array<{ value: QuoteKind; label: string }> = [
    { value: "one_off", label: "One job" },
    { value: "recurring", label: "Recurring visits" },
    ...(snowRequest ? [{ value: "snow_contract" as const, label: "Snow contract" }] : []),
  ];
  const fieldErrors = apiFieldErrors(reply.error);
  const ongoingBooking = request.quote !== null && request.quote.kind !== "one_off";

  function toggleFrequency(frequency: RecurrenceFrequency, on: boolean) {
    setFrequencies(
      on
        ? RECURRENCE_FREQUENCIES.filter(
            (option) => option === frequency || frequenciesValue.includes(option),
          )
        : frequenciesValue.filter((option) => option !== frequency),
    );
  }

  function send() {
    setProblem(null);
    setSent(false);
    const cents = parseDollarsToCents(priceValue);
    if (cents === null) {
      setProblem("Enter the price, like 120 or 120.50.");
      return;
    }
    if (kindValue === "recurring" && frequenciesValue.length === 0) {
      setProblem("Pick at least one schedule.");
      return;
    }
    reply.mutate({
      ...input,
      kind: kindValue,
      priceCents: cents,
      durationMinutes: kindValue === "snow_contract" ? undefined : durationValue,
      frequencies: kindValue === "recurring" ? frequenciesValue : [],
      contract:
        kindValue === "snow_contract"
          ? {
              triggerCm: contractValue.triggerCm,
              seasonStart: contractValue.seasonStart,
              seasonEnd: contractValue.seasonEnd,
              pricing: contractValue.pricing,
              seasonBilling:
                contractValue.pricing === "season" ? contractValue.seasonBilling : null,
            }
          : null,
      note: noteValue,
    });
  }

  return (
    <>
      <View style={styles.section}>
        <Text variant="small" tone="muted">
          {request.statusLabel}
        </Text>
        <Text variant="display">
          {request.category.name} for {request.customer.firstName}
        </Text>
        <Text tone="muted">
          Near {request.area} · {request.timingLabel}
        </Text>
      </View>

      <Card style={styles.section}>
        <Text>{request.details}</Text>
        <PrivatePhotoGrid photos={request.photos} size={88} />
        {request.replyBy ? (
          <Text variant="bodyStrong" tone="primary">
            Reply by {endSentence(replyByFormat.format(request.replyBy))}
          </Text>
        ) : null}
        {request.declineReason ? <Text>You declined: “{request.declineReason}”</Text> : null}
        <View style={styles.actions}>
          {request.conversationId ? (
            <Button
              label={`Message ${request.customer.firstName}`}
              variant="secondary"
              size="sm"
              icon={icons.chat}
              onPress={() =>
                router.push({
                  pathname: "/inbox/[conversationId]",
                  params: { conversationId: request.conversationId ?? "" },
                })
              }
            />
          ) : null}
          {request.bookingId ? (
            <Button
              label="Booked: see the job"
              size="sm"
              onPress={() =>
                router.push({
                  pathname: ongoingBooking ? "/business/series/[id]" : "/business/bookings/[id]",
                  params: { id: request.bookingId ?? "", businessId },
                })
              }
            />
          ) : null}
        </View>
      </Card>

      {request.canReply ? (
        <Card style={styles.section}>
          <Text variant="heading">{request.quote ? "Your quote" : "Send a quote"}</Text>
          {request.quote ? (
            <Text>Sent: {request.quote.summary}. Sending a new one replaces it.</Text>
          ) : null}
          <Text variant="bodyStrong">What you offer</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {kinds.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={kindValue === option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: kindValue === option.value }}
                onPress={() => setKind(option.value)}
              />
            ))}
          </View>
          <TextField
            label={
              kindValue === "one_off"
                ? "Price for the job ($)"
                : kindValue === "recurring" || contractValue.pricing === "per_visit"
                  ? "Price per visit ($)"
                  : "Price for the season ($)"
            }
            hint="Before Nevile's service fee, which the customer pays."
            value={priceValue}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            error={fieldErrors.priceCents}
          />
          {kindValue !== "snow_contract" ? (
            <>
              <Text variant="bodyStrong">
                {kindValue === "recurring" ? "How long each visit takes" : "How long the job takes"}
              </Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {SERVICE_DURATION_CHOICES.map((minutes) => (
                  <Chip
                    key={minutes}
                    label={formatDurationMinutes(minutes)}
                    selected={durationValue === minutes}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: durationValue === minutes }}
                    onPress={() => setDuration(minutes)}
                  />
                ))}
              </View>
            </>
          ) : null}
          {kindValue === "recurring" ? (
            <View>
              <Text variant="bodyStrong">Schedules the customer can pick</Text>
              {RECURRENCE_FREQUENCIES.map((frequency) => (
                <Checkbox
                  key={frequency}
                  label={FREQUENCY_LABELS[frequency]}
                  checked={frequenciesValue.includes(frequency)}
                  onChange={(on) => toggleFrequency(frequency, on)}
                />
              ))}
            </View>
          ) : null}
          {kindValue === "snow_contract" ? (
            <>
              <ContractFields value={contractValue} onChange={setContract} />
              {fieldErrors.contract ? (
                <FormAlert tone="error" message={fieldErrors.contract} />
              ) : null}
            </>
          ) : null}
          <TextField
            label="What's included (optional)"
            hint={`${noteValue.length}/${QUOTE_LIMITS.noteMaxLength}`}
            value={noteValue}
            onChangeText={setNote}
            multiline
            maxLength={QUOTE_LIMITS.noteMaxLength}
            inputStyle={styles.multiline}
            error={fieldErrors.note}
          />
          {problem || (reply.error && Object.keys(fieldErrors).length === 0) ? (
            <FormAlert tone="error" message={problem ?? apiErrorMessage(reply.error)} />
          ) : null}
          {sent && !reply.isPending ? (
            <FormAlert tone="success" message="Quote sent. We've let the customer know." />
          ) : null}
          <Button
            label={request.quote ? "Send new quote" : "Send quote"}
            fullWidth
            loading={reply.isPending}
            onPress={send}
          />
          {declining ? (
            <>
              <TextField
                label="Why can't you take it?"
                value={reason}
                onChangeText={setReason}
                maxLength={QUOTE_LIMITS.declineReasonMaxLength}
                error={decline.error ? apiErrorMessage(decline.error) : null}
              />
              <Button
                label="Decline request"
                variant="secondary"
                fullWidth
                loading={decline.isPending}
                onPress={() => decline.mutate({ ...input, reason })}
              />
              <Button
                label="Never mind"
                variant="ghost"
                fullWidth
                onPress={() => setDeclining(false)}
              />
            </>
          ) : (
            <Button
              label="Can't take it? Decline"
              variant="ghost"
              fullWidth
              onPress={() => setDeclining(true)}
            />
          )}
        </Card>
      ) : request.quote ? (
        <Card style={styles.section}>
          <Text variant="heading">Your quote</Text>
          <Text variant="display">{formatCad(request.quote.priceCents)}</Text>
          <Text tone="muted">{request.quote.summary}</Text>
        </Card>
      ) : null}
    </>
  );
}

/** One quote request: what the customer asked, and the quote or decline (SPEC §20). */
export default function BusinessQuoteRoute() {
  const { requestId, businessId } = useLocalSearchParams<{
    requestId: string;
    businessId?: string;
  }>();
  return (
    <BusinessScreen businessId={businessId} managed avoidKeyboard>
      {(membership) => <Reply membership={membership} requestId={requestId ?? ""} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  multiline: { minHeight: 88, textAlignVertical: "top", paddingTop: 12 },
});
