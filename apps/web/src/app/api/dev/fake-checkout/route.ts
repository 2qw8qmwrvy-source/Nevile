import { handlePaymentEvent } from "@nevile/api";
import { fakePayments, serverBookingDeps } from "@/lib/booking-deps.ts";
import { crossSiteRefused, isForeignOrigin } from "@/lib/same-origin.ts";

/** The fake checkout page's "Pay" button (development and tests only). */
export async function POST(req: Request): Promise<Response> {
  const fake = fakePayments();
  if (!fake) return new Response("Not found", { status: 404 });
  if (isForeignOrigin(req)) return crossSiteRefused();
  const form = await req.formData();
  const sessionId = String(form.get("sessionId") ?? "");
  try {
    const { event, redirectUrl } = fake.payCheckout(sessionId);
    await handlePaymentEvent(serverBookingDeps(), event);
    return Response.redirect(redirectUrl, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment failed.";
    return Response.json({ error: { message } }, { status: 409 });
  }
}
