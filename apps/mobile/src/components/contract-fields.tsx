import {
  addCalendarMonths,
  daysInMonth,
  formatIsoDate,
  parseIsoDate,
  SNOW_CONTRACT_LIMITS,
} from "@nevile/core";
import { StyleSheet, View } from "react-native";

import { RadioCard } from "@/components/radio-card.tsx";
import { Stepper } from "@/components/stepper.tsx";
import { Text } from "@/components/text.tsx";

export type ContractPricing = "season" | "per_visit";
export type SeasonBilling = "upfront" | "monthly" | "either";

/** Snow contract terms being edited (SPEC §21); the price is entered separately. */
export type ContractDraft = {
  triggerCm: number;
  seasonStart: string;
  seasonEnd: string;
  pricing: ContractPricing;
  seasonBilling: SeasonBilling;
};

/** The next winter's default season: November 15 to March 31, cleared from 5 cm. */
export function defaultContractDraft(): ContractDraft {
  const now = new Date();
  const year = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return {
    triggerCm: 5,
    seasonStart: `${year}-11-15`,
    seasonEnd: `${year + 1}-03-31`,
    pricing: "season",
    seasonBilling: "either",
  };
}

const monthYear = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** A calendar date as two steppers: the month (and year), then the day. */
function DateSteppers({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const date = parseIsoDate(value);
  if (!date) return null;
  const lastDay = daysInMonth(date.year, date.month);
  return (
    <View style={styles.group}>
      <Text variant="bodyStrong">{label}</Text>
      <View style={styles.pair}>
        <View style={styles.wide}>
          <Stepper
            label="Month"
            value={monthYear.format(asDate(value))}
            canLess
            canMore
            onLess={() => onChange(formatIsoDate(addCalendarMonths(date, -1)))}
            onMore={() => onChange(formatIsoDate(addCalendarMonths(date, 1)))}
          />
        </View>
        <View style={styles.narrow}>
          <Stepper
            label="Day"
            value={String(date.day)}
            canLess={date.day > 1}
            canMore={date.day < lastDay}
            onLess={() => onChange(formatIsoDate({ ...date, day: date.day - 1 }))}
            onMore={() => onChange(formatIsoDate({ ...date, day: date.day + 1 }))}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * The terms of a snow contract: snowfall that triggers a visit, the season, and whether
 * it's priced per visit or for the season (and how a season price is paid).
 */
export function ContractFields({
  value,
  onChange,
}: {
  value: ContractDraft;
  onChange: (next: ContractDraft) => void;
}) {
  const set = (patch: Partial<ContractDraft>) => onChange({ ...value, ...patch });
  return (
    <View style={styles.root}>
      <Stepper
        label="Clear from"
        value={`${value.triggerCm} cm of snow`}
        canLess={value.triggerCm > SNOW_CONTRACT_LIMITS.minTriggerCm}
        canMore={value.triggerCm < SNOW_CONTRACT_LIMITS.maxTriggerCm}
        onLess={() => set({ triggerCm: value.triggerCm - 1 })}
        onMore={() => set({ triggerCm: value.triggerCm + 1 })}
      />
      <DateSteppers
        label="Season starts"
        value={value.seasonStart}
        onChange={(seasonStart) => set({ seasonStart })}
      />
      <DateSteppers
        label="Season ends"
        value={value.seasonEnd}
        onChange={(seasonEnd) => set({ seasonEnd })}
      />
      <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="Pricing">
        <Text variant="bodyStrong">Pricing</Text>
        <RadioCard
          label="For the whole season"
          description="Split evenly into its months."
          checked={value.pricing === "season"}
          onPress={() => set({ pricing: "season" })}
        />
        <RadioCard
          label="Per visit"
          description="Charged once each visit is confirmed."
          checked={value.pricing === "per_visit"}
          onPress={() => set({ pricing: "per_visit" })}
        />
      </View>
      {value.pricing === "season" ? (
        <View
          style={styles.group}
          accessibilityRole="radiogroup"
          accessibilityLabel="The customer pays"
        >
          <Text variant="bodyStrong">The customer pays</Text>
          <RadioCard
            label="Upfront or monthly"
            description="They choose when they sign up."
            checked={value.seasonBilling === "either"}
            onPress={() => set({ seasonBilling: "either" })}
          />
          <RadioCard
            label="Upfront"
            checked={value.seasonBilling === "upfront"}
            onPress={() => set({ seasonBilling: "upfront" })}
          />
          <RadioCard
            label="Monthly"
            checked={value.seasonBilling === "monthly"}
            onPress={() => set({ seasonBilling: "monthly" })}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  group: { gap: 8 },
  pair: { flexDirection: "row", gap: 8 },
  wide: { flex: 3 },
  narrow: { flex: 2.2 },
});
