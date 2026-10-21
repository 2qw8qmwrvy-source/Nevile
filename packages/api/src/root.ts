import { businessRouter } from "./routers/business.ts";
import { categoriesRouter } from "./routers/categories.ts";
import { healthRouter } from "./routers/health.ts";
import { meRouter } from "./routers/me.ts";
import { createCallerFactory, router } from "./trpc.ts";

export const appRouter = router({
  health: healthRouter,
  me: meRouter,
  categories: categoriesRouter,
  business: businessRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller (server components, tests): `createCaller(await createContext(...))`. */
export const createCaller = createCallerFactory(appRouter);
