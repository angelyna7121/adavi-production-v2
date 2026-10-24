import {
  analysisCapability,
  liveDependencies,
} from "../../lib/financialInsights/server/runtime";
import { handleLiveAnalysis } from "../../lib/financialInsights/server/liveHttp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
export async function POST(request: Request) {
  const capability = analysisCapability();
  return handleLiveAnalysis(
    request,
    capability.mode === "live" && capability.canAnalyzeFinancialPosition
      ? liveDependencies()
      : null,
  );
}
