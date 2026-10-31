import {
  type CategorySlug,
  isCategorySlug,
  isLaunchPostalCode,
  QUOTE_REQUEST_LIMITS,
  QUOTE_TIMINGS,
  type QuoteTiming,
} from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Chip } from "@/components/chip.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { icons } from "@/components/icon.tsx";
import { PressableScale } from "@/components/pressable-scale.tsx";
import { PhotoPicker, photoState } from "@/components/private-photos.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { VerificationBanner } from "@/components/verification-banner.tsx";
import { FormAlert, TextField } from "@/lib/auth-ui.tsx";
import { categoryBySlug } from "@/lib/categories.ts";
import { useMe } from "@/lib/me.ts";
import type { PickedPhoto } from "@/lib/photos.ts";
import { askForPush } from "@/lib/push.ts";
import { useTRPC, useTRPCClient } from "@/lib/trpc.tsx";
import { apiErrorMessage, apiFieldErrors } from "@/lib/trpc-client.ts";
import { useEmailVerification } from "@/lib/verification.ts";
import { colors, radius, space } from "@/theme";

const list = (value: string | undefined) => (value ? value.split(",").filter(Boolean) : []);

/**
 * Ask up to 3 pros for a quote (SPEC §20): what the job is, when, the job's postal code and
 * optional photos. Pros see the area, never the address, until a booking is paid.
 */
