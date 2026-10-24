import {
  CATEGORY_SLUGS,
  type CategorySlug,
  centsToDollarInput,
  DEFAULT_CATEGORIES,
  formatDurationMinutes,
  parseDollarsToCents,
  SERVICE_DESCRIPTION_MAX_LENGTH,
  SERVICE_DURATION_CHOICES,
  SERVICE_TITLE_MAX_LENGTH,
  type ServiceInput,
} from "@nevile/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { Chip } from "@/components/chip.tsx";
import { RadioCard } from "@/components/radio-card.tsx";
import { Text } from "@/components/text.tsx";
import { Checkbox, FormAlert, TextField } from "@/lib/auth-ui.tsx";
import type { Membership } from "@/lib/business.ts";
import { type Listing, useListingChanged } from "@/lib/listing.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage, apiFieldErrors } from "@/lib/trpc-client.ts";
import { colors } from "@/theme";

/** Fields that show their own error next to the input. */
const FIELDS = ["categorySlug", "title", "description", "priceCents", "fromPriceCents"];

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
  existing: Listing["services"][number] | undefined;
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
    </>
  );
}

function Service({ membership, serviceId }: { membership: Membership; serviceId?: string }) {
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
      {(membership) => <Service membership={membership} serviceId={serviceId} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  multiline: { minHeight: 96, textAlignVertical: "top", paddingTop: 12 },
});
