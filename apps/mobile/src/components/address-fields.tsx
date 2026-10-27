import { postalAreaOf } from "@nevile/core";
import { useState } from "react";
import { StyleSheet } from "react-native";

import { Card } from "@/components/card.tsx";
import { Text } from "@/components/text.tsx";
import { TextField } from "@/lib/auth-ui.tsx";

export type JobAddress = { line1: string; line2: string; city: string; postalCode: string };

/**
 * The job address being typed. The postal code starts as the one from onboarding until
 * the customer types their own.
 */
export function useJobAddress(defaultPostal: string | null | undefined) {
  const [address, setAddress] = useState<JobAddress>({
    line1: "",
    line2: "",
    city: "",
    postalCode: "",
  });
  const [postalTouched, setPostalTouched] = useState(false);
  const postalCode = postalTouched ? address.postalCode : address.postalCode || defaultPostal || "";
  return {
    address: { ...address, postalCode },
    change(patch: Partial<JobAddress>) {
      if (patch.postalCode !== undefined) setPostalTouched(true);
      setAddress((current) => ({ ...current, ...patch }));
    },
  };
}

/** What's missing from the address, or null when it can be sent. */
export function addressProblem(address: JobAddress): string | null {
  if (!address.line1.trim() || !address.city.trim()) return "Enter the street address and town.";
  if (!postalAreaOf(address.postalCode)) return "Enter a postal code like B3H 1A1.";
  return null;
}

/** "Where": the street address, unit, town, postal code and notes for the pro. */
export function AddressFields({
  hint,
  postalHint = "Nova Scotia only (starts with B).",
  address,
  onChange,
  notes,
  onNotes,
}: {
  hint: string;
  postalHint?: string;
  address: JobAddress;
  onChange: (patch: Partial<JobAddress>) => void;
  notes: string;
  onNotes: (notes: string) => void;
}) {
  return (
    <Card style={styles.section}>
      <Text variant="heading">Where</Text>
      <Text variant="small" tone="muted">
        {hint}
      </Text>
      <TextField
        label="Street address"
        value={address.line1}
        onChangeText={(line1) => onChange({ line1 })}
        autoComplete="address-line1"
        textContentType="streetAddressLine1"
        maxLength={120}
      />
      <TextField
        label="Apartment or unit (optional)"
        value={address.line2}
        onChangeText={(line2) => onChange({ line2 })}
        autoComplete="address-line2"
        textContentType="streetAddressLine2"
        maxLength={120}
      />
      <TextField
        label="Town or city"
        value={address.city}
        onChangeText={(city) => onChange({ city })}
        autoComplete="postal-address-locality"
        textContentType="addressCity"
        maxLength={80}
      />
      <TextField
        label="Postal code"
        hint={postalHint}
        value={address.postalCode}
        onChangeText={(postalCode) => onChange({ postalCode })}
        autoComplete="postal-code"
        textContentType="postalCode"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={7}
      />
      <TextField
        label="Notes for the pro (optional)"
        hint="Gate codes, pets, where to park."
        value={notes}
        onChangeText={onNotes}
        multiline
        maxLength={500}
        inputStyle={styles.multiline}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  multiline: { minHeight: 88, textAlignVertical: "top", paddingTop: 12 },
});
