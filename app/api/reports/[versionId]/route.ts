import { authenticatedUser } from "../../../lib/backend/auth";
import { loadReportVersion } from "../../../lib/backend/reportStore";
import { safeFailure } from "../../../lib/backend/http";
import { InsightsError } from "../../../lib/financialInsights/contracts";
export async function GET(
  _request: Request,
  context: { params: Promise<{ versionId: string }> },
) {
  try {
    const user = await authenticatedUser();
    if (!user) throw new InsightsError("AUTHENTICATION_REQUIRED", 401);
    const result = await loadReportVersion(
      user.userId,
      (await context.params).versionId,
    );
    if (!result) throw new InsightsError("REPORT_UNAUTHORIZED", 404);
    return Response.json(
      {
        reportVersionId: result.version.id,
        reportId: result.version.reportId,
        summary: result.normalized,
        investors: result.investors.map((investor) => ({
          id: investor.id,
          localReference: investor.localReference,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return safeFailure(error);
  }
}
