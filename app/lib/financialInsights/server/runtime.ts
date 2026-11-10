import "server-only";
import { InsightsError } from "../contracts";
import type { LiveAnalysisDependencies } from "./live";
import { readAnalysisMode, type AnalysisCapability } from "../settings";
import { backendConfigured } from "../../backend/db";
import { authenticatedUser } from "../../backend/auth";
import { loadReportVersion } from "../../backend/reportStore";
import { resolveEntitlement } from "../../backend/resolveEntitlement";
import { AnalysisAllowance, type AllowancePolicy } from "./allowance";
import { reservationStore } from "../../backend/reservationStore";
import { OpenAIProvider } from "./provider";
export function liveDependencies(): LiveAnalysisDependencies | null {
  try {
    if (
      !backendConfigured() ||
      readAnalysisMode(process.env) !== "live" ||
      process.env.FINANCIAL_ANALYSIS_PRIVACY_APPROVED !== "true" ||
      process.env.FINANCIAL_ANALYSIS_CONFIGURATION_VERIFIED !== "true"
    )
      return null;
    const model = process.env.OPENAI_FINANCIAL_ANALYSIS_MODEL,
      apiKey = process.env.OPENAI_API_KEY,
      retentionNotice = process.env.FINANCIAL_ANALYSIS_RETENTION_NOTICE;
    if (!model || !apiKey || !retentionNotice || retentionNotice.length > 1000)
      return null;
    const number = (name: string, fallback?: number) => {
      const value = Number(process.env[name] ?? fallback);
      if (!Number.isFinite(value) || value <= 0)
        throw new Error("INVALID_CONFIGURATION");
      return value;
    };
    const limits: AllowancePolicy = {
      dailyPerUser: number("FINANCIAL_ANALYSIS_DAILY_LIMIT", 5),
      dailyPerAccount: number("FINANCIAL_ANALYSIS_DAILY_LIMIT", 5),
      perReportVersion: number("FINANCIAL_ANALYSIS_REPORT_LIMIT", 3),
      monthlyCostUsd: number("FINANCIAL_ANALYSIS_MONTHLY_COST_LIMIT"),
      maximumRequestCostUsd: number("FINANCIAL_ANALYSIS_REQUEST_COST_LIMIT"),
      maximumCategories: 20,
      perMinuteUser: 6,
      perMinuteAccount: 6,
    };
    const provider = new OpenAIProvider({
      apiKey,
      model,
      inputUsdPerMillion: number("AI_INPUT_USD_PER_MILLION"),
      outputUsdPerMillion: number("AI_OUTPUT_USD_PER_MILLION"),
    });
    const allowance = new AnalysisAllowance(reservationStore(model), limits);
    return {
      provider,
      model,
      limits,
      providerLabel: "OpenAI",
      retentionNotice,
      authenticate: async () => authenticatedUser(),
      entitlement: async (session, versionId) => {
        const report = versionId
          ? await loadReportVersion(session.userId, versionId)
          : null;
        if (versionId && !report)
          throw new InsightsError("REPORT_UNAUTHORIZED", 403);
        const decision = await resolveEntitlement(
          session.userId,
          report?.version.reportId ?? null,
        );
        if (decision.source !== "free" && decision.remainingAiAnalyses === 0)
          throw new InsightsError("USAGE_LIMIT_REACHED", 429);
        return {
          canAnalyzeFinancialPosition: decision.canAnalyzeFinancialPosition,
          source:
            decision.source === "report-pass" || decision.source === "free"
              ? "approved"
              : decision.source,
          expiresAt: decision.expiresAt?.getTime() ?? Date.now() + 60000,
        };
      },
      loadReport: async (session, versionId) => {
        const result = await loadReportVersion(session.userId, versionId);
        if (!result) return null;
        return {
          accountId: session.accountId,
          versionId,
          revision: result.version.summaryHash,
          confirmed: true,
          rows: [],
          investors: result.investors.map((investor) => ({
            investorId: investor.id,
            name: investor.id,
          })),
          authorizedInvestorIds: result.investors.map(
            (investor) => investor.id,
          ),
          date: result.normalized.currentPeriod,
          currency: result.normalized.currency,
          currencies: [result.normalized.currency],
          normalized: result.normalized,
          investorReferences: Object.fromEntries(
            result.investors.map((investor) => [
              investor.id,
              investor.localReference,
            ]),
          ),
        };
      },
      reserve: (input) => allowance.reserve(input),
      complete: (...args) => allowance.complete(...args),
      fail: (...args) => allowance.fail(...args),
    };
  } catch {
    return null;
  }
}
export function analysisCapability(): AnalysisCapability {
  const mode = readAnalysisMode(process.env);
  if (mode === "mock")
    return {
      mode,
      canAnalyzeFinancialPosition: false,
      reason: "Demonstration",
      eligibilityReason: "service-disabled",
    };
  const deps = mode === "live" ? liveDependencies() : null;
  if (!deps)
    return {
      mode: mode === "live" ? "live" : "disabled",
      canAnalyzeFinancialPosition: false,
      reason: "Financial analysis is not available in this environment.",
      eligibilityReason:
        mode === "disabled" ? "service-disabled" : "configuration-error",
    };
  return {
    mode: "live",
    canAnalyzeFinancialPosition: true,
    reason: "Ready to analyze",
    eligibilityReason: "ready",
    providerLabel: deps.providerLabel,
    retentionNotice: deps.retentionNotice,
  };
}

export async function userAnalysisCapability(): Promise<AnalysisCapability> {
  const capability = analysisCapability();
  if (!capability.canAnalyzeFinancialPosition) return capability;
  try {
    const user = await authenticatedUser();
    if (!user?.emailVerified)
      return {
        ...capability,
        canAnalyzeFinancialPosition: false,
        reason: "Sign in or upgrade to use financial analysis.",
        eligibilityReason: "not-authorized",
      };
    const entitlement = await resolveEntitlement(user.userId);
    if (!entitlement.canAnalyzeFinancialPosition)
      return {
        resetAt:
          entitlement.source !== "free" && entitlement.remainingAiAnalyses === 0
            ? new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString()
            : undefined,
        ...capability,
        canAnalyzeFinancialPosition: false,
        eligibilityReason:
          entitlement.source !== "free" && entitlement.remainingAiAnalyses === 0
            ? "usage-limit-reached"
            : "not-authorized",
        reason:
          entitlement.source !== "free" && entitlement.remainingAiAnalyses === 0
            ? "Usage limit reached"
            : "Not included in plan",
      };
    return capability;
  } catch {
    return {
      ...capability,
      canAnalyzeFinancialPosition: false,
      reason:
        "Financial analysis is temporarily unavailable. Please try again later.",
      eligibilityReason: "configuration-error",
    };
  }
}
