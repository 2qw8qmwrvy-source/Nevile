import { handlePaymentEvent } from "@nevile/api";
import { fakePayments, serverBookingDeps } from "@/lib/booking-deps.ts";
import { crossSiteRefused, isForeignOrigin } from "@/lib/same-origin.ts";

/** The test card page's "Save" buttons (development and tests only). */
export async function POST(req: Request): Promise<Response> {
  const fake = fakePayments();
  if (!fake) return new Response("Not found", { status: 404 });
  if (isForeignOrigin(req)) return crossSiteRefused();
  const form = await req.formData();
  const setupId = String(form.get("setupId") ?? "");
  try {
    const { event, redirectUrl } = fake.completeCardSetup(setupId, {
      declining: form.get("declining") === "true",
    });
    await handlePaymentEvent(serverBookingDeps(), event);
    return Response.redirect(redirectUrl ?? new URL("/account/card", req.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Saving the card failed.";
    return Response.json({ error: { message } }, { status: 409 });
  }
}