export default function NewQuoteRoute() {
  const params = useLocalSearchParams<{
    category?: string;
    /** Categories to choose from (a pro that offers several). */
    choices?: string;
    pros?: string;
    postal?: string;
  }>();
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const { user, me } = useMe();
  const verification = useEmailVerification();
  const choices = list(params.choices).filter(isCategorySlug);
  const [categorySlug, setCategorySlug] = useState<CategorySlug | null>(
    isCategorySlug(params.category) ? params.category : (choices[0] ?? null),
  );
  const [pros, setPros] = useState(() => list(params.pros).slice(0, QUOTE_REQUEST_LIMITS.maxPros));
  const [postalDraft, setPostalDraft] = useState<string | null>(params.postal ?? null);
  const [details, setDetails] = useState("");
  const [timing, setTiming] = useState<QuoteTiming | null>(null);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  // The postal code from onboarding, until the customer types their own.
  const postalCode = postalDraft ?? me.data?.onboarding.postalCode ?? "";
  const postalOk = isLaunchPostalCode(postalCode);

  const targets = useQuery({
    ...trpc.quotes.targets.queryOptions({
      categorySlug: categorySlug ?? "lawn-mowing",
      postalCode,
      businessIds: pros,
    }),
    enabled: user !== null && postalOk && pros.length > 0 && categorySlug !== null,
  });
  const send = useMutation(
    trpc.quotes.request.mutationOptions({
      onSuccess: ({ groupId }) => {
        void queryClient.invalidateQueries({ queryKey: trpc.quotes.list.queryKey() });
        router.replace({ pathname: "/quotes/[groupId]", params: { groupId, new: "1" } });
        // Quotes come back over the next few days: offer to let them know.
        void askForPush(client);
      },
    }),
  );
  const fieldErrors = apiFieldErrors(send.error);
  const blocked = targets.data?.pros.some((pro) => pro.problem) ?? false;
  const uploads = photoState(photos);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/search"));

  function submit() {
    setProblem(null);
    if (!categorySlug) return setProblem("Pick the service you need.");
    if (pros.length === 0) return setProblem("Pick at least one pro from search.");
    if (!postalOk) return setProblem("Enter a Nova Scotia postal code like B3H 1A1.");
    if (details.trim().length < QUOTE_REQUEST_LIMITS.detailsMinLength) {
      return setProblem("Describe the job in a sentence or two (at least 20 characters).");
    }
    if (!timing) return setProblem("Pick when you'd like it done.");
    if (blocked) return setProblem("Remove the pros that can't be asked, then send.");
    if (uploads.uploading) return setProblem("Wait for the photos to finish uploading.");
    if (uploads.failed) return setProblem("Remove the photos that didn't upload, then send.");
    send.mutate({
      categorySlug,
      businessIds: pros,
      details,
      postalCode,
      timing,
      photoIds: uploads.ids,
    });
  }

  const header = (
    <TopBar leading={<IconButton icon={topBarIcons.close} label="Close" onPress={back} />} />
  );
  if (!user) {
    return (
      <Screen edges={["top", "bottom", "left", "right"]} header={header}>
        <EmptyState
          icon={icons.chat}
          title="Sign in to ask for quotes"
          message="Pros reply to your Nevile account, and you can chat with them here."
          action={<Button label="Sign in" onPress={() => router.push("/sign-in")} />}
        />
      </Screen>
    );
  }

  const locked = me.data?.verified === false;
  const category = categoryBySlug(categorySlug ?? undefined);
  return (
    <Screen
      title="Ask for a quote"
      subtitle="Each pro replies with one price within 3 days. Compare, chat, then book."
      edges={["top", "bottom", "left", "right"]}
      avoidKeyboard
      header={header}
      footer={
        <View style={styles.footer}>
          {problem || (send.error && Object.keys(fieldErrors).length === 0) ? (
            <FormAlert
              tone="error"
              message={problem ?? apiErrorMessage(send.error, "We couldn't send your request.")}
            />
          ) : null}
          <Button
            label={pros.length > 1 ? `Ask ${pros.length} pros for a quote` : "Ask for a quote"}
            fullWidth
            loading={send.isPending}
            disabled={locked || send.isSuccess}
            onPress={submit}
          />
        </View>
      }
    >
      <View style={styles.page}>
        {locked ? (
          <VerificationBanner
            email={verification.email}
            sending={verification.sending}
            cooldown={verification.cooldown}
            notice={verification.notice}
            onResend={() => void verification.resend()}
          />
        ) : null}

        <Card style={styles.section}>
          <Text variant="heading">Who you&apos;re asking</Text>
          {choices.length > 1 ? (
            <View style={styles.chips}>
              {choices.map((slug) => (
                <Chip
                  key={slug}
                  label={categoryBySlug(slug)?.name ?? slug}
                  selected={slug === categorySlug}
                  onPress={() => setCategorySlug(slug)}
                />
              ))}
            </View>
          ) : category ? (
            <Text variant="bodyStrong">{category.name}</Text>
          ) : null}
          <TextField
            label="Postal code of the job"
            hint="Nova Scotia only. Pros see the area, not your address."
            value={postalCode}
            onChangeText={setPostalDraft}
            autoComplete="postal-code"
            textContentType="postalCode"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            error={fieldErrors.postalCode}
          />
          {pros.length === 0 ? (
            <Text tone="muted">Pick up to 3 pros from search, then ask them together.</Text>
          ) : targets.isError ? (
            <FormAlert tone="error" message={apiErrorMessage(targets.error)} />
          ) : (
            <View style={styles.pros} accessibilityLabel="Pros">
              {(
                targets.data?.pros ??
                pros.map((id) => ({ id, name: "Loading…", slug: "", problem: null }))
              ).map((pro) => (
                <View key={pro.id} style={styles.pro}>
                  <View style={styles.grow}>
                    <Text variant="bodyStrong">{pro.name}</Text>
                    {pro.problem ? (
                      <Text variant="small" tone="danger">
                        {pro.problem}
                      </Text>
                    ) : null}
                  </View>
                  {pros.length > 1 || pro.problem ? (
                    <Button
                      label="Remove"
                      variant="ghost"
                      size="sm"
                      accessibilityLabel={`Remove ${pro.name}`}
                      onPress={() => setPros((current) => current.filter((id) => id !== pro.id))}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card style={styles.section}>
          <Text variant="heading">The job</Text>
          <TextField
            label="Describe the job"
            hint={`What needs doing, roughly how big, anything the pro should know. ${details.trim().length}/${QUOTE_REQUEST_LIMITS.detailsMaxLength}`}
            value={details}
            onChangeText={setDetails}
            multiline
            maxLength={QUOTE_REQUEST_LIMITS.detailsMaxLength}
            inputStyle={styles.multiline}
            error={fieldErrors.details}
          />
          <Text variant="bodyStrong">When would you like it done?</Text>
          <View style={styles.options} accessibilityRole="radiogroup">
            {QUOTE_TIMINGS.map((option) => {
              const checked = timing === option.value;
              return (
                <PressableScale
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked }}
                  onPress={() => setTiming(option.value)}
                  style={[styles.option, checked && styles.selected]}
                >
                  <View style={[styles.radio, checked && styles.radioOn]} />
                  <Text variant="bodyStrong">{option.label}</Text>
                </PressableScale>
              );
            })}
          </View>
          <Text variant="bodyStrong">
            Photos (optional, up to {QUOTE_REQUEST_LIMITS.maxPhotos})
          </Text>
          <PhotoPicker
            purpose="quotes"
            photos={photos}
            setPhotos={setPhotos}
            max={QUOTE_REQUEST_LIMITS.maxPhotos}
          />
          <Text variant="small" tone="muted">
            Only the pros you ask can see them. Location data is removed.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { gap: space.lg },
  section: { gap: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pros: { gap: 8 },
  pro: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: 12,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ground,
  },
  grow: { flex: 1, minWidth: 0 },
  multiline: { minHeight: 120, textAlignVertical: "top", paddingTop: 12 },
  options: { gap: 8 },
  option: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.primary, backgroundColor: colors.tabPill },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  radioOn: { borderColor: colors.primary, borderWidth: 6 },
  footer: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
