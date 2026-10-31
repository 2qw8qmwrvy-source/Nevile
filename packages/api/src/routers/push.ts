import { z } from "zod";
import { EXPO_PUSH_TOKEN, registerPushToken, unregisterPushToken } from "../push.ts";
import { protectedProcedure, router } from "../trpc.ts";

const tokenSchema = z.string().max(200).regex(EXPO_PUSH_TOKEN, { message: "Not a push token" });

/** The app's push registrations (SPEC §20). A token belongs to whoever signed in last. */
export const pushRouter = router({
  register: protectedProcedure
    .input(z.object({ token: tokenSchema, platform: z.enum(["ios", "android"]) }))
    .mutation(async ({ ctx, input }) => {
      await registerPushToken(ctx.db, ctx.user.id, input.token, input.platform, ctx.now());
      return { ok: true as const };
    }),

  /** On sign-out, so the device stops getting this person's notifications. */
  unregister: protectedProcedure
    .input(z.object({ token: tokenSchema }))
    .mutation(async ({ ctx, input }) => {
      await unregisterPushToken(ctx.db, ctx.user.id, input.token);
      return { ok: true as const };
    }),
});
