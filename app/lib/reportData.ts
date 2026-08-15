import type { Kind, ParsedRow } from "./documentParser";

export const CSV_HEADERS = ["Investor", "Asset or Liability", "Category", "Holder / Entity / Institution", "Account Name / Type", "Description", "Current Value", "Previous Value", "Source File"] as const;
export function assignInvestor(rows: ParsedRow[], investorId: string, investor: string) { const name=investor.trim();if(!name)throw new Error("An investor name is required before assigning statement rows.");return rows.map((row)=>({...row,investorId,investor:name})); }
export function reassignInvestor(row: ParsedRow, investorId: string, investor: string) { const name=investor.trim();if(!name)throw new Error("Included rows must have an investor name.");return {...row,investorId,investor:name}; }
export function hasUnnamedIncludedRows(rows: ParsedRow[]) { return rows.some((row)=>row.include&&!row.investor.trim()); }
export function isSummaryRow(row: ParsedRow) { return /^\s*(?:grand\s+total|sub\s*total|subtotal|total)(?:\s|:|-|$)/i.test(row.description); }
/** The public report model contains confirmed numeric leaf accounts only; source totals are never public rows. */
export function confirmedDetailRows(rows: ParsedRow[]) { return rows.filter((row)=>row.include&&row.current!==""&&!isSummaryRow(row)); }
export type AssetMixEntry = { category: string; total: number; percentage: number };
export function normalizeCategory(category: string) {
  const normalized = category.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^mortgage (?:investment|investments|receivable|receivables)(?:\s*\/\s*mortgage (?:investment|investments|receivable|receivables))?$/.test(normalized)) return "Mortgage Investments / Mortgage Receivables";
  return category.trim();
}
export function calculateAssetMix(rows: ParsedRow[]): AssetMixEntry[] {
  const totals = new Map<string, number>();
  for (const row of confirmedDetailRows(rows).filter((item) => item.kind === "Asset")) {
    const category = normalizeCategory(row.category);
    totals.set(category, (totals.get(category) ?? 0) + Number(row.current));
  }
  const totalAssets = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return [...totals].map(([category, total]) => ({ category, total, percentage: totalAssets ? total / totalAssets * 100 : 0 }));
}
export type ReportGroup = { investor:string; sections:Array<{kind:Kind;categories:Array<{category:string;total:number;holders:Array<{holder:string;total:number;rows:ParsedRow[]}>}>}> };
export function groupReportRows(rows: ParsedRow[]): ReportGroup[] {
  const leaves = confirmedDetailRows(rows);
  return [...new Set(leaves.map((row) => row.investor))].map((investor) => ({
    investor,
    sections: (["Asset", "Liability"] as Kind[]).map((kind) => {
      const sectionRows = leaves.filter((row) => row.investor === investor && row.kind === kind);
      return {
        kind,
        categories: [...new Set(sectionRows.map((row) => row.category))].map((category) => {
          const categoryRows = sectionRows.filter((row) => row.category === category);
          return {
            category,
            total: categoryRows.reduce((sum, row) => sum + Number(row.current), 0),
            holders: [...new Set(categoryRows.map((row) => row.holder || "No holder specified"))].map((holder) => {
              const holderRows = categoryRows.filter((row) => (row.holder || "No holder specified") === holder);
              return { holder, total: holderRows.reduce((sum, row) => sum + Number(row.current), 0), rows: holderRows };
            }),
          };
        }),
      };
    }),
  }));
}
function csvCell(value:string|number){return `"${String(value).replaceAll('"','""')}"`;}
export function createReportCsv(rows:ParsedRow[]){const lines=[CSV_HEADERS.map(csvCell).join(",")];for(const row of confirmedDetailRows(rows).filter((r)=>r.investor.trim()))lines.push([row.investor,row.kind,row.category,row.holder,row.accountName,row.description,row.current,row.previous??"N/A",row.source].map(csvCell).join(","));return `\uFEFF${lines.join("\r\n")}\r\n`;}
