import { asc, eq, serviceCategories } from "@nevile/db";
import { publicProcedure, router } from "../trpc.ts";

export const categoriesRouter = router({
  /** Active service categories (SPEC §3), alphabetical. */
  list: publicProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: serviceCategories.id,
        slug: serviceCategories.slug,
        name: serviceCategories.name,
        description: serviceCategories.description,
      })
      .from(serviceCategories)
      .where(eq(serviceCategories.active, true))
      .orderBy(asc(serviceCategories.name)),
  ),
});
