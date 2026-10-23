import type { SearchLocation } from "@nevile/api";
import {
  type CategorySlug,
  DEFAULT_CATEGORIES,
  postalAreaOf,
  SEARCH_SORT_LABELS,
  SEARCH_SORTS,
  type SearchSort,
} from "@nevile/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Chip } from "@/components/chip.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { Icon, icons } from "@/components/icon.tsx";
import { ProCard } from "@/components/pro-card.tsx";
import { Screen } from "@/components/screen.tsx";
import { SearchField } from "@/components/search-field.tsx";
import { Text } from "@/components/text.tsx";
import { FormAlert, TextField } from "@/lib/auth-ui.tsx";
import { CATEGORY_ICONS, categoryBySlug, matchCategories } from "@/lib/categories.ts";
import { useMe } from "@/lib/me.ts";
import { useTRPC } from "@/lib/trpc.tsx";
import { colors, space } from "@/theme";

const FILTERS = [
  { key: "instantBook", label: "Instant Book" },
  { key: "verified", label: "Verified" },
  { key: "pro", label: "Pro" },
  { key: "topRated", label: "4.5+ stars" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];
const NO_FILTERS: Record<FilterKey, boolean> = {
  instantBook: false,
  verified: false,
  pro: false,
  topRated: false,
};

function useSearch(input: {
  category?: CategorySlug;
  postalCode?: string;
  sort: SearchSort;
  filters: Record<FilterKey, boolean>;
  page: number;
}) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.search.query.queryOptions({
      category: input.category,
      postalCode: input.postalCode,
      sort: input.sort,
      ...input.filters,
      page: input.page,
    }),
    placeholderData: keepPreviousData,
  });
}

/** One line saying where results are for, including fallbacks (SPEC §18). */
function locationLine(location: SearchLocation): string {
  switch (location.kind) {
    case "postal":
      return location.requested === location.code
        ? `Near ${location.code} · ${location.placeName}`
        : `We don't have ${location.requested} yet, so we're using nearby ${location.code} · ${location.placeName}.`;
    case "near":
      return "Near your location";
    case "outside":
      return location.message;
    case "province":
      return location.reason === "unknown_area"
        ? `We don't know ${location.requested} yet, so here are pros across Nova Scotia.`
        : "Across Nova Scotia. Add your postal code to see who serves your street.";
  }
}

