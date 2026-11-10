import { eq, and } from "drizzle-orm";
import { authenticatedUser } from "../../../lib/backend/auth";
import { resolveEntitlement } from "../../../lib/backend/resolveEntitlement";
import { db } from "../../../lib/backend/db";
import { users, reports, entitlements } from "../../../lib/backend/schema";
import { isUuid } from "../../../lib/backend/normalized";
import { boundedJson, safeFailure } from "../../../lib/backend/http";
import { InsightsError } from "../../../lib/financialInsights/contracts";
async function owner() {
  const user = await authenticatedUser();
  if (
    !user?.emailVerified ||
    (await resolveEntitlement(user.userId)).source !== "owner"
  )
    throw new InsightsError("OWNER_REQUIRED", 403);
  return user;
}
export async function POST(request: Request) {
  try {
    await owner();
    const input = await boundedJson(request, 2048);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(",") !==
        "expiresAt,reportScopeId,source,userId"
    )
      throw new InsightsError("INVALID_REQUEST");
    const value = input as Record<string, unknown>;
    if (
      !isUuid(value.userId) ||
      !["complimentary", "report-pass"].includes(String(value.source)) ||
      typeof value.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= Date.now() ||
      (value.reportScopeId !== null && !isUuid(value.reportScopeId)) ||
      (value.source === "report-pass" && !isUuid(value.reportScopeId))
    )
      throw new InsightsError("INVALID_REQUEST");
    const [user] = await db()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, value.userId));
    if (!user) throw new InsightsError("INVALID_REQUEST");
    if (value.reportScopeId) {
      const [report] = await db()
        .select({ id: reports.id })
        .from(reports)
        .where(
          and(
            eq(reports.id, String(value.reportScopeId)),
            eq(reports.userId, user.id),
          ),
        );
      if (!report) throw new InsightsError("REPORT_UNAUTHORIZED", 403);
    }
    const [grant] = await db()
      .insert(entitlements)
      .values({
        userId: user.id,
        source: String(value.source),
        status: "active",
        expiresAt: new Date(value.expiresAt),
        reportScopeId: value.reportScopeId as string | null,
      })
      .returning({ id: entitlements.id });
    return Response.json(grant, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return safeFailure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    await owner();
    const input = await boundedJson(request, 1024);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).join(",") !== "id" ||
      !isUuid((input as { id: unknown }).id)
    )
      throw new InsightsError("INVALID_REQUEST");
    await db()
      .update(entitlements)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(entitlements.id, (input as { id: string }).id));
    return Response.json({ revoked: true });
  } catch (error) {
    return safeFailure(error);
  }
}
