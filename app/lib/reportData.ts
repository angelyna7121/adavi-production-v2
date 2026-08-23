import type { Kind, ParsedRow } from "./documentParser";
import { calculateStatementTotals, reconcileCategory, type FinancialRow } from "./reconciliation";

export type StatementRecord = { statementId:string; investorId:string; filename:string; ownershipPercentage:number; parseStatus:"processing"|"ready"|"error"; objectUrl?:string };
export const CSV_HEADERS = ["Investor", "Statement", "Ownership Percentage", "Raw Current Value", "Included Current Value", "Raw Previous Value", "Included Previous Value", "Type", "Category", "Institution / Account", "Description"] as const;
export function validateOwnershipPercentage(value:number){if(!Number.isFinite(value)||value<=0||value>100)throw new Error("Ownership percentage must be greater than 0 and no more than 100.");return value;}
export function effectiveOwnershipPercentage(row:ParsedRow){return validateOwnershipPercentage(row.rowOwnershipOverride??row.ownershipPercentage??100);}
export function applyOwnershipToRow(row:ParsedRow,ownershipPercentage:number):ParsedRow {const statementPercentage=validateOwnershipPercentage(ownershipPercentage);const percentage=validateOwnershipPercentage(row.rowOwnershipOverride??statementPercentage);const rawCurrent=row.rawCurrent??row.current;const rawPrevious=row.rawPrevious!==undefined?row.rawPrevious:row.previous;return {...row,ownershipPercentage:statementPercentage,rawCurrent,rawPrevious,current:rawCurrent===""?"":rawCurrent*percentage/100,previous:rawPrevious===null?null:rawPrevious*percentage/100};}
export function setRowOwnershipOverride(row:ParsedRow,ownershipPercentage:number|null):ParsedRow {if(ownershipPercentage!==null)validateOwnershipPercentage(ownershipPercentage);return applyOwnershipToRow({...row,rowOwnershipOverride:ownershipPercentage},row.ownershipPercentage??100);}
export function duplicateFinancialRow(row:ParsedRow,newId:string):ParsedRow {return {...row,id:newId,manuallyCreated:true};}
export function assignStatement(rows:ParsedRow[],statement:StatementRecord){return rows.map((row)=>applyOwnershipToRow({...row,statementId:statement.statementId,source:statement.filename},statement.ownershipPercentage));}
export function setStatementOwnership(rows:ParsedRow[],statementId:string,percentage:number){return rows.map((row)=>row.statementId===statementId?applyOwnershipToRow(row,percentage):row);}
export function removeStatementRows(rows:ParsedRow[],statementId:string){return rows.filter((row)=>row.statementId!==statementId);}
export function removeInvestorRows(rows:ParsedRow[],investorId:string){return rows.filter((row)=>row.investorId!==investorId);}
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
/** Drops header-only artifacts and keeps an orphan subtotal with the preceding account page. */
export function filterPrintableSchedulePages(pages:PrintScheduleRow[][]):PrintScheduleRow[][] {
  const printable:PrintScheduleRow[][]=[];
  for(const page of pages){
    if(page.some((row)=>row.level==="account")){printable.push(page);continue;}
    const subtotals=page.filter((row)=>row.level==="total");
    if(subtotals.length){
      const previous=printable.at(-1);
      if(!previous)throw new Error("A printable subtotal has no related account page.");
      previous.push(...subtotals);
    }
  }
  return printable;
}
/**
 * Builds deterministic printable pages from any confirmed report hierarchy.
 * The conservative default reserves physical A4 space for the repeated report
 * header, table heading, wrapped descriptions, and in-flow footer.
 */
export function paginateReportSchedule(groups:ReportGroup[],capacity=22):PrintScheduleRow[][] {
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
  startPage();return filterPrintableSchedulePages(pages);
}
function csvCell(value:string|number){return `"${String(value).replaceAll('"','""')}"`;}
export function createReportCsv(rows:ParsedRow[]){const lines=[CSV_HEADERS.map(csvCell).join(",")];for(const row of confirmedDetailRows(rows).filter((r)=>r.investor.trim()))lines.push([row.investor,row.source,effectiveOwnershipPercentage(row),row.rawCurrent??row.current,row.current,row.rawPrevious!==undefined?(row.rawPrevious??""):(row.previous??""),row.previous??"",row.kind,row.category,[row.holder,row.accountName].filter(Boolean).join(" — "),row.description].map(csvCell).join(","));return `\uFEFF${lines.join("\r\n")}\r\n`;}
