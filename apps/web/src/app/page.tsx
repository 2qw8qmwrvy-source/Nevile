import { DEFAULT_CATEGORIES, SEASONAL_CATEGORY_SLUGS, seasonFor } from "@nevile/core";
import { SEASONS, type Season } from "@nevile/tokens";
import { BusinessBand } from "@/components/home/business-band.tsx";
import { HowItWorks } from "@/components/home/how-it-works.tsx";
import { SearchCard } from "@/components/home/search-card.tsx";
import { SeasonScope } from "@/components/home/season-scope.tsx";
import { SeasonalHero } from "@/components/home/seasonal-hero.tsx";
import { SeasonalTiles, type Tile } from "@/components/home/seasonal-tiles.tsx";
import { Container } from "@/components/ui/container.tsx";

// Re-render at most hourly so the default season flips soon after the month changes.
export const revalidate = 3600;

const HOME_TIME_ZONE = "America/Toronto";

function tilesBySeason(): Record<Season, Tile[]> {
  const bySlug = new Map(DEFAULT_CATEGORIES.map((category) => [category.slug, category]));
  const result = {} as Record<Season, Tile[]>;
  for (const season of SEASONS) {
    result[season] = SEASONAL_CATEGORY_SLUGS[season].flatMap((slug) => {
      const category = bySlug.get(slug);
      return category
        ? [{ slug: category.slug, name: category.name, description: category.description }]
        : [];
    });
  }
  return result;
}

export default function HomePage() {
  const season = seasonFor(new Date(), HOME_TIME_ZONE);
  const categories = DEFAULT_CATEGORIES.map(({ slug, name }) => ({ slug, name }));
  const fallbackService = categories[0]?.slug ?? "";

  return (
    <SeasonScope
      initialSeason={season}
      featured={SEASONAL_CATEGORY_SLUGS}
      fallbackService={fallbackService}
    >
      <Container as="section" aria-labelledby="hero-title" className="pt-1">
        <div className="rounded-panel bg-season-tint px-4.5 pt-6 pb-6.5 transition-colors duration-300 sm:rounded-hero sm:px-11 sm:pt-8 sm:pb-9">
          <SeasonalHero />
          <SearchCard categories={categories} />
          <SeasonalTiles tiles={tilesBySeason()} totalServices={DEFAULT_CATEGORIES.length} />
        </div>
      </Container>
      <Container>
        <HowItWorks />
        <BusinessBand />
      </Container>
    </SeasonScope>
  );
}
