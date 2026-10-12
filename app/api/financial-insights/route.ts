import { demoAnalysisService, handleInsightsRequest } from "../../lib/financialInsights/server";

export const runtime = "nodejs";
export const maxDuration = 15;
export async function POST(request: Request) {
  return handleInsightsRequest(request, demoAnalysisService);
}
