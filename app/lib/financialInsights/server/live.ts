import { trustedSummary, type StoredFinancialReport } from "../selection";
export { trustedSummary } from "../selection";
export type { StoredFinancialReport } from "../selection";
import { randomUUID } from "node:crypto";
import {
  InsightsError,
  validateInsights,
  type AnalysisUsage,
  type FinancialInsights,
} from "../contracts";
import type { FinancialAIProvider } from "./provider";

import { CONSENT_VERSION } from "../notices";
export { CONSENT_VERSION, EDUCATIONAL_NOTICE } from "../notices";
export type AnalysisSession = {
  userId: string;
  accountId: string;
  emailVerified: boolean;
};
export type AnalysisEntitlement = {
  canAnalyzeFinancialPosition: boolean;
  source: "owner" | "complimentary" | "premium" | "approved";
  expiresAt: number;
};
export type AnalysisLimits = {
  dailyPerUser: number;
  dailyPerAccount: number;
  perReportVersion: number;
  monthlyCostUsd: number;
  maximumRequestCostUsd: number;
  maximumCategories: number;
};
export type AuditEvent = {
  userId: string;
  reportVersionId: string;
  requestId: string;
  scope: "individual" | "consolidated";
  model: string;
  timestamp: string;
  status: "completed" | "failed";
  entitlementSource: AnalysisEntitlement["source"];
  consentVersion: string;
  errorCategory?: string;
  usage?: AnalysisUsage;
};
/** Implement these operations with the application's verified session and database.
 * reserve MUST atomically enforce user/account rate limits, daily allowances,
 * report-version allowance, concurrent idempotency, and monthly cost reservations.
 * Failed requests release completion allowance; provider spending must still count
 * toward the account's cost ceiling even if output validation fails. */
export interface LiveAnalysisDependencies {
  authenticate(request: Request): Promise<AnalysisSession | null>;
  entitlement(
    session: AnalysisSession,
    reportVersionId?: string,
  ): Promise<AnalysisEntitlement>;
  loadReport(
    session: AnalysisSession,
    versionId: string,
  ): Promise<StoredFinancialReport | null>;
  reserve(input: {
    session: AnalysisSession;
    versionId: string;
    revision: string;
    investorIds: string[];
    requestId: string;
    limits: AnalysisLimits;
  }): Promise<{ id: string }>;
  complete(
    reservationId: string,
    usage: AnalysisUsage,
    event: AuditEvent,
  ): Promise<void>;
  fail(reservationId: string, event: AuditEvent): Promise<void>;
  provider: FinancialAIProvider;
  model: string;
  limits: AnalysisLimits;
  // Persisted provider/privacy approval, not a client flag. Shown verbatim in consent.
  providerLabel: string;
  retentionNotice: string;
}
export type LiveRequest = {
  reportVersionId: string;
  investorIds: string[];
  consent: true;
  consentVersion: string;
};
const opaque = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function validateLiveRequest(value: unknown): LiveRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InsightsError("INVALID_REQUEST");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !==
    "consent,consentVersion,investorIds,reportVersionId"
  )
    throw new InsightsError("INVALID_REQUEST");
  if (v.consent !== true || v.consentVersion !== CONSENT_VERSION)
    throw new InsightsError("CONSENT_REQUIRED");
  if (
    !opaque(v.reportVersionId) ||
    !Array.isArray(v.investorIds) ||
    !v.investorIds.length ||
    v.investorIds.length > 25 ||
    !v.investorIds.every(opaque) ||
    new Set(v.investorIds).size !== v.investorIds.length
  )
    throw new InsightsError("INVALID_REQUEST");
  return v as LiveRequest;
}

