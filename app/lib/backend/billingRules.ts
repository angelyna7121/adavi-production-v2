import { InsightsError } from "../financialInsights/contracts";
export function approvedCheckoutPlan(
  value: unknown,
  prices: Record<string, string | undefined>,
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).join(",") !== "plan"
  )
    throw new InsightsError("INVALID_REQUEST");
  const plan = (value as { plan: unknown }).plan;
  if (plan !== "monthly" && plan !== "yearly")
    throw new InsightsError("PRICE_NOT_APPROVED");
  const price = prices[plan];
  if (!price || !/^price_[A-Za-z0-9]+$/.test(price))
    throw new InsightsError("PRICE_NOT_CONFIGURED", 503);
  return { plan, price };
}
export function paidSubscription(
  status: string,
  periodEnd: number,
  revoked: boolean,
  now = Date.now(),
) {
  return (
    !revoked &&
    status === "active" &&
    Number.isFinite(periodEnd) &&
    periodEnd * 1000 > now
  );
}
