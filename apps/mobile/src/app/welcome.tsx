import {
  DEFAULT_CATEGORIES,
  launchPostalCodeSchema,
  type OnboardingInput,
  type OnboardingIntent,
} from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, type TextInputInstance, View } from "react-native";
import Animated from "react-native-reanimated";

import { Button } from "@/components/button.tsx";
import { Chip } from "@/components/chip.tsx";
import { Icon, type IconName } from "@/components/icon.tsx";
import { PressableScale } from "@/components/pressable-scale.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { TopBar } from "@/components/top-bar.tsx";
import { FormAlert, TextField } from "@/lib/auth-ui.tsx";
import { CATEGORY_ICONS } from "@/lib/categories.ts";
import { useMe, useUpdateMe } from "@/lib/me.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { colors, MIN_TOUCH, radius, seasons, space } from "@/theme";
import { enterUp } from "@/theme/motion.ts";

const INTENTS: ReadonlyArray<{
  value: OnboardingIntent;
  title: string;
  body: string;
  icon: IconName;
}> = [
  {
    value: "customer",
    title: "I need help at home",
    body: "Find and book local pros for the yard, the snow and the house.",
    icon: { ios: "house", android: "home" },
  },
  {
    value: "business",
    title: "I run a business",
    body: "List your services and fill your calendar across Nova Scotia.",
    icon: { ios: "storefront", android: "storefront" },
  },
  {
    value: "both",
    title: "Both",
    body: "Book help for your own home and take bookings for your business.",
    icon: { ios: "sparkles", android: "auto_awesome" },
  },
];

const STEP_TITLES = ["What brings you to Nevile?", "Where are you?", "What can we help with?"];
const STEP_COUNT = STEP_TITLES.length;
const checkIcon = { ios: "checkmark.circle.fill", android: "check_circle" } as const;

function postalProblem(value: string): string | undefined {
  if (!value.trim()) return "Enter your postal code.";
  const result = launchPostalCodeSchema.safeParse(value);
  return result.success
    ? undefined
    : (result.error.issues[0]?.message ?? "Enter a valid postal code.");
}

/**
 * Optional three-step welcome after sign-up (SPEC §16), shown again on the next launch
 * until it is finished or skipped. Every step can be skipped.
 */
