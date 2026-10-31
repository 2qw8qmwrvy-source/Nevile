import { handlePaymentEvent } from "@nevile/api";
import { getPaymentProvider, WebhookSignatureError } from "@nevile/payments";
import { serverBookingDeps } from "@/lib/booking-deps.ts";

/**
 * Stripe notifications (SPEC §19): completed or expired checkouts and connected-account
 * updates. The signature is checked against the raw body before anything is trusted;
 * handling is idempotent, so Stripe's retries are safe.
 */
export async function POST(req: Request): Promise<Response> {
  const payments = getPaymentProvider();
  if (payments.name !== "stripe") return new Response("Not found", { status: 404 });
  const body = await req.text();
  let event: ReturnType<typeof payments.parseWebhook>;
  try {
    event = payments.parseWebhook(body, req.headers.get("stripe-signature"));
  } catch (error) {
    if (error instanceof WebhookSignatureError)
      return new Response("Bad signature", { status: 400 });
    throw error;
  }
  try {
    await handlePaymentEvent(serverBookingDeps(), event);
  } catch (error) {
    console.error("[webhooks] could not handle", event.type, error);
    // A 500 makes Stripe retry later.
    return new Response("Error", { status: 500 });
  }
  return Response.json({ received: true });
}
