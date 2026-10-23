import { bookingsRouter } from "./routers/bookings.ts";
import { businessRouter } from "./routers/business.ts";
import { businessBookingsRouter } from "./routers/business-bookings.ts";
import { categoriesRouter } from "./routers/categories.ts";
import { communityRouter } from "./routers/community.ts";
import { healthRouter } from "./routers/health.ts";
import { listingRouter } from "./routers/listing.ts";
import { meRouter } from "./routers/me.ts";
import { onboardingRouter } from "./routers/onboarding.ts";
import { payoutsRouter } from "./routers/payouts.ts";
import { profileRouter } from "./routers/profile.ts";
import { searchRouter } from "./routers/search.ts";
import { teamRouter } from "./routers/team.ts";
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
  bookings: bookingsRouter,
  businessBookings: businessBookingsRouter,
  team: teamRouter,
  payouts: payoutsRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller (server components, tests): `createCaller(await createContext(...))`. */
export const createCaller = createCallerFactory(appRouter);
