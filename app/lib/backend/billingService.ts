import type Stripe from "stripe";
import { approvedCheckoutPlan } from "./billingRules";
import { InsightsError } from "../financialInsights/contracts";
export async function createVerifiedCheckout(
  input: {
    userId: string;
    customerId: string | null;
    body: unknown;
    prices: Record<string, string | undefined>;
    liveMode: boolean;
    origin: string;
  },
  stripe: Stripe,
  saveCustomer: (id: string) => Promise<void>,
) {
  const { plan, price } = approvedCheckoutPlan(input.body, input.prices);
  const approved = await stripe.prices.retrieve(price);
  if (
    !approved.active ||
    approved.type !== "recurring" ||
    approved.recurring?.interval !== (plan === "monthly" ? "month" : "year") ||
    approved.livemode !== input.liveMode
  )
    throw new InsightsError("PRICE_NOT_APPROVED");
  let customer = input.customerId;
  if (!customer) {
    const created = await stripe.customers.create(
      { metadata: { adaviUserId: input.userId } },
      { idempotencyKey: `adavi-customer-${input.userId}` },
    );
    customer = created.id;
    await saveCustomer(customer);
  }
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer,
      client_reference_id: input.userId,
      line_items: [{ price, quantity: 1 }],
      success_url: `${input.origin}/account?checkout=complete`,
      cancel_url: `${input.origin}/account`,
      subscription_data: { metadata: { adaviUserId: input.userId } },
    },
    {
      idempotencyKey: `adavi-checkout-${input.userId}-${plan}-${Math.floor(Date.now() / 60000)}`,
    },
  );
  return { url: session.url };
}
