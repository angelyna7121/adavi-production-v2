import "server-only";
import { eq, and, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { entitlements, aiAnalysisRequests } from "./schema";
import { decideEntitlement } from "./entitlement";
export async function resolveEntitlement(
  userId: string,
  reportId: string | null = null,
) {
  const limit = Number(process.env.FINANCIAL_ANALYSIS_DAILY_LIMIT ?? 5);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("INVALID_LIMIT_CONFIGURATION");
  const records = await db()
    .select()
    .from(entitlements)
    .where(eq(entitlements.userId, userId));
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const [usage] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(aiAnalysisRequests)
    .where(
      and(
        eq(aiAnalysisRequests.userId, userId),
        gte(aiAnalysisRequests.createdAt, day),
        inArray(aiAnalysisRequests.status, ["reserved", "completed"]),
      ),
    );
  return decideEntitlement(
    records,
    reportId,
    Math.max(0, limit - (usage?.count ?? 0)),
  );
}
