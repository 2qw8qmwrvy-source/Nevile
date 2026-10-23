import { businessRouter } from "./routers/business.ts";
import { categoriesRouter } from "./routers/categories.ts";
import { communityRouter } from "./routers/community.ts";
import { healthRouter } from "./routers/health.ts";
import { listingRouter } from "./routers/listing.ts";
import { meRouter } from "./routers/me.ts";
import { onboardingRouter } from "./routers/onboarding.ts";
import { profileRouter } from "./routers/profile.ts";
import { searchRouter } from "./routers/search.ts";
import { createCallerFactory, router } from "./trpc.ts";

export const appRouter = router({
  health: healthRouter,
  me: meRouter,
  categories: categoriesRouter,
  business: businessRouter,
  onboarding: onboardingRouter,
  profile: profileRouter,
  community: communityRouter,
  listing: listingRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller (server components, tests): `createCaller(await createContext(...))`. */
export const createCaller = createCallerFactory(appRouter);
