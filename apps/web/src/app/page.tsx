import {
  DEFAULT_CATEGORIES,
  SEASONAL_CATEGORY_SLUGS,
  seasonFor,
  seasonNudgeFor,
} from "@nevile/core";
import { BusinessBand } from "@/components/home/business-band.tsx";
import { HowItWorks } from "@/components/home/how-it-works.tsx";
import { SearchCard } from "@/components/home/search-card.tsx";
import { SeasonalHero } from "@/components/home/seasonal-hero.tsx";
import { SeasonalTiles, type Tile } from "@/components/home/seasonal-tiles.tsx";
import { Container } from "@/components/ui/container.tsx";

export default function HomePage() {
  // SPEC §13: the current month in Nova Scotia picks the season; there is no switcher.
  const now = new Date();
  const season = seasonFor(now);
  const nudge = seasonNudgeFor(now);

  const bySlug = new Map(DEFAULT_CATEGORIES.map((category) => [category.slug, category]));
  const tiles: Tile[] = SEASONAL_CATEGORY_SLUGS[season].flatMap((slug) => {
    const category = bySlug.get(slug);
    return category
      ? [{ slug: category.slug, name: category.name, description: category.description }]
      : [];
  });
  const categories = DEFAULT_CATEGORIES.map(({ slug, name }) => ({ slug, name }));
  const defaultService = tiles[0]?.slug ?? categories[0]?.slug ?? "";

  return (
    <>
      <Container as="section" aria-labelledby="hero-title" className="pt-1">
        <div className="rounded-panel bg-season-tint px-4.5 pt-6 pb-6.5 sm:rounded-hero sm:px-11 sm:pt-8 sm:pb-9">
          <SeasonalHero season={season} nudge={nudge} />
          <SearchCard categories={categories} defaultService={defaultService} />
          <SeasonalTiles season={season} tiles={tiles} totalServices={DEFAULT_CATEGORIES.length} />
        </div>
      </Container>
      <Container>
        <HowItWorks />
        <BusinessBand season={season} />
      </Container>
    </>
  );
}
