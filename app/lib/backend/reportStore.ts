import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql, gte } from "drizzle-orm";
import { db } from "./db";
import { reports, reportVersions, investors } from "./schema";
import { validateNormalizedReport, isUuid } from "./normalized";
import { summaryFromNormalized } from "../financialInsights/storedSummary";
import { randomUUID } from "node:crypto";
import { InsightsError } from "../financialInsights/contracts";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const summaryHash = (report: unknown) =>
  createHash("sha256").update(canonical(report)).digest("hex");
export async function saveReport(userId: string, value: unknown) {
  const normalized = validateNormalizedReport(value);
  summaryFromNormalized(
    normalized,
    normalized.investors.map((investor) => investor.localReference),
    randomUUID(),
  );
  return db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
    );
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const [usage] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reports)
      .where(and(eq(reports.userId, userId), gte(reports.createdAt, day)));
    if ((usage?.count ?? 0) >= 50) throw new InsightsError("RATE_LIMITED", 429);
    const [report] = await tx.insert(reports).values({ userId }).returning();
    const [version] = await tx
      .insert(reportVersions)
      .values({
        reportId: report.id,
        versionNumber: 1,
        currency: normalized.currency,
        currentPeriod: normalized.currentPeriod,
        previousPeriod: normalized.previousPeriod,
        normalizedSummaryJson: normalized,
        summaryHash: summaryHash(normalized),
      })
      .returning();
    const stored = await tx
      .insert(investors)
      .values(
        normalized.investors.map((investor) => ({
          reportVersionId: version.id,
          localReference: investor.localReference,
        })),
      )
      .returning();
    return {
      reportId: report.id,
      reportVersionId: version.id,
      investorMap: Object.fromEntries(
        stored.map((investor) => [investor.localReference, investor.id]),
      ),
    };
  });
}
export async function loadReportVersion(userId: string, versionId: string) {
  if (!isUuid(userId) || !isUuid(versionId)) return null;
  const [record] = await db()
    .select({ version: reportVersions })
    .from(reportVersions)
    .innerJoin(reports, eq(reports.id, reportVersions.reportId))
    .where(and(eq(reports.userId, userId), eq(reportVersions.id, versionId)))
    .limit(1);
  if (!record) return null;
  const normalized = validateNormalizedReport(
    record.version.normalizedSummaryJson,
  );
  if (
    record.version.status !== "confirmed" ||
    summaryHash(normalized) !== record.version.summaryHash
  )
    throw new InsightsError("RECONCILIATION_FAILED", 422);
  const members = await db()
    .select()
    .from(investors)
    .where(eq(investors.reportVersionId, versionId));
  if (
    members.length !== normalized.investors.length ||
    members.some(
      (member) =>
        !normalized.investors.some(
          (investor) => investor.localReference === member.localReference,
        ),
    )
  )
    throw new InsightsError("RECONCILIATION_FAILED", 422);
  return { version: record.version, normalized, investors: members };
}
