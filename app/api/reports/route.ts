import { authenticatedUser } from "../../lib/backend/auth";
import { boundedJson, safeFailure } from "../../lib/backend/http";
import { saveReport } from "../../lib/backend/reportStore";
import { InsightsError } from "../../lib/financialInsights/contracts";
export async function POST(request: Request) {
  try {
    const user = await authenticatedUser();
    if (!user?.emailVerified)
      throw new InsightsError("AUTHENTICATION_REQUIRED", 401);
    return Response.json(
      await saveReport(user.userId, await boundedJson(request)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return safeFailure(error);
  }
}
