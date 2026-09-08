import "server-only";

/**
 * Paid report mode must only be returned from authenticated, persisted subscription data.
 * This repository has no authentication or verified Stripe webhook store, so fail closed.
 */
export async function getVerifiedPaidEntitlement(): Promise<boolean> {
  return false;
}
