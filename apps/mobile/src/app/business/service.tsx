import {
  CATEGORY_SLUGS,
  type CategorySlug,
  centsToDollarInput,
  DEFAULT_CATEGORIES,
  FREQUENCY_LABELS,
  formatCad,
  formatDurationMinutes,
  parseDollarsToCents,
  RECURRENCE_FREQUENCIES,
  SERVICE_DESCRIPTION_MAX_LENGTH,
  SERVICE_DURATION_CHOICES,
  SERVICE_TITLE_MAX_LENGTH,
  type ServiceInput,
  SNOW_CONTRACT_LIMITS,
} from "@nevile/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Chip } from "@/components/chip.tsx";
import {
  type ContractDraft,
  ContractFields,
  defaultContractDraft,
} from "@/components/contract-fields.tsx";
import { RadioCard } from "@/components/radio-card.tsx";
import { Stepper } from "@/components/stepper.tsx";
import { Text } from "@/components/text.tsx";
import { Checkbox, FormAlert, TextField } from "@/lib/auth-ui.tsx";
import type { Membership } from "@/lib/business.ts";
import { type Listing, useListingChanged } from "@/lib/listing.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage, apiFieldErrors } from "@/lib/trpc-client.ts";
import { colors } from "@/theme";

/** Fields that show their own error next to the input. */
const FIELDS = [
  "categorySlug",
  "title",
  "description",
  "priceCents",
  "fromPriceCents",
  "recurrenceFrequencies",
];
const SNOW = "snow-ice-removal";
const seasonDay = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const asDay = (iso: string) => seasonDay.format(new Date(`${iso}T12:00:00Z`));

type Service = Listing["services"][number];

/**
 * A Snow & Ice Removal service listed as a seasonal contract (SPEC §21): trigger, season,
 * price per visit or for the season (and how it's paid), and how many customers it takes.
 */
