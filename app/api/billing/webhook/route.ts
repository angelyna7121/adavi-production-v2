import { stripeClient, priceMap } from "../../../lib/backend/stripe";
import { processStripeEvent } from "../../../lib/backend/stripeWebhook";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET,
      signature = request.headers.get("stripe-signature");
    if (!secret || !signature)
      return new Response("Webhook unavailable", { status: 400 });
    const reader = request.body?.getReader();
    if (!reader) return new Response("Invalid webhook", { status: 400 });
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 262144) {
        await reader.cancel();
        return new Response("Invalid webhook", { status: 413 });
      }
      chunks.push(chunk.value);
    }
    const stripe = stripeClient();
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        Buffer.concat(chunks),
        signature,
        secret,
      );
    } catch {
      return new Response("Invalid signature", { status: 400 });
    }
    await processStripeEvent(
      event,
      stripe,
      Object.values(priceMap()).filter((value): value is string => !!value),
    );
    return Response.json({ received: true });
  } catch {
    return new Response("Webhook processing unavailable", { status: 503 });
  }
}
