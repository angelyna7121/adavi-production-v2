import "server-only";
import { eq, and, sql } from "drizzle-orm";
import { db } from "./db";
import { aiAnalysisRequests, auditEvents } from "./schema";
import type {
  AnalysisReservationStore,
  Reservation,
} from "../financialInsights/server/allowance";
import { CONSENT_VERSION } from "../financialInsights/notices";
import { InsightsError } from "../financialInsights/contracts";
export function reservationStore(model: string): AnalysisReservationStore {
  return {
    async transaction(userId, accountId, operation) {
      return db().transaction(async (tx) => {
        // Account==user for this application. Database-wide transaction lock covers
        // allowances across all Vercel instances, not just this Node process.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
        );
        return operation({
          list: async () => {
            const rows = await tx
              .select()
              .from(aiAnalysisRequests)
              .where(eq(aiAnalysisRequests.userId, userId));
            return rows
              .filter((row) => row.userId === userId)
              .map((row) => ({
                id: row.id,
                userId: row.userId,
                accountId: row.userId,
                versionId: row.reportVersionId,
                revision: row.revision,
                scopeKey: row.scopeKey,
                createdAt: row.createdAt.getTime(),
                status: row.status as Reservation["status"],
                reservedCostUsd: Number(row.reservedCostUsd),
                actualCostUsd:
                  row.actualCostUsd === null
                    ? undefined
                    : Number(row.actualCostUsd),
              }));
          },
          insert: async (record) => {
            if (accountId !== userId)
              throw new InsightsError("REPORT_UNAUTHORIZED", 403);
            await tx
              .insert(aiAnalysisRequests)
              .values({
                id: record.id,
                userId,
                reportVersionId: record.versionId,
                revision: record.revision,
                scope:
                  record.scopeKey.split(",").length === 1
                    ? "individual"
                    : "consolidated",
                selectedInvestorReferences: record.scopeKey.split(","),
                scopeKey: record.scopeKey,
                status: "reserved",
                provider: "openai",
                model,
                consentVersion: CONSENT_VERSION,
                reservedCostUsd: String(record.reservedCostUsd),
              });
          },
        });
      });
    },
    async finish(id, status, event, cost) {
      await db().transaction(async (tx) => {
        const [row] = await tx
          .update(aiAnalysisRequests)
          .set({
            status,
            completedAt: new Date(),
            inputTokenCount: event.usage?.inputTokens,
            outputTokenCount: event.usage?.outputTokens,
            errorCategory: event.errorCategory,
            actualCostUsd: cost === undefined ? undefined : String(cost),
          })
          .where(
            and(
              eq(aiAnalysisRequests.id, id),
              eq(aiAnalysisRequests.userId, event.userId),
              eq(aiAnalysisRequests.status, "reserved"),
            ),
          )
          .returning();
        if (!row) throw new Error("RESERVATION_NOT_FOUND");
        await tx
          .insert(auditEvents)
          .values({
            userId: event.userId,
            eventType: `analysis.${status}`,
            resourceId: id,
            metadataJson: {
              reportVersionId: event.reportVersionId,
              requestId: event.requestId,
              scope: event.scope,
              model: event.model,
              timestamp: event.timestamp,
              status,
              entitlementSource: event.entitlementSource,
              consentVersion: event.consentVersion,
              errorCategory: event.errorCategory ?? null,
              inputTokens: event.usage?.inputTokens ?? null,
              outputTokens: event.usage?.outputTokens ?? null,
            },
          });
      });
    },
  };
}
