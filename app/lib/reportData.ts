import type { ParsedRow } from "./documentParser";

export const CSV_HEADERS = ["Investor", "Category", "Institution", "Description", "Current Value", "Previous Value", "Type", "Source"] as const;

export function assignInvestor(rows: ParsedRow[], investorId: string, investor: string) {
  const name = investor.trim();
  if (!name) throw new Error("An investor name is required before assigning statement rows.");
  return rows.map((row) => ({ ...row, investorId, investor: name }));
}

export function reassignInvestor(row: ParsedRow, investorId: string, investor: string) {
  const name = investor.trim();
  if (!name) throw new Error("Included rows must have an investor name.");
  return { ...row, investorId, investor: name };
}

export function hasUnnamedIncludedRows(rows: ParsedRow[]) {
  return rows.some((row) => row.include && !row.investor.trim());
}

export function isSummaryRow(row: ParsedRow) {
  const value = row.description.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return /^(grand total|total|portfolio total|total portfolio|total market value|market value total|total assets?|total liabilities?|net assets?|ending total)(\s|$)/.test(value)
    || /^(assets?|liabilities?|portfolio|market value) total$/.test(value);
}

/** Removes a parsed total only when detail rows in the same investor/file/type prove it is redundant. */
export function confirmedDetailRows(rows: ParsedRow[]) {
  const included = rows.filter((row) => row.include && row.current !== "");
  return included.filter((candidate) => {
    if (!isSummaryRow(candidate)) return true;
    const details = included.filter((row) => row.id !== candidate.id
      && !isSummaryRow(row)
      && row.investor.trim() === candidate.investor.trim()
      && row.source === candidate.source
      && row.kind === candidate.kind);
    if (!details.length) return true;
    const currentMatches = details.reduce((sum, row) => sum + Number(row.current), 0) === Number(candidate.current);
    const comparablePrevious = candidate.previous !== null && details.every((row) => row.previous !== null);
    const previousMatches = comparablePrevious
      && details.reduce((sum, row) => sum + Number(row.previous), 0) === candidate.previous;
    return !(currentMatches || previousMatches);
  });
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function createReportCsv(rows: ParsedRow[]) {
  const lines = [CSV_HEADERS.map(csvCell).join(",")];
  for (const row of confirmedDetailRows(rows).filter((item) => item.investor.trim())) {
    lines.push([
      row.investor.trim(), row.category, row.institution, row.description,
      row.current, row.previous ?? "N/A", row.kind, row.source,
    ].map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