function entitled(entitlement: AnalysisEntitlement) {
  if (
    !entitlement.canAnalyzeFinancialPosition ||
    !["owner", "complimentary", "premium", "approved"].includes(
      entitlement.source,
    ) ||
    !Number.isFinite(entitlement.expiresAt) ||
    entitlement.expiresAt <= Date.now()
  )
    throw new InsightsError("NOT_INCLUDED_IN_PLAN", 403);
}
export async function analyzeAuthorized(
  request: Request,
  session: AnalysisSession,
  input: LiveRequest,
  deps: LiveAnalysisDependencies,
) {
  if (
    !session.emailVerified ||
    !opaque(session.userId) ||
    !opaque(session.accountId)
  )
    throw new InsightsError("AUTHENTICATION_REQUIRED", 401);
  const entitlement = await deps.entitlement(session, input.reportVersionId);
  entitled(entitlement);
  const stored = await deps.loadReport(session, input.reportVersionId);
  if (
    !stored ||
    stored.accountId !== session.accountId ||
    stored.versionId !== input.reportVersionId
  )
    throw new InsightsError("REPORT_UNAUTHORIZED", 403);
  const requestId = randomUUID();
  const summary = trustedSummary(
    stored,
    input.investorIds,
    requestId,
    deps.limits.maximumCategories,
  );
  const maximumCost = deps.provider.estimateMaximumCostUsd(summary);
  if (
    maximumCost === null ||
    !Number.isFinite(maximumCost) ||
    maximumCost < 0 ||
    maximumCost > deps.limits.maximumRequestCostUsd
  )
    throw new InsightsError("COST_CONFIGURATION_REQUIRED", 503);
  const reservation = await deps.reserve({
    session,
    versionId: stored.versionId,
    revision: stored.revision,
    investorIds: [...input.investorIds].sort(),
    requestId,
    limits: deps.limits,
  });
  const audit: AuditEvent = {
    userId: session.userId,
    reportVersionId: stored.versionId,
    requestId,
    scope: summary.scope.kind,
    model: deps.model,
    timestamp: new Date().toISOString(),
    status: "failed",
    entitlementSource: entitlement.source,
    consentVersion: CONSENT_VERSION,
  };
  try {
    // Revalidate session, entitlement and report immediately before external I/O.
    const fresh = await deps.authenticate(request);
    if (
      !fresh ||
      !fresh.emailVerified ||
      fresh.userId !== session.userId ||
      fresh.accountId !== session.accountId
    )
      throw new InsightsError("AUTHENTICATION_REQUIRED", 401);
    const freshEntitlement = await deps.entitlement(
      fresh,
      input.reportVersionId,
    );
    entitled(freshEntitlement);
    audit.entitlementSource = freshEntitlement.source;
    const freshReport = await deps.loadReport(fresh, input.reportVersionId);
    if (
      !freshReport ||
      freshReport.accountId !== session.accountId ||
      freshReport.revision !== stored.revision ||
      freshReport.versionId !== stored.versionId
    )
      throw new InsightsError("REPORT_CHANGED", 409);
    const refreshed = trustedSummary(
      freshReport,
      input.investorIds,
      requestId,
      deps.limits.maximumCategories,
    );
    if (JSON.stringify(refreshed) !== JSON.stringify(summary))
      throw new InsightsError("REPORT_CHANGED", 409);
    const result = await deps.provider.analyzeFinancialPosition(
      summary,
      request.signal,
    );
    const insights = validateInsights(result.insights, summary);
    await deps.complete(reservation.id, result.usage, {
      ...audit,
      status: "completed",
      usage: result.usage,
    });
    return {
      source: "live" as const,
      summary,
      insights,
      generatedAt: new Date().toISOString(),
      modelLabel: deps.model,
      requestId,
    };
  } catch (error) {
    const safe =
      error instanceof InsightsError
        ? error
        : new InsightsError("SERVICE_UNAVAILABLE", 503);
    await deps.fail(reservation.id, { ...audit, errorCategory: safe.code });
    throw safe;
  }
}
export type LiveAnalysisResult = Awaited<ReturnType<typeof analyzeAuthorized>>;
export type { FinancialInsights };
