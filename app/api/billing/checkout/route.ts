import { authenticatedUser } from "../../../lib/backend/auth";
import { db } from "../../../lib/backend/db";
import { users } from "../../../lib/backend/schema";
import { eq } from "drizzle-orm";
import {
  stripeClient,
  billingOrigin,
  priceMap,
} from "../../../lib/backend/stripe";
import { createVerifiedCheckout } from "../../../lib/backend/billingService";
import { boundedJson, safeFailure } from "../../../lib/backend/http";
import { InsightsError } from "../../../lib/financialInsights/contracts";
export async function POST(request: Request) {
  try {
    const user = await authenticatedUser();
    if (!user?.emailVerified)
      throw new InsightsError("AUTHENTICATION_REQUIRED", 401);
    const result = await createVerifiedCheckout(
      {
        userId: user.userId,
        customerId: user.stripeCustomerId,
        body: await boundedJson(request, 1024),
        prices: priceMap(),
        liveMode: (process.env.STRIPE_MODE ?? "test") === "live",
        origin: billingOrigin(),
      },
      stripeClient(),
      async (customerId) => {
        await db()
          .update(users)
          .set({ stripeCustomerId: customerId, updatedAt: new Date() })
          .where(eq(users.id, user.userId));
      },
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return safeFailure(error);
  }
}
