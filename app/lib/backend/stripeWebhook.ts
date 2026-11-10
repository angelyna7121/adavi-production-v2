import "server-only";
import type Stripe from "stripe";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  entitlements,
  subscriptions,
  stripeWebhookEvents,
} from "./schema";
import { paidSubscription } from "./billingRules";
const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
export async function processStripeEvent(
  event: Stripe.Event,
  stripe: Stripe,
  allowedPrices: string[],
) {
  if (event.livemode !== ((process.env.STRIPE_MODE ?? "test") === "live"))
    throw new Error("STRIPE_ENVIRONMENT_MISMATCH");
  let subscription: Stripe.Subscription | null = null;
  const revokeIds: string[] = [];
  const refunded: Stripe.Subscription[] = [];
  if (event.type.startsWith("customer.subscription.")) {
    const object = event.data.object as Stripe.Subscription;
    subscription =
      event.type === "customer.subscription.deleted"
        ? object
        : await stripe.subscriptions.retrieve(object.id);
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const sub = id(session.subscription);
    if (sub) subscription = await stripe.subscriptions.retrieve(sub);
  }
  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed"
  ) {
    const invoice = event.data.object as Stripe.Invoice;
    const sub = id(invoice.parent?.subscription_details?.subscription);
    if (sub) subscription = await stripe.subscriptions.retrieve(sub);
  }
  if (
    event.type === "charge.refunded" ||
    event.type === "charge.dispute.created"
  ) {
    const charge =
      event.type === "charge.refunded"
        ? (event.data.object as Stripe.Charge)
        : await stripe.charges.retrieve(
            id((event.data.object as Stripe.Dispute).charge)!,
          );
    const intent = id(charge.payment_intent);
    if (intent) {
      const payments = await stripe.invoicePayments.list({
        payment: { type: "payment_intent", payment_intent: intent },
        limit: 100,
      });
      if (payments.has_more) throw new Error("REFUND_SCOPE_UNRESOLVED");
      for (const payment of payments.data) {
        const invoice = await stripe.invoices.retrieve(id(payment.invoice)!);
        const sub = id(invoice.parent?.subscription_details?.subscription);
        if (sub) {
          revokeIds.push(sub);
          refunded.push(await stripe.subscriptions.retrieve(sub));
        }
      }
    }
  }
  await db().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(stripeWebhookEvents)
      .values({
        stripeEventId: event.id,
        eventType: event.type,
        status: "processing",
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted) return;
    const affected = [...(subscription ? [subscription] : []), ...refunded];
    for (const subscription of affected.sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`stripe:${subscription.id}`}, 0))`,
      );
      const customer = id(subscription.customer);
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.stripeCustomerId, customer ?? ""))
        .limit(1);
      if (!user) throw new Error("STRIPE_CUSTOMER_UNMAPPED");
      const item = subscription.items.data[0],
        price = item?.price.id ?? "",
        periodEnd = item?.current_period_end ?? 0;
      const [prior] = await tx
        .select()
        .from(entitlements)
        .where(eq(entitlements.stripeSubscriptionId, subscription.id))
        .limit(1);
      // A refund/revocation cannot be undone by a late or replayed activation event.
      const active =
        subscription.items.data.length === 1 &&
        allowedPrices.includes(price) &&
        paidSubscription(
          subscription.status,
          periodEnd,
          !!prior?.revokedAt ||
            revokeIds.includes(subscription.id) ||
            ["canceled", "incomplete_expired"].includes(subscription.status),
        );
      const expiresAt = periodEnd ? new Date(periodEnd * 1000) : new Date();
      await tx
        .insert(subscriptions)
        .values({
          id: subscription.id,
          userId: user.id,
          customerId: customer!,
          priceId: price,
          status: subscription.status,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: subscriptions.id,
          set: {
            status: subscription.status,
            priceId: price,
            expiresAt,
            updatedAt: new Date(),
          },
        });
      await tx
        .insert(entitlements)
        .values({
          userId: user.id,
          source: "premium",
          status: active ? "active" : "inactive",
          startsAt: new Date(),
          expiresAt,
          stripeCustomerId: customer,
          stripeSubscriptionId: subscription.id,
          revokedAt:
            revokeIds.includes(subscription.id) ||
            ["canceled", "incomplete_expired"].includes(subscription.status)
              ? new Date()
              : null,
        })
        .onConflictDoUpdate({
          target: entitlements.stripeSubscriptionId,
          set: {
            status: active ? "active" : "inactive",
            expiresAt,
            revokedAt:
              revokeIds.includes(subscription.id) ||
              ["canceled", "incomplete_expired"].includes(subscription.status)
                ? new Date()
                : (prior?.revokedAt ?? null),
          },
        });
    }
    for (const subscriptionId of revokeIds) {
      await tx
        .update(entitlements)
        .set({
          status: "revoked",
          revokedAt: new Date(),
          expiresAt: new Date(),
        })
        .where(
          and(
            eq(entitlements.stripeSubscriptionId, subscriptionId),
            eq(entitlements.source, "premium"),
          ),
        );
      await tx
        .update(subscriptions)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(eq(subscriptions.id, subscriptionId));
    }
    await tx
      .update(stripeWebhookEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(stripeWebhookEvents.id, inserted.id));
  });
}
