import "server-only";
import Stripe from "stripe";
export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY,
    mode = process.env.STRIPE_MODE ?? "test";
  if (
    !key ||
    !["test", "live"].includes(mode) ||
    !key.startsWith(mode === "test" ? "sk_test_" : "sk_live_")
  )
    throw new Error("STRIPE_UNAVAILABLE");
  if (
    mode === "live" &&
    (process.env.VERCEL_ENV !== "production" ||
      process.env.APP_DATA_ENV !== "production")
  )
    throw new Error("STRIPE_ENVIRONMENT_MISMATCH");
  return new Stripe(key, { maxNetworkRetries: 1, timeout: 10000 });
}
export function billingOrigin() {
  const value = process.env.APP_URL;
  if (!value) throw new Error("APP_URL_REQUIRED");
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error("APP_URL_INVALID");
  return url.origin;
}
export function priceMap() {
  return {
    monthly: process.env.STRIPE_MONTHLY_PRICE_ID,
    yearly: process.env.STRIPE_YEARLY_PRICE_ID,
  };
}