export default function WelcomeRoute() {
  const trpc = useTRPC();
  const { me } = useMe();
  const updateMe = useUpdateMe();
  const saved = me.data?.onboarding;
  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState<OnboardingIntent | null>(saved?.intent ?? null);
  const [postalCode, setPostalCode] = useState(saved?.postalCode ?? "");
  const [interests, setInterests] = useState<string[]>(saved?.interests ?? []);
  const [problem, setProblem] = useState<string | undefined>();
  const prefilled = useRef(false);
  const postalRef = useRef<TextInputInstance>(null);

  // `me` may arrive after the first render: prefill once, never over the person's edits.
  useEffect(() => {
    if (prefilled.current || !saved) return;
    prefilled.current = true;
    setIntent((current) => current ?? saved.intent);
    setPostalCode((current) => current || saved.postalCode || "");
    setInterests((current) => (current.length > 0 ? current : saved.interests));
  }, [saved]);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      `Step ${step + 1} of ${STEP_COUNT}. ${STEP_TITLES[step]}`,
    );
  }, [step]);

  const onDone = (onboarding: NonNullable<typeof saved>) => {
    updateMe((current) => ({ ...current, onboarding }));
    router.replace(intent === "business" ? "/account" : "/");
  };
  const save = useMutation(trpc.onboarding.save.mutationOptions({ onSuccess: onDone }));
  const skip = useMutation(
    trpc.onboarding.skip.mutationOptions({
      onSuccess: onDone,
      onError: () => router.replace("/"),
    }),
  );
  const busy = save.isPending || skip.isPending;

  function next() {
    if (step === 0 && !intent) {
      setProblem("Choose one to continue.");
      return;
    }
    if (step === 1) {
      const found = postalProblem(postalCode);
      if (found) {
        setProblem(found);
        postalRef.current?.focus();
        return;
      }
    }
    setProblem(undefined);
    setStep((current) => Math.min(current + 1, STEP_COUNT - 1));
  }

  function finish() {
    if (!intent || busy) return;
    save.mutate({
      intent,
      postalCode: launchPostalCodeSchema.parse(postalCode),
      interests: interests as OnboardingInput["interests"],
    });
  }

  function toggleInterest(slug: string) {
    setInterests((current) =>
      current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug],
    );
  }

  const isBusiness = intent === "business";

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      avoidKeyboard
      header={
        <TopBar
          trailing={
            <Button
              variant="ghost"
              size="sm"
              label="Skip for now"
              disabled={busy}
              onPress={() => skip.mutate()}
            />
          }
        />
      }
      footer={
        <View style={styles.footer}>
          {step > 0 ? (
            <View style={styles.footerButton}>
              <Button
                variant="secondary"
                label="Back"
                disabled={busy}
                onPress={() => {
                  setProblem(undefined);
                  setStep((current) => current - 1);
                }}
                fullWidth
              />
            </View>
          ) : null}
          {step < STEP_COUNT - 1 ? (
            <View style={styles.footerButton}>
              <Button label="Continue" onPress={next} fullWidth />
            </View>
          ) : (
            <View style={styles.footerButton}>
              <Button
                label="Finish"
                loading={save.isPending}
                disabled={busy}
                onPress={finish}
                fullWidth
              />
            </View>
          )}
        </View>
      }
    >
      <View
        style={styles.progress}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Welcome progress"
        accessibilityValue={{ min: 1, max: STEP_COUNT, now: step + 1 }}
      >
        {STEP_TITLES.map((title, index) => (
          <View key={title} style={[styles.dot, index <= step && styles.dotActive]} />
        ))}
      </View>

      <Animated.View key={step} entering={enterUp} style={styles.step}>
        <Text variant="small" tone="muted">
          Step {step + 1} of {STEP_COUNT}
        </Text>
        <Text variant="display">{STEP_TITLES[step]}</Text>

        {step === 0 ? (
          <View style={styles.options} accessibilityRole="radiogroup">
            {INTENTS.map((option) => {
              const selected = intent === option.value;
              return (
                <PressableScale
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${option.title}. ${option.body}`}
                  pressedScale={0.98}
                  onPress={() => {
                    setIntent(option.value);
                    setProblem(undefined);
                  }}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <View style={styles.optionIcon}>
                    <Icon name={option.icon} size={22} color={seasons.fall.accent} />
                  </View>
                  <View style={styles.optionText}>
                    <Text variant="bodyStrong">{option.title}</Text>
                    <Text variant="small" tone="muted">
                      {option.body}
                    </Text>
                  </View>
                  {selected ? <Icon name={checkIcon} size={24} color={colors.primary} /> : null}
                </PressableScale>
              );
            })}
          </View>
        ) : null}

        {step === 1 ? (
          <View style={styles.options}>
            <Text tone="muted">
              {isBusiness
                ? "Where is your business based? You'll set your exact service area when you list your services."
                : "We use your postal code to show pros who serve your street."}
            </Text>
            <TextField
              ref={postalRef}
              label="Postal code"
              hint="Nevile is only in Nova Scotia for now (postal codes start with B)."
              placeholder="B3H 1A1"
              value={postalCode}
              onChangeText={(value) => {
                setPostalCode(value);
                setProblem(undefined);
              }}
              error={problem}
              maxLength={7}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="postal-code"
              textContentType="postalCode"
              returnKeyType="next"
              onSubmitEditing={next}
            />
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.options}>
            <Text tone="muted">
              {isBusiness
                ? "Which services do you offer? Pick any; you can change this later."
                : "Pick the services you're likely to need. We'll put them first."}
            </Text>
            <View style={styles.chips}>
              {DEFAULT_CATEGORIES.map((category) => (
                <Chip
                  key={category.slug}
                  label={category.name}
                  icon={CATEGORY_ICONS[category.slug]}
                  selected={interests.includes(category.slug)}
                  onPress={() => toggleInterest(category.slug)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {step === 0 && problem ? <FormAlert tone="error" message={problem} /> : null}
        {save.isError ? (
          <FormAlert
            tone="error"
            message="We couldn't save that. Check your answers and try again."
          />
        ) : null}
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: "row", gap: 8, marginBottom: space.lg },
  dot: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.primary },
  step: { gap: space.md },
  options: { gap: 12 },
  option: {
    minHeight: MIN_TOUCH + 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionSelected: { borderColor: colors.primary, borderWidth: 2 },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: seasons.fall.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: { flex: 1, gap: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  footer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.ground,
  },
  footerButton: { flex: 1 },
});
