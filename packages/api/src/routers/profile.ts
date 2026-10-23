import { MARKETING_CONSENT_AUDIT_ACTIONS } from "@nevile/auth";
import { MARKETING_CONSENT_VERSION } from "@nevile/core";
import { auditLog, eq, profiles } from "@nevile/db";
import { z } from "zod";
import { ensureProfile, marketingConsentState } from "../profile-state.ts";
import { protectedProcedure, router } from "../trpc.ts";

export const setMarketingConsentInput = z.object({ consent: z.boolean() });

export const profileRouter = router({
  /**
   * Records or withdraws CASL marketing consent (SPEC §17) with the current wording
   * version and a timestamp; every change also goes to the audit log, because the
   * profile only keeps the current state. Repeating the current state changes nothing.
   */
  setMarketingConsent: protectedProcedure
    .input(setMarketingConsentInput)
    .mutation(async ({ ctx, input }) => {
      const { user } = ctx;
      return ctx.db.transaction(async (tx) => {
        await ensureProfile(tx, user);
        const [current] = await tx
          .select({
            marketingConsentAt: profiles.marketingConsentAt,
            marketingConsentVersion: profiles.marketingConsentVersion,
          })
          .from(profiles)
          .where(eq(profiles.userId, user.id))
          .for("update");
        const state = marketingConsentState(current);
        const unchanged = input.consent
          ? state.consented && state.version === MARKETING_CONSENT_VERSION
          : !state.consented;
        if (unchanged) return state;

        const now = new Date();
        const [updated] = await tx
          .update(profiles)
          .set(
            input.consent
              ? { marketingConsentAt: now, marketingConsentVersion: MARKETING_CONSENT_VERSION }
              : { marketingConsentAt: null, marketingConsentVersion: null },
          )
          .where(eq(profiles.userId, user.id))
          .returning({
            marketingConsentAt: profiles.marketingConsentAt,
            marketingConsentVersion: profiles.marketingConsentVersion,
          });
        await tx.insert(auditLog).values({
          actorUserId: user.id,
          action: input.consent
            ? MARKETING_CONSENT_AUDIT_ACTIONS.granted
            : MARKETING_CONSENT_AUDIT_ACTIONS.withdrawn,
          entity: "user",
          entityId: user.id,
          data: input.consent
            ? { version: MARKETING_CONSENT_VERSION, source: "settings" }
            : { previousVersion: state.version, source: "settings" },
          createdAt: now,
        });
        return marketingConsentState(updated);
      });
    }),
});
