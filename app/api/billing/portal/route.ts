import { authenticatedUser } from "../../../lib/backend/auth";
import { stripeClient, billingOrigin } from "../../../lib/backend/stripe";
import { boundedJson, safeFailure } from "../../../lib/backend/http";
import { InsightsError } from "../../../lib/financialInsights/contracts";
export async function POST(request: Request) {
  try {
    const user = await authenticatedUser();
    if (!user?.emailVerified || !user.stripeCustomerId)
      throw new InsightsError("AUTHENTICATION_REQUIRED", 401);
    const value = await boundedJson(request, 1024);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length
    )
      throw new InsightsError("INVALID_REQUEST");
    const portal = await stripeClient().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${billingOrigin()}/account`,
    });
    return Response.json(
      { url: portal.url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return safeFailure(error);
  }
}
