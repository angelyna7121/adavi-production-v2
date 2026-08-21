import type { Kind, ParsedRow } from "./documentParser";
import { calculateStatementTotals, reconcileCategory, type FinancialRow } from "./reconciliation";

export const CSV_HEADERS = ["Investor", "Asset or Liability", "Category", "Holder / Entity / Institution", "Account Name / Type", "Description", "Current Value", "Previous Value", "Source File"] as const;
export function assignInvestor(rows: ParsedRow[], investorId: string, investor: string) { const name=investor.trim();if(!name)throw new Error("An investor name is required before assigning statement rows.");return rows.map((row)=>({...row,investorId,investor:name})); }
export function reassignInvestor(row: ParsedRow, investorId: string, investor: string) { const name=investor.trim();if(!name)throw new Error("Included rows must have an investor name.");return {...row,investorId,investor:name}; }
export function hasUnnamedIncludedRows(rows: ParsedRow[]) { return rows.some((row)=>row.include&&!row.investor.trim()); }
export function isSummaryRow(row: ParsedRow) { return /^\s*(?:grand\s+total|sub\s*total|subtotal|total)(?:\s|:|-|$)/i.test(row.description); }
/** The public report model contains confirmed numeric leaf accounts only; source totals are never public rows. */
export function confirmedDetailRows(rows: ParsedRow[]) { return rows.filter((row)=>row.include&&row.current!==""&&!isSummaryRow(row)); }
export function calculateReconciliation(rows: ParsedRow[]) {
  const totals=calculatePeriodTotals(rows,"current");return {calculated:totals.netWorth,source:totals.source,difference:totals.source===null?null:totals.netWorth-totals.source,matches:totals.source===null?null:Math.abs(totals.netWorth-totals.source)<=1};
}
export function calculatePeriodTotals(rows:ParsedRow[],period:"current"|"previous"){
  const leaves=confirmedDetailRows(rows);const financial=(row:ParsedRow,index:number):FinancialRow=>({description:row.description,category:row.category,type:row.kind==="Asset"?"asset":"liability",current:row.kind==="Liability"?Math.abs(Number(row.current)):Number(row.current),previous:row.previous===null?null:row.kind==="Liability"?Math.abs(row.previous):row.previous,isSummary:false,sourceOrder:index});const categories=(kind:Kind)=>[...new Set(leaves.filter((row)=>row.kind===kind).map((row)=>row.category))].map((category)=>{const categoryRows=leaves.filter((row)=>row.kind===kind&&row.category===category);const controlKey=period==="current"?"sourceCategoryControlCurrent":"sourceCategoryControlPrevious";const controlValue=categoryRows.find((row)=>row[controlKey]!==null&&row[controlKey]!==undefined)?.[controlKey]??null;const control=kind==="Liability"&&controlValue!==null?Math.abs(controlValue):controlValue;return reconcileCategory(category,categoryRows.map(financial),control,period);});const categoryTotals=calculateStatementTotals(categories("Asset"),categories("Liability"));const leafAssets=leaves.filter((row)=>row.kind==="Asset").reduce((sum,row)=>sum+(period==="current"?Number(row.current):(row.previous??0)),0);const key=period==="current"?"sourceCurrentNetWorth":"sourcePreviousNetWorth";const source=leaves.find((row)=>row[key]!==null&&row[key]!==undefined)?.[key]??null;const useSource=source!==null&&Math.abs(categoryTotals.netWorth-source)<=1;const netWorth=useSource?source:categoryTotals.netWorth;return {assets:useSource?netWorth+categoryTotals.liabilities:categoryTotals.assets,liabilities:categoryTotals.liabilities,netWorth,leafAssets,leafNetWorth:categoryTotals.netWorth,source,difference:source===null?null:categoryTotals.netWorth-source,reconciledToSource:useSource,categories:[...categories("Asset"),...categories("Liability")]};
}
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
  return [...totals]
    .map(([category, total]) => ({ category, total, percentage: totalAssets ? total / totalAssets * 100 : 0 }))
    .sort((left, right) => right.total - left.total || left.category.localeCompare(right.category));
}
export type ReportGroup = { investor:string; sections:Array<{kind:Kind;categories:Array<{category:string;total:number;previousTotal:number;holders:Array<{holder:string;total:number;previousTotal:number;rows:ParsedRow[]}>}>}> };
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
          const financialRows=categoryRows.map((row,index)=>({description:row.description,category:row.category,type:row.kind==="Asset"?"asset" as const:"liability" as const,current:row.kind==="Liability"?Math.abs(Number(row.current)):Number(row.current),previous:row.previous===null?null:row.kind==="Liability"?Math.abs(row.previous):row.previous,isSummary:false,sourceOrder:index}));
          const currentControl=categoryRows.find((row)=>row.sourceCategoryControlCurrent!==null&&row.sourceCategoryControlCurrent!==undefined)?.sourceCategoryControlCurrent??null;
          const previousControl=categoryRows.find((row)=>row.sourceCategoryControlPrevious!==null&&row.sourceCategoryControlPrevious!==undefined)?.sourceCategoryControlPrevious??null;
          return {
            category,
            total: reconcileCategory(category,financialRows,currentControl,"current").reportedTotal,
            previousTotal: reconcileCategory(category,financialRows,previousControl,"previous").reportedTotal,
            holders: [...new Set(categoryRows.map((row) => row.holder || "No holder specified"))].map((holder) => {
              const holderRows = categoryRows.filter((row) => (row.holder || "No holder specified") === holder);
              return { holder, total: holderRows.reduce((sum, row) => sum + (row.kind === "Liability" ? Math.abs(Number(row.current)) : Number(row.current)), 0), previousTotal: holderRows.reduce((sum, row) => sum + (row.kind === "Liability" ? Math.abs(row.previous ?? 0) : (row.previous ?? 0)), 0), rows: holderRows };
            }),
          };
        }),
      };
    }),
  }));
}
export type PrintScheduleRow = { key:string; level:"investor"|"section"|"category"|"holder"|"account"|"total"; label:string; current?:number|null; previous?:number|null };
/** Builds deterministic printable pages from any confirmed report hierarchy. */
export function paginateReportSchedule(groups:ReportGroup[],capacity=28):PrintScheduleRow[][] {
  const pages:PrintScheduleRow[][]=[];let page:PrintScheduleRow[]=[];let sequence=0;
  const startPage=()=>{if(page.length)pages.push(page);page=[];};
  const add=(row:Omit<PrintScheduleRow,"key">,keepWith=0)=>{if(page.length&&page.length+1+keepWith>capacity)startPage();page.push({...row,key:`print-row-${sequence++}`});};
  for(const investor of groups)for(const section of investor.sections)for(const category of section.categories){
    if(!category.holders.some((holder)=>holder.rows.length))continue;
    if(page.length&&page.length+5>capacity)startPage();
    add({level:"investor",label:investor.investor},2);add({level:"section",label:section.kind==="Asset"?"Assets":"Liabilities"},1);add({level:"category",label:category.category},1);
    for(const [holderIndex,holder] of category.holders.entries()){
      if(page.length+2>capacity){startPage();add({level:"investor",label:investor.investor},3);add({level:"section",label:section.kind==="Asset"?"Assets":"Liabilities"},2);add({level:"category",label:`${category.category} (continued)`},1);}
      add({level:"holder",label:holder.holder,current:holder.total,previous:holder.previousTotal},1);
      for(const [accountIndex,account] of holder.rows.entries()){
        const isFinalAccount=holderIndex===category.holders.length-1&&accountIndex===holder.rows.length-1;
        if(page.length+1+(isFinalAccount?1:0)>capacity){startPage();add({level:"investor",label:investor.investor},3);add({level:"section",label:section.kind==="Asset"?"Assets":"Liabilities"},2);add({level:"category",label:`${category.category} (continued)`},1);add({level:"holder",label:`${holder.holder} (continued)`,current:holder.total,previous:holder.previousTotal},1);}
        add({level:"account",label:account.description,current:Number(account.current),previous:account.previous});
      }
    }
    add({level:"total",label:`Total ${category.category}`,current:category.total,previous:category.previousTotal});
  }
  startPage();return pages;
}
function csvCell(value:string|number){return `"${String(value).replaceAll('"','""')}"`;}
export function createReportCsv(rows:ParsedRow[]){const lines=[CSV_HEADERS.map(csvCell).join(",")];for(const row of confirmedDetailRows(rows).filter((r)=>r.investor.trim()))lines.push([row.investor,row.kind,row.category,row.holder,row.accountName,row.description,row.current,row.previous??"N/A",row.source].map(csvCell).join(","));return `\uFEFF${lines.join("\r\n")}\r\n`;}
