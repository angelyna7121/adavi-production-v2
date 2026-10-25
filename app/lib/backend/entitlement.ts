export type EntitlementSource =
  | "owner"
  | "complimentary"
  | "report-pass"
  | "premium"
  | "free";
export type EntitlementRecord = {
  source: string;
  status: string;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  reportScopeId: string | null;
};
export type EntitlementDecision = {
  canPrintBranded: boolean;
  canPrintUnbranded: boolean;
  canExportCsv: boolean;
  canExportExcel: boolean;
  canGeneratePdf: boolean;
  canAnalyzeFinancialPosition: boolean;
  source: EntitlementSource;
  expiresAt: Date | null;
  reportScopeId: string | null;
  remainingAiAnalyses: number | null;
};
export function decideEntitlement(
  records: EntitlementRecord[],
  reportId: string | null,
  remaining: number | null,
  now = new Date(),
): EntitlementDecision {
  const active = records.filter(
    (record) =>
      record.status === "active" &&
      !record.revokedAt &&
      record.startsAt <= now &&
      (!record.expiresAt || record.expiresAt > now) &&
      (!record.reportScopeId || record.reportScopeId === reportId),
  );
  const grant = ["owner", "complimentary", "premium", "report-pass"]
    .map(
      (source) =>
        active
          .filter((record) => record.source === source)
          .sort(
            (a, b) =>
              (b.expiresAt?.getTime() ?? Infinity) -
              (a.expiresAt?.getTime() ?? Infinity),
          )[0],
    )
    .find(Boolean);
  const paid = !!grant;
  const ai =
    paid &&
    grant.source !== "report-pass" &&
    remaining !== null &&
    remaining > 0;
  return {
    canPrintBranded: true,
    canPrintUnbranded: paid,
    canExportCsv: paid,
    canExportExcel: paid,
    canGeneratePdf: true,
    canAnalyzeFinancialPosition: ai,
    source: (grant?.source ?? "free") as EntitlementSource,
    expiresAt: grant?.expiresAt ?? null,
    reportScopeId: grant?.reportScopeId ?? null,
    remainingAiAnalyses: remaining,
  };
}
