import type { ParsedRow } from "./documentParser";

export type ReportRow = ParsedRow & {
  effectiveOwnership: number;
  shareCurrent: number;
  sharePrevious: number | null;
  normalizedCategory: string;
};

export type ReportModel = {
  rows: ReportRow[];
  investorTitle: string;
  currentLabel: string;
  previousLabel: string;
  currentAssets: number;
  previousAssets: number;
  currentLiabilities: number;
  previousLiabilities: number;
  currentNetWorth: number;
  previousNetWorth: number;
};

const categoryRules: Array<[RegExp, string]> = [
  [/real estate|property|residence/i, "Real Estate"],
  [/registered|investment|portfolio|brokerage|rrsp|tfsa|rrif|lira|lif|resp/i, "Investments"],
  [/mortgage/i, "Mortgages"],
  [/cash|bank|chequ|saving|deposit/i, "Cash"],
  [/shareholder/i, "Shareholder Loans"],
  [/tax/i, "Taxes Payable"],
  [/credit|overdraft|line of credit|bank liabil/i, "Credit or Bank Liabilities"],
  [/loan/i, "Loans"],
];

export function roundCurrency(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }

export function normalizeCategory(row: ParsedRow) {
  const source = `${row.category} ${row.description}`;
  const match = categoryRules.find(([rule]) => rule.test(source))?.[1];
  if (match === "Mortgages") return row.kind === "Asset" ? "Mortgage Receivables" : "Mortgages Payable";
  if (match === "Loans") return row.kind === "Asset" ? "Loans Receivable" : "Loans Payable";
  return match || row.category.trim() || `Other ${row.kind === "Asset" ? "Assets" : "Liabilities"}`;
}

export function periodLabels(statementDate: string) {
  const current = new Date(`${statementDate}T12:00:00Z`);
  const previous = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1, 12));
  const formatter = new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });
  return { currentLabel: formatter.format(current), previousLabel: formatter.format(previous) };
}

export function buildReportModel(rows: ParsedRow[], selectedInvestorIds: ReadonlySet<string>, statementDate: string, statementOwnership = 100): ReportModel {
  const seen = new Set<string>();
  const selected = rows.filter((row) => {
    if (!selectedInvestorIds.has(row.investorId) || !row.include || row.current === "" || !row.description.trim()) return false;
    const description = row.description.trim().toLowerCase();
    if (/^(total|subtotal|net worth|assets|liabilities|current|previous|date|currency|income|net income|equity)\b/.test(description)) return false;
    const fingerprint = `${row.investorId}|${row.kind}|${row.category}|${description}|${row.current}|${row.previous}`;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  }).map((row): ReportRow => {
    const effectiveOwnership = row.ownership ?? statementOwnership ?? 100;
    return {
      ...row,
      effectiveOwnership,
      normalizedCategory: normalizeCategory(row),
      shareCurrent: roundCurrency(Number(row.current) * effectiveOwnership / 100),
      sharePrevious: row.previous === null ? null : roundCurrency(row.previous * effectiveOwnership / 100),
    };
  });
  const sum = (kind: "Asset" | "Liability", field: "shareCurrent" | "sharePrevious") => selected
    .filter((row) => row.kind === kind)
    .reduce((total, row) => total + Math.abs(row[field] ?? 0), 0);
  const currentAssets = sum("Asset", "shareCurrent");
  const previousAssets = sum("Asset", "sharePrevious");
  const currentLiabilities = sum("Liability", "shareCurrent");
  const previousLiabilities = sum("Liability", "sharePrevious");
  const names = [...new Map(selected.map((row) => [row.investorId, row.investor.trim()])).values()];
  return {
    rows: selected,
    investorTitle: names.map((name) => name.toUpperCase()).join(" & "),
    ...periodLabels(statementDate),
    currentAssets, previousAssets, currentLiabilities, previousLiabilities,
    currentNetWorth: currentAssets - currentLiabilities,
    previousNetWorth: previousAssets - previousLiabilities,
  };
}