function ContractTerms({ businessId, service }: { businessId: string; service: Service }) {
  const trpc = useTRPC();
  const changed = useListingChanged(businessId);
  const contract = service.contract;
  const recurring = service.recurrenceFrequencies.length > 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ContractDraft>(() =>
    contract
      ? {
          triggerCm: contract.triggerCm,
          seasonStart: contract.seasonStart,
          seasonEnd: contract.seasonEnd,
          pricing: contract.pricing,
          seasonBilling: contract.seasonBilling ?? "either",
        }
      : defaultContractDraft(),
  );
  const [price, setPrice] = useState(contract ? centsToDollarInput(contract.priceCents) : "");
  const [spots, setSpots] = useState(contract?.spots ?? 20);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation(
    trpc.listing.setContractTerms.mutationOptions({
      onSuccess: async () => {
        setEditing(false);
        await changed();
      },
    }),
  );
  const fieldErrors = apiFieldErrors(save.error);
  const fieldError = Object.entries(fieldErrors).find(([key]) => key.startsWith("terms"))?.[1];

  function submit() {
    setProblem(null);
    const priceCents = parseDollarsToCents(price);
    if (priceCents === null) {
      setProblem("Enter the price, like 600 or 45.");
      return;
    }
    save.mutate({
      businessId,
      serviceId: service.id,
      terms: {
        ...draft,
        seasonBilling: draft.pricing === "season" ? draft.seasonBilling : null,
        priceCents,
        spots,
      },
    });
  }

  return (
    <Card style={styles.section}>
      <Text variant="heading">Seasonal contract</Text>
      {!editing ? (
        <>
          <Text tone="muted">
            {contract
              ? `${formatCad(contract.priceCents)} ${
                  contract.pricing === "season"
                    ? `for the season (${
                        contract.seasonBilling === "either"
                          ? "upfront or monthly"
                          : `paid ${contract.seasonBilling}`
                      })`
                    : "per visit"
                } · from ${contract.triggerCm} cm · ${asDay(contract.seasonStart)} to ${asDay(
                  contract.seasonEnd,
                )} · ${contract.spotsLeft} of ${contract.spots} spots left`
              : "Offer this as a seasonal contract: customers sign up for the whole winter and you clear them from your snow route."}
          </Text>
          {save.error ? <FormAlert tone="error" message={apiErrorMessage(save.error)} /> : null}
          {recurring && !contract ? (
            <Text variant="small" tone="muted">
              Turn off recurring visits for this service first.
            </Text>
          ) : null}
          <Button
            label={contract ? "Edit contract" : "Set up a seasonal contract"}
            variant="secondary"
            fullWidth
            disabled={recurring && !contract}
            onPress={() => setEditing(true)}
          />
          {contract ? (
            <Button
              label="Stop offering it"
              variant="ghost"
              fullWidth
              loading={save.isPending}
              onPress={() => save.mutate({ businessId, serviceId: service.id, terms: null })}
            />
          ) : null}
        </>
      ) : (
        <>
          <ContractFields value={draft} onChange={setDraft} />
          <TextField
            label={draft.pricing === "season" ? "Season price ($)" : "Price per visit ($)"}
            hint="Before HST and Nevile's fee."
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
          />
          <Stepper
            label="Spots (how many customers you can take)"
            value={String(spots)}
            canLess={spots > SNOW_CONTRACT_LIMITS.minSpots}
            canMore={spots < SNOW_CONTRACT_LIMITS.maxSpots}
            onLess={() => setSpots((value) => value - 1)}
            onMore={() => setSpots((value) => value + 1)}
          />
          {problem || save.error ? (
            <FormAlert
              tone="error"
              message={problem ?? fieldError ?? apiErrorMessage(save.error)}
            />
          ) : null}
          <Text variant="small" tone="muted">
            Customers who already signed up keep the terms they agreed to.
          </Text>
          <Button label="Save contract" fullWidth loading={save.isPending} onPress={submit} />
          <Button label="Cancel" variant="ghost" fullWidth onPress={() => setEditing(false)} />
        </>
      )}
    </Card>
  );
}

const BLANK: ServiceInput = {
  categorySlug: CATEGORY_SLUGS[0],
  title: "",
  description: "",
  pricingType: "fixed",
  priceCents: null,
  fromPriceCents: null,
  durationMinutes: 60,
  instantBook: true,
  active: true,
};

