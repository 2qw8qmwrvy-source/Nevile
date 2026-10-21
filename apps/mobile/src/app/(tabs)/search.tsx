import { type CategorySlug, DEFAULT_CATEGORIES } from "@nevile/core";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Chip } from "@/components/chip.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { Icon, icons } from "@/components/icon.tsx";
import { Screen } from "@/components/screen.tsx";
import { SearchField } from "@/components/search-field.tsx";
import { Text } from "@/components/text.tsx";
import { CATEGORY_ICONS, categoryBySlug, matchCategories } from "@/lib/categories.ts";
import { colors, space } from "@/theme";

export default function SearchScreen() {
  const params = useLocalSearchParams<{ category?: string }>();
  // The category param (from Home) is the source of truth so deep links stay in sync.
  const selected = categoryBySlug(params.category);
  const [query, setQuery] = useState("");

  const selectCategory = (slug: CategorySlug | undefined) => {
    router.setParams({ category: slug });
  };

  const trimmed = query.trim();
  const suggestions = trimmed && !selected ? matchCategories(trimmed) : [];

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
            onPress={() => selectCategory(selected?.slug === category.slug ? undefined : category.slug)}
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
      ) : selected ? (
        <EmptyState
          icon={CATEGORY_ICONS[selected.slug]}
          title={`No ${selected.name.toLowerCase()} pros yet`}
          message="Businesses near you will show up here as they join Nevile. Try another category in the meantime."
          action={<Button label="Clear filter" variant="secondary" onPress={() => selectCategory(undefined)} />}
        />
      ) : trimmed ? (
        <EmptyState
          icon={icons.search}
          title="No matching services"
          message={`We couldn't find a service for “${trimmed}”. Try a broader word like “lawn” or “snow”.`}
        />
      ) : (
        <EmptyState
          icon={icons.search}
          title="Find help nearby"
          message="Search for a service or pick a category to see local businesses, prices and availability."
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md },
  chipScroll: { marginHorizontal: -20, flexGrow: 0 },
  chips: { gap: 8, paddingHorizontal: 20, paddingVertical: 4 },
  suggestions: { gap: 10 },
  overline: { letterSpacing: 0.8 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 12 },
  suggestionText: { flex: 1, minWidth: 0 },
});
