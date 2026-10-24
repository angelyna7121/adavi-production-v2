import { InsightsError, type AnalysisUsage } from "../contracts";
import type { AnalysisLimits, AnalysisSession, AuditEvent } from "./live";

export type Reservation = {
  id: string;
  userId: string;
  accountId: string;
  versionId: string;
  revision: string;
  scopeKey: string;
  createdAt: number;
  status: "reserved" | "completed" | "failed";
  reservedCostUsd: number;
  actualCostUsd?: number;
};
/** The store must hold a cross-instance account AND user lock for this entire
 * transaction, commit atomically, and return every reservation relevant to the
 * user/account month. It must retain financial-free audit events durably.
 * A process-local Map is suitable only for isolated unit tests. */
export interface AnalysisReservationStore {
  transaction<T>(
    userId: string,
    accountId: string,
    operation: (tx: {
      list(): Promise<Reservation[]>;
      insert(record: Reservation): Promise<void>;
    }) => Promise<T>,
  ): Promise<T>;
  finish(
    id: string,
    status: "completed" | "failed",
    event: AuditEvent,
    actualCostUsd?: number,
  ): Promise<void>;
}
export type AllowancePolicy = AnalysisLimits & {
  perMinuteUser: number;
  perMinuteAccount: number;
};
export class AnalysisAllowance {
  constructor(
    private readonly store: AnalysisReservationStore,
    private readonly policy: AllowancePolicy,
    private readonly now = Date.now,
  ) {
    if (
      Object.values(policy).some(
        (value) => !Number.isFinite(value) || value <= 0,
      ) ||
      policy.maximumRequestCostUsd > policy.monthlyCostUsd
    )
      throw new InsightsError("INVALID_LIMIT_CONFIGURATION", 503);
  }
  async reserve(input: {
    session: AnalysisSession;
    versionId: string;
    revision: string;
    investorIds: string[];
    requestId: string;
  }) {
    const { session } = input,
      now = this.now(),
      day = new Date(now).toISOString().slice(0, 10),
      month = day.slice(0, 7);
    return this.store.transaction(
      session.userId,
      session.accountId,
      async (tx) => {
        const all = await tx.list();
        const account = all.filter(
            (row) => row.accountId === session.accountId,
          ),
          user = all.filter((row) => row.userId === session.userId);
        // Failed attempts still consume request rate, but never completed allowance.
        if (
          user.filter((row) => row.createdAt > now - 60000).length >=
            this.policy.perMinuteUser ||
          account.filter((row) => row.createdAt > now - 60000).length >=
            this.policy.perMinuteAccount
        )
          throw new InsightsError("RATE_LIMITED", 429);
        const usedToday = (rows: Reservation[]) =>
          rows.filter(
            (row) =>
              new Date(row.createdAt).toISOString().startsWith(day) &&
              row.status !== "failed",
          ).length;
        if (
          usedToday(user) >= this.policy.dailyPerUser ||
          usedToday(account) >= this.policy.dailyPerAccount
        )
          throw new InsightsError("USAGE_LIMIT_REACHED", 429);
        // Conservative account-wide report-version limit, irrespective of selection.
        if (
          account.filter(
            (row) =>
              row.versionId === input.versionId && row.status !== "failed",
          ).length >= this.policy.perReportVersion
        )
          throw new InsightsError("USAGE_LIMIT_REACHED", 429);
        const scopeKey = [...input.investorIds].sort().join(",");
        if (
          account.some(
            (row) =>
              row.versionId === input.versionId &&
              row.revision === input.revision &&
              row.scopeKey === scopeKey &&
              row.status === "reserved",
          )
        )
          throw new InsightsError("ANALYSIS_IN_PROGRESS", 409);
        // Keep conservative provider cost for ambiguous failures. Failure is never
        // chargeable customer completion, but external processing may have cost money.
        const spending = account
          .filter((row) =>
            new Date(row.createdAt).toISOString().startsWith(month),
          )
          .reduce(
            (total, row) => total + (row.actualCostUsd ?? row.reservedCostUsd),
            0,
          );
        if (
          spending + this.policy.maximumRequestCostUsd >
          this.policy.monthlyCostUsd
        )
          throw new InsightsError("USAGE_LIMIT_REACHED", 429);
        await tx.insert({
          id: input.requestId,
          userId: session.userId,
          accountId: session.accountId,
          versionId: input.versionId,
          revision: input.revision,
          scopeKey,
          createdAt: now,
          status: "reserved",
          reservedCostUsd: this.policy.maximumRequestCostUsd,
        });
        return { id: input.requestId };
      },
    );
  }
  async complete(id: string, usage: AnalysisUsage, event: AuditEvent) {
    if (
      usage.estimatedCostUsd === null ||
      !Number.isFinite(usage.estimatedCostUsd) ||
      usage.estimatedCostUsd < 0 ||
      usage.estimatedCostUsd > this.policy.maximumRequestCostUsd
    )
      throw new InsightsError("COST_VERIFICATION_FAILED", 503);
    await this.store.finish(id, "completed", event, usage.estimatedCostUsd);
  }
  async fail(id: string, event: AuditEvent) {
    await this.store.finish(id, "failed", event);
  }
}
