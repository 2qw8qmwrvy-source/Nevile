import {
  BUSINESS_NAME_MAX_LENGTH,
  CANCELLATION_POLICIES,
  CANCELLATION_POLICY_IDS,
  type CancellationPolicyId,
  LISTING_ABOUT_MAX_LENGTH,
  LISTING_ABOUT_MIN_LENGTH,
} from "@nevile/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { BusinessScreen } from "@/components/business-screen.tsx";
import { Button } from "@/components/button.tsx";
import { RadioCard } from "@/components/radio-card.tsx";
import { Text } from "@/components/text.tsx";
import { Checkbox, FormAlert, TextField } from "@/lib/auth-ui.tsx";
import type { Membership } from "@/lib/business.ts";
import { type Listing, useListingChanged } from "@/lib/listing.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { apiErrorMessage, apiFieldErrors } from "@/lib/trpc-client.ts";
import { colors } from "@/theme";

function ProfileForm({ businessId, listing }: { businessId: string; listing: Listing }) {
  const trpc = useTRPC();
  const changed = useListingChanged(businessId);
  const { business, canEdit } = listing;
  const [name, setName] = useState(business.name);
  const [description, setDescription] = useState(business.description);
  const [gstHstNumber, setGstHstNumber] = useState(business.gstHstNumber ?? "");
  const [policy, setPolicy] = useState<CancellationPolicyId>(business.cancellationPolicy);
  const [instantBook, setInstantBook] = useState(business.instantBook);
  const [takesQuotes, setTakesQuotes] = useState(business.acceptsQuoteRequests);
  const save = useMutation(
    trpc.listing.updateProfile.mutationOptions({
      onSuccess: async (result) => {
        await changed(result);
        if (router.canGoBack()) router.back();
      },
    }),
  );
  const errors = apiFieldErrors(save.error);
  const aboutLength = description.trim().length;
  const disabled = !canEdit || save.isPending;

  return (
    <>
      <Text variant="display">Profile</Text>
      <Text tone="muted">What customers see at the top of your page.</Text>
      <TextField
        label="Business name"
        value={name}
        onChangeText={setName}
        maxLength={BUSINESS_NAME_MAX_LENGTH}
        autoComplete="organization"
        editable={!disabled}
        error={errors.name}
      />
      <TextField
        label="About your business"
        hint={`${aboutLength} / ${LISTING_ABOUT_MAX_LENGTH} characters${
          aboutLength < LISTING_ABOUT_MIN_LENGTH
            ? ` · at least ${LISTING_ABOUT_MIN_LENGTH} to publish`
            : ""
        }. Say what you do, where, and what makes you good at it.`}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={LISTING_ABOUT_MAX_LENGTH}
        inputStyle={styles.multiline}
        editable={!disabled}
        error={errors.description}
      />
      <TextField
        label="GST/HST number (optional)"
        hint="Only if you're registered: HST is then added to your price at checkout. Leave it empty if you're not registered."
        placeholder="123456789 RT 0001"
        value={gstHstNumber}
        onChangeText={setGstHstNumber}
        maxLength={20}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!disabled}
        error={errors.gstHstNumber}
      />
      <View style={styles.group} accessibilityRole="radiogroup">
        <Text variant="bodyStrong">Cancellation policy</Text>
        {CANCELLATION_POLICY_IDS.map((id) => (
          <RadioCard
            key={id}
            label={CANCELLATION_POLICIES[id].label}
            description={CANCELLATION_POLICIES[id].description}
            checked={policy === id}
            disabled={disabled}
            onPress={() => setPolicy(id)}
          />
        ))}
      </View>
      <Checkbox
        checked={instantBook}
        onChange={setInstantBook}
        disabled={disabled}
        label="Instant Book"
        description="Customers can book your fixed-price services straight away, without waiting for you to accept. You can switch it off for single services."
      />
      <Checkbox
        checked={takesQuotes}
        onChange={setTakesQuotes}
        disabled={disabled}
        label="Take quote requests"
        description="Customers can describe a job and ask you for a price, from your page and from search. You reply within 3 days with a quote, or decline."
      />
      {save.error && Object.keys(errors).length === 0 ? (
        <FormAlert tone="error" message={apiErrorMessage(save.error)} />
      ) : null}
      {canEdit ? (
        <Button
          label="Save profile"
          fullWidth
          loading={save.isPending}
          onPress={() =>
            save.mutate({
              businessId,
              name,
              description,
              gstHstNumber,
              cancellationPolicy: policy,
              instantBook,
              acceptsQuoteRequests: takesQuotes,
            })
          }
        />
      ) : null}
    </>
  );
}

function Profile({ membership }: { membership: Membership }) {
  const trpc = useTRPC();
  const businessId = membership.business.id;
  const listing = useQuery(trpc.listing.get.queryOptions({ businessId }));
  if (listing.isPending)
    return <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />;
  if (listing.isError) return <FormAlert tone="error" message={apiErrorMessage(listing.error)} />;
  return <ProfileForm businessId={businessId} listing={listing.data} />;
}

/** Name, about, tax registration, cancellation policy, Instant Book, quotes (SPEC §18). */
export default function BusinessProfileRoute() {
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return (
    <BusinessScreen businessId={businessId} avoidKeyboard>
      {(membership) => <Profile key={membership.business.id} membership={membership} />}
    </BusinessScreen>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  multiline: { minHeight: 140, textAlignVertical: "top", paddingTop: 12 },
});
