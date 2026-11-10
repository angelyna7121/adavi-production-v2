import type { SelectedInvestorReport } from "../../reportData";
import type { AnalysisUsage, FinancialInsights } from "../contracts";

/** Integration contracts only. No implementation in this browser-local app and
 * no enabled live route. A browser claim can never create these credentials. */
export type AnalysisAllowanceKind = "complimentary" | "premium" | "owner" | "promotional" | "report-pass";
export type AuthorizedFinancialContext = {
  customerId: string;
  investorIds: string[];
  dataVersion: string;
  statementDate: string;
  currency: string;
  recordCurrencies: string[];
  report: SelectedInvestorReport;
};
export interface TrustedFinancialAccess {
  resolveAuthenticatedCustomer(request: Request): Promise<string | null>;
  // Must authorize every ID before loading/recalculating server-owned records.
  loadAuthorizedReport(customerId: string, investorIds: string[]): Promise<AuthorizedFinancialContext>;
}
export interface DurableAnalysisLedger {
  // One database transaction reserves allowance AND a unique request key, so
  // parallel Vercel instances cannot overspend. Never rely on an in-memory Map.
  reserve(input: { customerId: string; scopeFingerprint: string; dataVersion: string; period: string; currency: string; configuration: string; allowanceKind: AnalysisAllowanceKind; maximumUses: number; maximumCostUsd: number; maximumRequestCostUsd: number }): Promise<{ reservationId: string; cachedInsights: FinancialInsights | null }>;
  complete(reservationId: string, insights: FinancialInsights, usage: AnalysisUsage): Promise<void>;
  fail(reservationId: string, code: string): Promise<void>;
}