export default function SearchScreen() {
  const params = useLocalSearchParams<{ category?: string; postal?: string }>();
  // The category param (from Home) is the source of truth so deep links stay in sync.
  const selected = categoryBySlug(params.category);
  const { me } = useMe();
  const savedPostal = me.data?.onboarding.postalCode ?? undefined;
  const [query, setQuery] = useState("");
  const [postalDraft, setPostalDraft] = useState(params.postal ?? savedPostal ?? "");
  const [postalError, setPostalError] = useState<string | undefined>();
  const [sort, setSort] = useState<SearchSort>("best");
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const postalCode = params.postal ?? savedPostal;

  // The saved postal code may arrive after the first render.
  useEffect(() => {
    if (!params.postal && savedPostal) setPostalDraft((draft) => draft || savedPostal);
  }, [params.postal, savedPostal]);

  const trimmed = query.trim();
  const suggestions = trimmed && !selected ? matchCategories(trimmed) : [];
  const search = useSearch({ category: selected?.slug, postalCode, sort, filters, page });

  const selectCategory = (slug: CategorySlug | undefined) => {
    setPage(1);
    router.setParams({ category: slug });
  };

  function applyPostal() {
    const value = postalDraft.trim();
    if (value && !postalAreaOf(value)) {
      setPostalError("Enter a postal code like B3H 1A1.");
      return;
    }
    setPostalError(undefined);
    setPage(1);
    router.setParams({ postal: value.toUpperCase() || undefined });
  }

  const data = search.data;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <Screen
      title="Search"
      subtitle="Local pros whose service area covers your address."
      contentStyle={styles.content}
    >
      <SearchField
        label="Search services"
        placeholder="Try “gutter cleaning”"
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery("")}
      />
      <View style={styles.postalRow}>
        <View style={styles.postalField}>
          <TextField
            label="Postal code"
            placeholder="B3H 1A1"
            value={postalDraft}
            onChangeText={(value) => {
              setPostalDraft(value);
              setPostalError(undefined);
            }}
            error={postalError}
            maxLength={7}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="postal-code"
            textContentType="postalCode"
            returnKeyType="search"
            onSubmitEditing={applyPostal}
          />
        </View>
        <View style={styles.postalButton}>
          <Button label="Go" variant="secondary" onPress={applyPostal} />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chips}
        accessibilityLabel="Filter by category"
      >
        <Chip label="All" selected={!selected} onPress={() => selectCategory(undefined)} />
        {DEFAULT_CATEGORIES.map((category) => (
          <Chip
            key={category.slug}
            label={category.name}
            icon={CATEGORY_ICONS[category.slug]}
            selected={selected?.slug === category.slug}
            onPress={() =>
              selectCategory(selected?.slug === category.slug ? undefined : category.slug)
            }
          />
        ))}
      </ScrollView>

      {suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          <Text variant="caption" tone="muted" style={styles.overline}>
            MATCHING SERVICES
          </Text>
          {suggestions.map((category) => (
            <Card
              key={category.slug}
              onPress={() => {
                setQuery("");
                selectCategory(category.slug);
              }}
              accessibilityLabel={category.name}
              accessibilityHint="Filters results to this category"
              style={styles.suggestion}
            >
              <Icon name={CATEGORY_ICONS[category.slug]} size={20} color={colors.primary} />
              <View style={styles.suggestionText}>
                <Text variant="bodyStrong">{category.name}</Text>
                <Text variant="small" tone="muted" numberOfLines={2}>
                  {category.description}
                </Text>
              </View>
              <Icon name={icons.chevronRight} size={16} color={colors.muted} />
            </Card>
          ))}
        </View>
      ) : trimmed && !selected ? (
        <EmptyState
          icon={icons.search}
          title="No matching services"
          message={`We couldn't find a service for “${trimmed}”. Try a broader word like “lawn” or “snow”.`}
        />
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chips}
            accessibilityLabel="Sort and filter"
          >
            {SEARCH_SORTS.map((option) => (
              <Chip
                key={option}
                label={SEARCH_SORT_LABELS[option]}
                selected={sort === option}
                accessibilityLabel={`Sort by ${SEARCH_SORT_LABELS[option]}`}
                onPress={() => {
                  setPage(1);
                  setSort(option);
                }}
              />
            ))}
            <View style={styles.divider} />
            {FILTERS.map((filter) => (
              <Chip
                key={filter.key}
                label={filter.label}
                selected={filters[filter.key]}
                onPress={() => {
                  setPage(1);
                  setFilters((current) => ({ ...current, [filter.key]: !current[filter.key] }));
                }}
              />
            ))}
          </ScrollView>

          {search.isPending ? (
            <ActivityIndicator
              color={colors.primary}
              accessibilityLabel="Finding pros"
              style={styles.spinner}
            />
          ) : search.isError ? (
            search.error.data?.code === "BAD_REQUEST" ? (
              <FormAlert tone="error" message={search.error.message} />
            ) : (
              <>
                <FormAlert tone="error" message="We couldn't load pros right now." />
                <Button label="Try again" variant="secondary" onPress={() => search.refetch()} />
              </>
            )
          ) : data ? (
            <View style={[styles.results, search.isFetching && styles.fetching]}>
              <Text variant="small" tone="muted" accessibilityLiveRegion="polite">
                {data.location.kind === "outside"
                  ? data.location.message
                  : `${data.total} ${data.total === 1 ? "pro" : "pros"} · ${locationLine(data.location)}`}
              </Text>
              {data.results.length === 0 && data.location.kind !== "outside" ? (
                <EmptyState
                  icon={selected ? CATEGORY_ICONS[selected.slug] : icons.search}
                  title="No pros here yet"
                  message={
                    filtered
                      ? "Nobody matches all of those filters. Try turning some off."
                      : "Pros are joining across Nova Scotia every week. Try another service, or check back soon."
                  }
                  action={
                    filtered ? (
                      <Button
                        label="Clear filters"
                        variant="secondary"
                        onPress={() => setFilters(NO_FILTERS)}
                      />
                    ) : selected ? (
                      <Button
                        label="Show every service"
                        variant="secondary"
                        onPress={() => selectCategory(undefined)}
                      />
                    ) : undefined
                  }
                />
              ) : (
                data.results.map((result) => (
                  <ProCard
                    key={result.id}
                    result={result}
                    onPress={() =>
                      router.push({ pathname: "/pros/[slug]", params: { slug: result.slug } })
                    }
                  />
                ))
              )}
              {data.page > 1 || data.hasMore ? (
                <View style={styles.pager}>
                  <Button
                    label="Previous"
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1}
                    onPress={() => setPage((current) => Math.max(1, current - 1))}
                  />
                  <Button
                    label="Next"
                    variant="secondary"
                    size="sm"
                    disabled={!data.hasMore}
                    onPress={() => setPage((current) => current + 1)}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md },
  postalRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  postalField: { flex: 1 },
  postalButton: { marginTop: 29 },
  chipScroll: { marginHorizontal: -20, flexGrow: 0 },
  chips: { gap: 8, paddingHorizontal: 20, paddingVertical: 4, alignItems: "center" },
  divider: { width: 1, height: 24, backgroundColor: colors.border, marginHorizontal: 4 },
  suggestions: { gap: 10 },
  overline: { letterSpacing: 0.8 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 12 },
  suggestionText: { flex: 1, minWidth: 0 },
  spinner: { marginVertical: space.lg },
  results: { gap: 12 },
  fetching: { opacity: 0.6 },
  pager: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
});
