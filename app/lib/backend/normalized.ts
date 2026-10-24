import { InsightsError } from "../financialInsights/contracts";
import { categories, type NormalizedReport } from "./normalizedTypes";
export type { NormalizedReport } from "./normalizedTypes";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
function keys(
  value: unknown,
  expected: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...expected].sort().join(",")
  )
    throw new InsightsError("INVALID_REPORT", 422);
}
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 100000;
const amount = (v: unknown) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= 1e13 &&
  Math.abs(v * 100 - Math.round(v * 100)) < 0.01;
function validDate(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v
  );
}
export function validateNormalizedReport(input: unknown): NormalizedReport {
  keys(input, [
    "version",
    "currency",
    "currentPeriod",
    "previousPeriod",
    "confirmed",
    "investors",
  ]);
  if (
    input.version !== "1" ||
    input.confirmed !== true ||
    typeof input.currency !== "string" ||
    !new Set(["CAD", "USD", "EUR", "GBP", "AUD", "CHF", "JPY"]).has(
      input.currency,
    ) ||
    !validDate(input.currentPeriod) ||
    !validDate(input.previousPeriod) ||
    input.previousPeriod >= input.currentPeriod ||
    !Array.isArray(input.investors) ||
    input.investors.length < 1 ||
    input.investors.length > 25
  )
    throw new InsightsError("INVALID_REPORT", 422);
  const [year, month] = input.currentPeriod.split("-").map(Number);
  if (
    input.previousPeriod !==
    new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10)
  )
    throw new InsightsError("INVALID_REPORT", 422);
  const ids = new Set();
  for (const investor of input.investors) {
    keys(investor, ["localReference", "categories", "excludedRowCount"]);
    if (
      !isUuid(investor.localReference) ||
      ids.has(investor.localReference) ||
      !count(investor.excludedRowCount) ||
      !Array.isArray(investor.categories) ||
      investor.categories.length < 1 ||
      investor.categories.length > 20
    )
      throw new InsightsError("INVALID_REPORT", 422);
    ids.add(investor.localReference);
    const seen = new Set();
    for (const category of investor.categories) {
      keys(category, [
        "category",
        "kind",
        "current",
        "previous",
        "accountCount",
        "missingPreviousCount",
        "lowConfidenceCount",
      ]);
      if (
        (category.kind !== "Asset" && category.kind !== "Liability") ||
        typeof category.category !== "string" ||
        !(categories[category.kind] as readonly string[]).includes(
          category.category,
        ) ||
        seen.has(category.category) ||
        !amount(category.current) ||
        (category.previous !== null && !amount(category.previous)) ||
        !count(category.accountCount) ||
        category.accountCount < 1 ||
        !count(category.missingPreviousCount) ||
        category.missingPreviousCount > category.accountCount ||
        !count(category.lowConfidenceCount) ||
        category.lowConfidenceCount > category.accountCount ||
        category.missingPreviousCount > 0 !== (category.previous === null)
      )
        throw new InsightsError("INVALID_REPORT", 422);
      seen.add(category.category);
    }
  }
  return input as unknown as NormalizedReport;
}
