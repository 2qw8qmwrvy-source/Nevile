import { formatDurationMinutes } from "@nevile/core";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { Badge } from "@/components/badge.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { icons } from "@/components/icon.tsx";
import { ProAvatar } from "@/components/pro-avatar.tsx";
import { ProBadges, Rating } from "@/components/pro-meta.tsx";
import { Screen } from "@/components/screen.tsx";
import { Text } from "@/components/text.tsx";
import { IconButton, TopBar, topBarIcons } from "@/components/top-bar.tsx";
import { FormAlert } from "@/lib/auth-ui.tsx";
import { mediaUrl } from "@/lib/media.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { colors, radius, space } from "@/theme";
import { enterUp } from "@/theme/motion.ts";

const monthYear = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric" });
const reviewDate = new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric" });

/** A business's public page (SPEC §18). Contact details stay hidden until booking (§7). */
export default function ProRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const trpc = useTRPC();
  const profile = useQuery({
    ...trpc.search.profile.queryOptions({ slug: slug ?? "" }),
    enabled: Boolean(slug),
  });
  const back = () => (router.canGoBack() ? router.back() : router.replace("/search"));
  const canBook = Boolean(profile.data?.bookingOpen && !profile.data.preview);
  const firstBookable = profile.data?.services.find((service) => service.bookable);
  const openBooking = (serviceId: string) =>
    router.push({ pathname: "/book", params: { serviceId } });
  const canAskForQuote = Boolean(
    profile.data?.takesQuotes && !profile.data.preview && profile.data.categories.length > 0,
  );
  const askForQuote = () => {
    const categories = profile.data?.categories ?? [];
    router.push({
      pathname: "/quotes/new",
      params: {
        pros: profile.data?.id ?? "",
        ...(categories.length === 1
          ? { category: categories[0]?.slug ?? "" }
          : { choices: categories.map((category) => category.slug).join(",") }),
      },
    });
  };

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      header={
        <TopBar leading={<IconButton icon={topBarIcons.back} label="Back" onPress={back} />} />
      }
    >
      {profile.isPending ? (
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading"
          style={styles.spinner}
        />
      ) : profile.isError ? (
        profile.error.data?.code === "NOT_FOUND" ? (
          <EmptyState
            icon={icons.search}
            title="We couldn't find that pro"
            message="They may have paused their listing. Search for others nearby."
            action={<Button label="Back to search" variant="secondary" onPress={back} />}
          />
        ) : (
          <View style={styles.section}>
            <FormAlert tone="error" message="We couldn't load this page right now." />
            <Button label="Try again" variant="secondary" onPress={() => profile.refetch()} />
          </View>
        )
      ) : (
        <Animated.View entering={enterUp} style={styles.page}>
          {profile.data.preview ? (
            <FormAlert
              tone="info"
              message="Preview: only your team can see this page until you publish your listing."
            />
          ) : null}
          <View style={styles.hero}>
            <ProAvatar
              name={profile.data.name}
              logoUrl={profile.data.logoUrl}
              size={72}
              tone="surface"
            />
            <Text variant="display">{profile.data.name}</Text>
            <Rating rating={profile.data.rating} />
            <ProBadges badges={profile.data.badges} />
            <Text variant="small" tone="muted">
              {profile.data.area ? `${profile.data.area.description} · ` : ""}On Nevile since{" "}
              {monthYear.format(profile.data.memberSince)}
            </Text>
          </View>

          <Card style={styles.section}>
            <Text variant="heading">Book {profile.data.name}</Text>
            {firstBookable && canBook ? (
              <>
                <Text tone="muted">
                  Pick a day and an arrival window, then pay securely in the app. The pro&apos;s
                  contact details are shared once your booking is paid.
                </Text>
                <Button
                  label="Book a time"
                  icon={icons.bookings}
                  fullWidth
                  onPress={() => openBooking(firstBookable.id)}
                />
              </>
            ) : (
              <Text tone="muted">
                {firstBookable
                  ? `${profile.data.name} isn't taking new bookings right now. Please check back soon.`
                  : canAskForQuote
                    ? `${profile.data.name} prices jobs by quote. Describe the job and they'll send one price.`
                    : `${profile.data.name} isn't taking quote requests right now.`}
              </Text>
            )}
            {canAskForQuote ? (
              <Button
                label="Ask for a quote"
                icon={icons.chat}
                variant={firstBookable && canBook ? "secondary" : "primary"}
                fullWidth
                onPress={askForQuote}
              />
            ) : null}
            {profile.data.responseTime ? (
              <Text variant="small" tone="muted">
                {profile.data.responseTime}
              </Text>
            ) : null}
          </Card>

          <Card style={styles.section}>
            <Text variant="heading">About</Text>
            <Text>{profile.data.about}</Text>
          </Card>

          {profile.data.photos.length > 0 ? (
            <View style={styles.section}>
              <Text variant="title">Recent work</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.photoScroll}
                contentContainerStyle={styles.photos}
              >
                {profile.data.photos.map((photo) => (
                  <Image
                    key={photo.id}
                    source={{ uri: mediaUrl(photo.url) }}
                    style={styles.photo}
                    contentFit="cover"
                    accessible
                    accessibilityLabel={photo.altText || `Work by ${profile.data.name}`}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text variant="title">Services</Text>
            {profile.data.services.map((service) => (
              <Card key={service.id} style={styles.service}>
                <View style={styles.serviceTop}>
                  <View style={styles.shrink}>
                    <Text variant="bodyStrong">{service.title}</Text>
                    <Text variant="small" tone="muted">
                      {service.categoryName} · about{" "}
                      {formatDurationMinutes(service.durationMinutes)}
                    </Text>
                  </View>
                  <Text variant="bodyStrong">{service.priceText}</Text>
                </View>
                {service.description ? <Text>{service.description}</Text> : null}
                {service.instantBook ? <Badge label="Instant Book" size="sm" /> : null}
                {canBook && service.bookable ? (
                  <Button
                    label="Book"
                    size="sm"
                    variant="secondary"
                    accessibilityLabel={`Book ${service.title}`}
                    onPress={() => openBooking(service.id)}
                  />
                ) : null}
              </Card>
            ))}
          </View>

          <Card style={styles.section}>
            <Text variant="heading">{profile.data.cancellationPolicy.label} cancellation</Text>
            <Text tone="muted">{profile.data.cancellationPolicy.description}</Text>
          </Card>

          <View style={styles.section}>
            <Text variant="title">Reviews</Text>
            {profile.data.reviews.length === 0 ? (
              <Text tone="muted">
                No reviews yet. Reviews appear here after customers' jobs are done.
              </Text>
            ) : (
              profile.data.reviews.map((review) => (
                <Card key={review.id} style={styles.service}>
                  <Text
                    variant="bodyStrong"
                    accessibilityLabel={`${review.stars} out of 5 stars, from ${review.author}, ${reviewDate.format(review.createdAt)}`}
                  >
                    {"★".repeat(review.stars)}
                    {"☆".repeat(5 - review.stars)} · {review.author} ·{" "}
                    {reviewDate.format(review.createdAt)}
                  </Text>
                  {review.comment ? <Text>{review.comment}</Text> : null}
                  {review.reply ? (
                    <View style={styles.reply}>
                      <Text variant="small">
                        <Text variant="small" style={styles.replyLabel}>
                          Reply from {profile.data.name}:{" "}
                        </Text>
                        {review.reply}
                      </Text>
                    </View>
                  ) : null}
                </Card>
              ))
            )}
          </View>
        </Animated.View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginVertical: space.xl },
  page: { gap: space.lg },
  hero: {
    gap: 8,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: "#E6F0EA",
  },
  section: { gap: 10 },
  photoScroll: { marginHorizontal: -20, flexGrow: 0 },
  photos: { gap: 10, paddingHorizontal: 20 },
  photo: { width: 240, height: 180, borderRadius: radius.card, backgroundColor: colors.border },
  service: { gap: 8 },
  serviceTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  shrink: { flex: 1, minWidth: 0 },
  reply: { backgroundColor: colors.ground, borderRadius: radius.input, padding: 12 },
  replyLabel: { fontFamily: "Figtree_600SemiBold" },
});
