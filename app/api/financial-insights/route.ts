import {
  demoAnalysisService,
  handleInsightsRequest,
} from "../../lib/financialInsights/server";

import { analysisCapability } from "../../lib/financialInsights/server/runtime";

export const runtime = "nodejs";
export const maxDuration = 15;
export async function POST(request: Request) {
  if (analysisCapability().mode !== "mock")
    return Response.json(
      {
        error: { code: "DEMO_DISABLED", message: "Demonstration is disabled." },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  return handleInsightsRequest(request, demoAnalysisService);
}
