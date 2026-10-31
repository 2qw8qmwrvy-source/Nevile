import { handlePaymentEvent } from "@nevile/api";
import { fakePayments, serverBookingDeps } from "@/lib/booking-deps.ts";
import { crossSiteRefused, isForeignOrigin } from "@/lib/same-origin.ts";

/** The fake payout-setup page's "Finish" button (development and tests only). */
export async function POST(req: Request): Promise<Response> {
  const fake = fakePayments();
  if (!fake) return new Response("Not found", { status: 404 });
  if (isForeignOrigin(req)) return crossSiteRefused();
  const form = await req.formData();
  const accountId = String(form.get("accountId") ?? "");
  const returnUrl = String(form.get("returnUrl") ?? "/business/payouts");
  try {
    await handlePaymentEvent(serverBookingDeps(), fake.finishOnboarding(accountId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Setup failed.";
    return Response.json({ error: { message } }, { status: 409 });
  }
  // Only ever back to this site.
  const target = new URL(returnUrl, req.url);
  const safe =
    target.origin === new URL(req.url).origin ? target : new URL("/business/payouts", req.url);
  return Response.redirect(safe, 303);
}