function ServiceForm({
  businessId,
  existing,
}: {
  businessId: string;
  existing: Service | undefined;
}) {
  const trpc = useTRPC();
  const changed = useListingChanged(businessId);
  const initial: ServiceInput = existing
    ? {
        categorySlug: existing.categorySlug as CategorySlug,
        title: existing.title,
        description: existing.description,
        pricingType: existing.pricingType,
        priceCents: existing.priceCents,
        fromPriceCents: existing.fromPriceCents,
        durationMinutes: existing.durationMinutes,
        instantBook: existing.instantBook,
        active: existing.active,
        recurrenceFrequencies: existing.recurrenceFrequencies,
      }
    : BLANK;
  const [values, setValues] = useState(initial);
  const [price, setPrice] = useState(
    initial.priceCents != null ? centsToDollarInput(initial.priceCents) : "",
  );
  const [fromPrice, setFromPrice] = useState(
    initial.fromPriceCents != null ? centsToDollarInput(initial.fromPriceCents) : "",
  );
  const [local, setLocal] = useState<{ price?: string; fromPrice?: string }>({});
  const set = <K extends keyof ServiceInput>(key: K, value: ServiceInput[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const fixed = values.pricingType === "fixed";
  // A seasonal contract can't also be booked as recurring visits.
  const contract = Boolean(existing?.contract);
  const chosenFrequencies = values.recurrenceFrequencies ?? [];

  const done = {
    onSuccess: async (result: { unpublished: boolean }) => {
      await changed(result);
      if (router.canGoBack()) router.back();
    },
  };
  const create = useMutation(trpc.listing.createService.mutationOptions(done));
  const update = useMutation(trpc.listing.updateService.mutationOptions(done));
  const remove = useMutation(trpc.listing.deleteService.mutationOptions(done));
  const saving = create.isPending || update.isPending || remove.isPending;
  const error = create.error ?? update.error ?? remove.error;
  const raw = apiFieldErrors(create.error ?? update.error);
  // updateService nests the service under `service`.
  const field = (name: string) => raw[name] ?? raw[`service.${name}`];

  function save() {
    const problems: { price?: string; fromPrice?: string } = {};
    const priceCents = fixed ? parseDollarsToCents(price) : null;
    if (fixed && priceCents === null)
      problems.price = "Enter the price per visit, like 60 or 60.50.";
    const fromCents = !fixed && fromPrice.trim() ? parseDollarsToCents(fromPrice) : null;
    if (!fixed && fromPrice.trim() && fromCents === null) {
      problems.fromPrice = "Enter an amount like 45, or leave it empty.";
    }
    setLocal(problems);
    if (problems.price || problems.fromPrice) return;
    const service = {
      ...values,
      priceCents,
      fromPriceCents: fromCents,
      instantBook: fixed ? values.instantBook : false,
      // Recurring schedules are for fixed prices only; keep them unless that changes.
      recurrenceFrequencies: fixed && !contract ? chosenFrequencies : [],
    };
    if (existing) update.mutate({ businessId, serviceId: existing.id, service });
    else create.mutate({ businessId, ...service });
  }

  const confirmDelete = () =>
    existing &&
    Alert.alert("Delete this service?", "It disappears from your page right away.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => remove.mutate({ businessId, serviceId: existing.id }),
      },
    ]);

  return (
    <>
      <Text variant="display">{existing ? "Edit service" : "Add a service"}</Text>
      <View style={styles.group}>
        <Text variant="bodyStrong">Category</Text>
        <View style={styles.chips}>
          {DEFAULT_CATEGORIES.map((category) => (
            <Chip
              key={category.slug}
              label={category.name}
              selected={values.categorySlug === category.slug}
              onPress={() => set("categorySlug", category.slug)}
            />
          ))}
        </View>
        {field("categorySlug") ? (
          <Text variant="small" tone="danger">
            {field("categorySlug")}
          </Text>
        ) : null}
      </View>
      <TextField
        label="Service name"
        placeholder="e.g. Weekly mowing"
        value={values.title}
        onChangeText={(title) => set("title", title)}
        maxLength={SERVICE_TITLE_MAX_LENGTH}
        error={field("title")}
      />
      <TextField
        label="Description (optional)"
        hint="What's included, and anything customers should know."
        value={values.description}
        onChangeText={(description) => set("description", description)}
        multiline
        maxLength={SERVICE_DESCRIPTION_MAX_LENGTH}
        inputStyle={styles.multiline}
        error={field("description")}
      />
      <View style={styles.group} accessibilityRole="radiogroup">
        <Text variant="bodyStrong">Pricing</Text>
        <RadioCard
          label="Fixed price per visit"
          description="Customers see the price and book."
          checked={fixed}
          onPress={() => set("pricingType", "fixed")}
        />
        <RadioCard
          label="Request a quote"
          description="You send a price after the customer describes the job."
          checked={!fixed}
          onPress={() => set("pricingType", "quote")}
        />
      </View>
      {fixed ? (
        <TextField
          label="Price per visit ($)"
          hint="Before HST and Nevile's fee."
          placeholder="60"
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          error={local.price ?? field("priceCents")}
        />
      ) : (
        <TextField
          label="From price ($, optional)"
          hint="Shown as “Quote · from $45”."
          placeholder="45"
          value={fromPrice}
          onChangeText={setFromPrice}
          keyboardType="decimal-pad"
          error={local.fromPrice ?? field("fromPriceCents")}
        />
      )}
      <View style={styles.group} accessibilityRole="radiogroup">
        <Text variant="bodyStrong">Typical time on site</Text>
        <View style={styles.chips}>
          {SERVICE_DURATION_CHOICES.map((minutes) => (
            <Chip
              key={minutes}
              label={formatDurationMinutes(minutes)}
              selected={values.durationMinutes === minutes}
              accessibilityRole="radio"
              accessibilityState={{ checked: values.durationMinutes === minutes }}
              onPress={() => set("durationMinutes", minutes)}
            />
          ))}
        </View>
      </View>
      {fixed ? (
        <Checkbox
          checked={values.instantBook}
          onChange={(checked) => set("instantBook", checked)}
          label="Allow Instant Book for this service"
          description="Applies when Instant Book is on in your profile."
        />
      ) : null}
      {fixed && !contract ? (
        <View style={styles.group}>
          <Text variant="bodyStrong">Recurring visits</Text>
          <Text variant="small" tone="muted">
            Let customers book this on a schedule (up to 6 months). You accept each series.
          </Text>
          {RECURRENCE_FREQUENCIES.map((frequency) => (
            <Checkbox
              key={frequency}
              label={FREQUENCY_LABELS[frequency]}
              checked={chosenFrequencies.includes(frequency)}
              onChange={(on) =>
                set(
                  "recurrenceFrequencies",
                  on
                    ? RECURRENCE_FREQUENCIES.filter(
                        (option) => option === frequency || chosenFrequencies.includes(option),
                      )
                    : chosenFrequencies.filter((option) => option !== frequency),
                )
              }
            />
          ))}
          {field("recurrenceFrequencies") ? (
            <Text variant="small" tone="danger">
              {field("recurrenceFrequencies")}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Checkbox
        checked={values.active}
        onChange={(checked) => set("active", checked)}
        label="Show this service to customers"
      />
      {error && !FIELDS.some((name) => field(name)) ? (
        <FormAlert tone="error" message={raw.service ?? apiErrorMessage(error)} />
      ) : null}
      <Button
        label={existing ? "Save service" : "Add service"}
        fullWidth
        loading={create.isPending || update.isPending}
        disabled={saving}
        onPress={save}
      />
      {existing ? (
        <Button
          label="Delete service"
          variant="ghost"
          fullWidth
          loading={remove.isPending}
          disabled={saving}
          onPress={confirmDelete}
        />
      ) : null}
      {existing && existing.categorySlug === SNOW ? (
        <ContractTerms businessId={businessId} service={existing} />
      ) : null}
    </>
  );
}

function ServiceScreen({ membership, serviceId }: { membership: Membership; serviceId?: string }) {
  const trpc = useTRPC();
  const businessId = membership.business.id;
  const listing = useQuery(trpc.listing.get.queryOptions({ businessId }));
  if (listing.isPending)
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  if (listing.isError) return <FormAlert tone="error" message={apiErrorMessage(listing.error)} />;
  if (!listing.data.canEdit) {
    return <FormAlert tone="info" message="Only the owner and managers can change services." />;
  }
  const existing = serviceId
    ? listing.data.services.find((service) => service.id === serviceId)
    : undefined;
  if (serviceId && !existing) return <FormAlert tone="error" message="That service is gone." />;
  return <ServiceForm key={existing?.id ?? "new"} businessId={businessId} existing={existing} />;
}

/** Add or edit a service: category, name, pricing, time on site (SPEC §18). */
export default function BusinessServiceRoute() {
  const { businessId, serviceId } = useLocalSearchParams<{
    businessId?: string;
    serviceId?: string;
  }>();
  return (
    <BusinessScreen businessId={businessId} avoidKeyboard>
      {(membership) => <ServiceScreen membership={membership} serviceId={serviceId} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  group: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  multiline: { minHeight: 96, textAlignVertical: "top", paddingTop: 12 },
});
