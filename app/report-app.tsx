"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { parseDocument, type Kind, type Category, type ParsedRow as Row } from "./lib/documentParser";
import { formatPeriodAmount } from "./lib/ocrFinancialParser";
import { assignInvestor, calculateAssetMix, calculatePeriodTotals, calculateReconciliation, confirmedDetailRows, createReportCsv, filterPrintableSchedulePages, groupReportRows, hasUnnamedIncludedRows, paginateReportSchedule, type ReportGroup } from "./lib/reportData";

type Step = "upload" | "review" | "report";
type Investor = { id: string; name: string; files: string[] };

const sampleRows: Row[] = [
  { id: "1", include: true, investorId: "sample-a", investor: "Alex Morgan", category: "Cash & Bank Accounts", holder: "Sample Bank", accountName: "Chequing", institution: "Sample Bank", description: "CAD Chequing", current: 42500, previous: null, kind: "Asset", source: "alex-bank.csv" },
  { id: "2", include: true, investorId: "sample-a", investor: "Alex Morgan", category: "Investments", holder: "Sample Brokerage", accountName: "Non-registered Portfolio", institution: "Sample Brokerage", description: "Non-registered Portfolio", current: 215000, previous: 202000, kind: "Asset", source: "alex-portfolio.csv" },
  { id: "3", include: true, investorId: "sample-b", investor: "Jordan Morgan", category: "Real Estate", holder: "Principal Residence", accountName: "Property", institution: "Principal Residence", description: "Estimated Fair Market Value", current: 780000, previous: 750000, kind: "Asset", source: "jordan-property.csv" },
  { id: "4", include: true, investorId: "sample-b", investor: "Jordan Morgan", category: "Mortgages Payable", holder: "Sample Lender", accountName: "Residential Mortgage", institution: "Sample Lender", description: "Residential Mortgage", current: 325000, previous: null, kind: "Liability", source: "jordan-mortgage.csv" },
];

const assetCategories: Category[] = ["Real Estate", "Investments", "Loans Receivable", "Mortgage Investments / Mortgage Receivables", "Corporate Tax Instalment Receivable", "Cash & Bank Accounts", "Other Receivables", "Vehicles", "Insurance Cash Value", "Inherited Assets", "Other Assets"];
const liabilityCategories: Category[] = ["Corporate Tax Payable", "Loans Payable", "Shareholder Advances", "Mortgages Payable", "Taxes Owing", "Accounts Payable", "Credit Cards", "Other Liabilities"];

function money(value: number | null | "") { return formatPeriodAmount(value === "" || value === null ? 0 : value); }

export default function ReportApp({ hasVerifiedPaidEntitlement }: { hasVerifiedPaidEntitlement: boolean }) {
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<Row[]>([]);
  const [groupName, setGroupName] = useState("The Sample Family");
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState("CAD");
  const [investorList, setInvestorList] = useState<Investor[]>([{ id: crypto.randomUUID(), name: "", files: [] }]);
  const [activeInvestorId, setActiveInvestorId] = useState(() => investorList[0].id);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState("");
  const [dragging, setDragging] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const included = useMemo(() => confirmedDetailRows(rows), [rows]);
  const hasInvalidIncludedRows = rows.some((row) => row.include && (!row.description.trim() || row.current === "")) || hasUnnamedIncludedRows(rows);
  const files = investorList.flatMap((investor) => investor.files);
  const activeInvestor = investorList.find((investor) => investor.id === activeInvestorId);
  const currentTotals = useMemo(() => calculatePeriodTotals(rows, "current"), [rows]);
  const priorTotals = useMemo(() => calculatePeriodTotals(rows, "previous"), [rows]);
  const { assets, liabilities, netWorth } = currentTotals;
  const { assets: previousAssets, liabilities: previousLiabilities, netWorth: previousNetWorth } = priorTotals;
  const hasPrevious = included.some((row) => row.previous !== null);
  const netWorthChange = netWorth - previousNetWorth;
  const currentPeriodLabel = new Date(`${statementDate}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
  const statement = new Date(`${statementDate}T00:00:00Z`);
  const previousPeriodLabel = new Date(Date.UTC(statement.getUTCFullYear(), statement.getUTCMonth(), 0)).toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  const reportGroups = useMemo(() => groupReportRows(rows), [rows]);
  const assetMix = useMemo(() => calculateAssetMix(rows), [rows]);
  const reconciliation = useMemo(() => calculateReconciliation(rows), [rows]);

  async function acceptFiles(list: FileList | File[]) {
    const selected = Array.from(list);
    const investorName = activeInvestor?.name.trim() ?? "";
    if (!selected.length) return;
    if (!investorName) { setError("Enter an investor name before uploading statements."); return; }
    const parsed: Row[] = [];
    const errors: string[] = [];
    setError("");
    setProcessing("Preparing statements…");
    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index];
      try {
        setProcessing(`Processing ${file.name} (${index + 1} of ${selected.length})…`);
        const extracted = await parseDocument(file, setProcessing);
        parsed.push(...assignInvestor(extracted, activeInvestorId, investorName));
      } catch (reason) {
        errors.push(reason instanceof Error ? reason.message : `Could not process ${file.name}.`);
      }
    }
    setProcessing("");
    if (!parsed.length) {
      setError(["We could not extract financial balances from this document. Please review the file or enter the values manually.", ...errors].join(" "));
      return;
    }
    setError(errors.length ? `Some files could not be read: ${errors.join(" ")}` : "");
    setRows((current) => [...current, ...parsed]);
    const extractedStatementDate = parsed.find((row) => row.sourceCurrentDate)?.sourceCurrentDate;
    if (extractedStatementDate) setStatementDate(extractedStatementDate);
    setInvestorList((current) => current.map((investor) => investor.id === activeInvestorId ? { ...investor, files: [...investor.files, ...selected.map((file) => file.name)] } : investor));
  }

  function loadSample() {
    setRows(sampleRows);
    setInvestorList([{ id: "sample-a", name: "Alex Morgan", files: ["alex-bank.csv", "alex-portfolio.csv"] }, { id: "sample-b", name: "Jordan Morgan", files: ["jordan-property.csv", "jordan-mortgage.csv"] }]);
    setActiveInvestorId("sample-a");
    setError("");
    setStep("review");
  }

  function addRow() {
    const investor = investorList.find((item) => item.name.trim());
    setRows((current) => [...current, { id: crypto.randomUUID(), include: true, investor: investor?.name.trim() ?? "", investorId: investor?.id, category: "Other Assets", holder: "", accountName: "", institution: "", description: "", current: "", previous: null, kind: "Asset", source: "Manual entry" }]);
  }

  function update(id: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function renameInvestor(id: string, name: string) {
    setInvestorList((current) => current.map((investor) => investor.id === id ? { ...investor, name } : investor));
    setRows((current) => current.map((row) => row.investorId === id ? { ...row, investor: name } : row));
  }

  function addInvestor() {
    const investor = { id: crypto.randomUUID(), name: "", files: [] };
    setInvestorList((current) => [...current, investor]);
    setActiveInvestorId(investor.id);
  }

  function downloadCsv() {
    if (!hasVerifiedPaidEntitlement) { setShowUpgrade(true); return; }
    const blob = new Blob([createReportCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `adavi-net-worth-${statementDate}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#"><span className="brandMark">ϟ</span><span>adavi.ai</span></a>
        <nav><a href="#">Dashboard</a><a className="active" href="#">Net Worth</a><a href="#">Income Strategy</a><a href="#">Reports</a></nav>
        <button className="upgrade">♕&nbsp;&nbsp; Upgrade</button>
      </header>

      <div className="shell">
        <section className="hero">
          <span className="eyebrow">Statement of Net Worth</span>
          <h1>Create a Professional Net Worth Statement</h1>
          <p>Upload statements, review extracted balances, and generate a clear consolidated report.</p>
        </section>

        <div className="stepper" aria-label="Progress">
          {(["upload", "review", "report"] as Step[]).map((name, i) => (
            <button key={name} className={`${step === name ? "current" : ""} ${(["upload", "review", "report"] as Step[]).indexOf(step) > i ? "done" : ""}`} onClick={() => (name === "upload" || rows.length) && setStep(name)}>
              <span>{i + 1}</span>{name === "upload" ? "Upload" : name === "review" ? "Review & Reconcile" : "Net Worth Report"}
            </button>
          ))}
        </div>

        {step === "upload" && (
          <section className="workspace uploadGrid">
            <div className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); acceptFiles(e.dataTransfer.files); }}>
              <div className="investorList">
                {investorList.map((investor) => <div className={`investorCard ${investor.id === activeInvestorId ? "selected" : ""}`} key={investor.id} onClick={() => setActiveInvestorId(investor.id)}>
                  <label>Investor name<input aria-label="Investor name" value={investor.name} placeholder="Required before upload" onClick={(event) => event.stopPropagation()} onChange={(event) => renameInvestor(investor.id, event.target.value)} /></label>
                  <small>{investor.files.length ? investor.files.join(", ") : "No statements assigned yet"}</small>
                </div>)}
              </div>
              <button className="secondary addInvestor" onClick={addInvestor}>＋ Add another investor</button>
              <div className="uploadIcon">⇧</div>
              <h2>Upload {activeInvestor?.name.trim() ? `${activeInvestor.name.trim()}’s` : "this investor’s"} statements</h2>
              <p>PDF, JPG, PNG, CSV, XLSX, OCR scans and Adobe-exported statements up to 10 MB each.</p>
              <div className="buttonRow"><button className="primary" disabled={Boolean(processing) || !activeInvestor?.name.trim()} onClick={() => fileRef.current?.click()}>{processing || "Browse files"}</button><button className="secondary" disabled={Boolean(processing)} onClick={loadSample}>Use sample statements</button>{rows.length > 0 && <button className="primary" disabled={investorList.some((investor) => investor.files.length > 0 && !investor.name.trim())} onClick={() => setStep("review")}>Review & Reconcile →</button>}</div>
              <input ref={fileRef} hidden type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx,.xls" onChange={(e) => { const snapshot = e.target.files ? Array.from(e.target.files) : []; e.currentTarget.value = ""; if (snapshot.length) acceptFiles(snapshot); }} />
              {error && <div className="errorToast"><strong>We couldn’t process this statement</strong><span>{error}</span></div>}
            </div>
            <aside className="setupCard">
              <h2>Report setup</h2>
              <label>Family or group name<input value={groupName} onChange={(e) => setGroupName(e.target.value)} /></label>
              <label>Statement date<input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} /></label>
              <label>Currency<input value={currency} maxLength={3} aria-label="Report currency" onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label>
              <div className="privacy"><span>◆</span><div><strong>Private by design</strong><p>Statements are parsed locally in your browser. Nothing is uploaded or stored.</p></div></div>
            </aside>
          </section>
        )}

        {step === "review" && (
          <section className="workspace reviewSpace">
            <div className="sectionHead"><div><span className="eyebrow">Step 2</span><h2>Review & Reconcile Extracted Line Items</h2><p>Edit values, choose what to include, and confirm before generating the statement.</p></div><button className="secondary" onClick={addRow}>＋ Add Row</button></div>
            <div className="metricGrid">
              <Metric label="Files processed" value={String(files.length)} />
              <Metric label="Extracted rows" value={String(rows.length)} />
              <Metric label="Reconciled assets" value={money(assets)} />
              <Metric label="Reconciled liabilities" value={money(liabilities)} />
              <Metric label="Net worth" value={money(netWorth)} accent />
            </div>
            {rows.some((row) => row.needsReview) && <div className="reconciliationWarning" role="status">Some OCR values had low confidence and are highlighted for review. Confirm them against the statement before generating the report.</div>}
            {currentTotals.categories.some((category) => category.status === "minor-source-difference") && <div className="reconciliationWarning" role="status">The statement contains a $1 difference between displayed leaf accounts and a printed category subtotal. The printed subtotal is used once as the reconciliation control; no adjustment account was invented.</div>}
            {reconciliation.matches === false && <div className="reconciliationWarning" role="alert">Calculated net worth differs from the statement’s TOTAL NET WORTH by {money(Math.abs(reconciliation.difference!))}. Review the highlighted extraction values.</div>}
            <div className="tableWrap" tabIndex={0} aria-label="Review extracted financial rows">
              <table className="reviewTable"><thead><tr><th>Include</th><th>Investor</th><th>Category</th><th>Holder / Institution</th><th>Account / Description</th><th>Current</th><th>Previous</th><th>Asset / Liability</th><th>Source</th><th></th></tr></thead>
                <tbody>{rows.map((row) => <tr key={row.id} className={row.needsReview ? "needsReview" : ""}>
                  <td><input type="checkbox" checked={row.include} onChange={(e) => update(row.id, { include: e.target.checked })} /></td>
                  <td><select aria-label="Assigned investor" value={row.investor} className={!row.investor.trim() ? "invalid" : ""} onChange={(e) => { const selected = investorList.find((investor) => investor.name === e.target.value); update(row.id, { investor: e.target.value, investorId: selected?.id }); }}><option value="">Select investor</option>{investorList.filter((item) => item.name.trim()).map((item) => <option key={item.id} value={item.name.trim()}>{item.name.trim()}</option>)}</select></td>
                  <td><select value={row.category} onChange={(e) => update(row.id, { category: e.target.value as Category })}>{(row.kind === "Asset" ? assetCategories : liabilityCategories).map((c) => <option key={c}>{c}</option>)}</select></td>
                  <td><input value={row.holder} placeholder="Holder / institution" onChange={(e) => update(row.id, { holder: e.target.value, institution: e.target.value })} /></td>
                  <td><input required aria-label="Account description" aria-invalid={!row.description.trim()} className={!row.description.trim() ? "invalid" : ""} value={row.description} placeholder="Description required" onChange={(e) => update(row.id, { description: e.target.value })} /></td>
                  <td><input required aria-invalid={row.current === ""} type="number" className={row.current === "" ? "invalid" : ""} value={row.current} onChange={(e) => update(row.id, { current: e.target.value === "" ? "" : Number(e.target.value) })} /></td>
                  <td><input type="number" value={row.previous ?? ""} placeholder="$0" onChange={(e) => update(row.id, { previous: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                  <td><select value={row.kind} onChange={(e) => update(row.id, { kind: e.target.value as Kind })}><option>Asset</option><option>Liability</option></select></td>
                  <td className="sourceCell">{row.source}</td>
                  <td><button className="delete" aria-label="Delete row" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>×</button></td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="reviewActions"><button className="secondary" onClick={() => setStep("upload")}>← Back</button><button className="primary" disabled={!included.length || hasInvalidIncludedRows} onClick={() => setStep("report")}>✓ Confirm & Generate Statement</button></div>
          </section>
        )}

        {step === "report" && (
          <section className="reportArea">
            <div className="reportReady"><div><span className="eyebrow">Report ready</span><h2>Your consolidated statement is complete</h2><p>{groupName} · {new Date(`${statementDate}T00:00:00`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}</p></div><div className="buttonRow"><button className="secondary" onClick={() => setStep("review")}>Edit data</button><button className="secondary" onClick={() => window.print()}>Print</button><button className="primary" onClick={downloadCsv}>Download data</button>{hasVerifiedPaidEntitlement ? <button className="secondary" onClick={() => window.print()}>Remove adavi.ai branding</button> : <button className="secondary" onClick={() => setShowUpgrade(true)}>Upgrade for CSV & unbranded reports</button>}</div></div>
            <article className={`paper screenReport ${hasVerifiedPaidEntitlement ? "paidReport" : "freeReport"}`}>
              {!hasVerifiedPaidEntitlement && <><div className="printWatermark" aria-hidden="true">adavi.ai</div><div className="printBranding">Prepared by adavi.ai</div></>}
              <div className="paperHead"><div>{!hasVerifiedPaidEntitlement && <div className="paperBrand"><span className="brandMark">ϟ</span> adavi.ai</div>}<h1>Consolidated Net Worth Report</h1><p>{groupName}</p></div><div className="dateBlock"><span>Statement date</span><strong>{statementDate}</strong><span>Currency</span><strong>{currency}</strong></div></div>
              <div className="summaryCards"><Summary label="Total Assets" current={money(assets)} previous={money(previousAssets)} currentLabel={currentPeriodLabel} previousLabel={previousPeriodLabel} tone="assets" /><Summary label="Total Liabilities" current={money(liabilities)} previous={money(previousLiabilities)} currentLabel={currentPeriodLabel} previousLabel={previousPeriodLabel} tone="liabilities" /><Summary label="Net Worth" current={money(netWorth)} previous={money(previousNetWorth)} currentLabel={currentPeriodLabel} previousLabel={previousPeriodLabel} change={money(netWorthChange)} tone="networth" /></div>
              <h3>Consolidated Schedule</h3>
              <div className="detailedStatement">{reportGroups.map((investor) => <section className="investorGroup" key={investor.investor}><h4>{investor.investor}</h4>{investor.sections.map((section) => <section className="statementSection" key={section.kind}><h5>{section.kind === "Asset" ? "Assets" : "Liabilities"}</h5>{section.categories.map((category) => <CategoryTable category={category} key={category.category} />)}</section>)}</section>)}</div>
              <table className="reportTable consolidatedTotal"><tfoot><tr><td>Consolidated Net Worth</td><td>{money(netWorth)}</td><td>{money(hasPrevious ? previousNetWorth : 0)}</td><td>{money(hasPrevious ? netWorth - previousNetWorth : 0)}</td></tr></tfoot></table>
              <div className="reportBottom"><div><h3>Asset Mix</h3>{assetMix.map((entry) => <div className="mix" key={entry.category}><span>{entry.category}</span><em>{money(entry.total)}</em><div><i style={{ width: `${entry.percentage ? Math.max(4, entry.percentage) : 0}%` }} /></div><strong>{entry.percentage.toFixed(1)}%</strong></div>)}</div><div className="disclaimer"><strong>About this report</strong><p>This report consolidates the information reviewed and confirmed by the user. A missing comparative balance is displayed as $0 and is never copied from another period.</p></div></div>
              {!hasVerifiedPaidEntitlement && <footer className="paperFooter"><span>Prepared by adavi.ai</span><span>Educational estimates only · Not tax, legal, accounting, or investment advice</span></footer>}
            </article>
            <PrintReport groupName={groupName} statementDate={statementDate} currency={currency} currentLabel={currentPeriodLabel} previousLabel={previousPeriodLabel} assets={assets} previousAssets={previousAssets} liabilities={liabilities} previousLiabilities={previousLiabilities} netWorth={netWorth} previousNetWorth={previousNetWorth} netWorthChange={netWorthChange} groups={reportGroups} assetMix={assetMix} paid={hasVerifiedPaidEntitlement} />
          </section>
        )}
      </div>
      {showUpgrade && <div className="upgradeBackdrop" role="presentation" onMouseDown={() => setShowUpgrade(false)}><section className="upgradePanel" role="dialog" aria-modal="true" aria-labelledby="upgrade-title" onMouseDown={(event) => event.stopPropagation()}><button className="dialogClose" aria-label="Close upgrade options" onClick={() => setShowUpgrade(false)}>×</button><span className="eyebrow">Subscriber benefit</span><h2 id="upgrade-title">Upgrade for data downloads and unbranded reports</h2><p>Printing the complete branded report is always free. A verified subscription adds CSV downloads and removes report branding.</p><div className="priceGrid"><div><strong>CAD $9.99</strong><span>per month</span></div><div><strong>CAD $99.99</strong><span>per year</span></div></div><ul><li>Download report data as CSV</li><li>Print or save PDF without adavi.ai branding</li><li>Existing paid download features</li></ul><div className="lockedNotice"><strong>Secure checkout is not available yet</strong><p>This build has no authenticated Stripe Checkout, verified webhook, or server-side subscription status. Paid actions remain locked; no browser setting can enable them.</p></div></section></div>}
    </main>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className={`metric ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong></div>; }
function Summary({ label, current, previous, currentLabel, previousLabel, tone, change }: { label: string; current: string; previous: string; currentLabel: string; previousLabel: string; tone: string; change?: string }) { return <div className={`summary ${tone}`}><h3>{label}</h3><div className="summaryPeriod"><span>Current · {currentLabel}</span><strong>{current}</strong></div><div className="summaryPeriod"><span>Previous · {previousLabel}</span><strong>{previous}</strong></div>{change && <div className="summaryChange"><span>Change in net worth</span><strong>{change}</strong></div>}</div>; }

type ReportCategory = ReportGroup["sections"][number]["categories"][number];
type ReportHolder = ReportCategory["holders"][number];

function CategoryTable({ category }: { category: ReportCategory }) {
  const [expanded, setExpanded] = useState(true);
  return <section className="categoryGroup"><table className="accountTable"><colgroup><col className="descriptionColumn" /><col className="amountColumn" /><col className="amountColumn" /></colgroup><thead><tr className="categoryHeading"><th scope="col"><button type="button" className="categoryToggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{category.category}</button></th><th scope="col" className="amountCell">Current</th><th scope="col" className="amountCell">Previous</th></tr></thead>{category.holders.map((holder) => <HolderRows holder={holder} categoryExpanded={expanded} key={holder.holder} />)}<tfoot className={expanded ? "expanded" : "collapsed"}><tr><th scope="row">Total {category.category}</th><td className="amountCell">{money(category.total)}</td><td className="amountCell">{money(category.previousTotal)}</td></tr></tfoot></table></section>;
}

function HolderRows({ holder, categoryExpanded }: { holder: ReportHolder; categoryExpanded: boolean }) {
  const [expanded, setExpanded] = useState(true);
  return <tbody className={`holderRows ${categoryExpanded ? "expanded" : "collapsed"}`}><tr className="holderHeading"><th scope="row"><button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{holder.holder}</button></th><td className="amountCell">{money(holder.total)}</td><td className="amountCell">{money(holder.previousTotal)}</td></tr>{holder.rows.map((row) => <tr className={`accountRow ${expanded ? "expanded" : "collapsed"}`} key={row.id}><th scope="row">{row.description}</th><td className="amountCell">{money(row.current)}</td><td className="amountCell">{money(row.previous)}</td></tr>)}</tbody>;
}

function PrintLogo(){return <div className="printLogo"><Image src="/adavi-logo.svg" alt="adavi.ai" width={194} height={48} priority /></div>;}
function PrintFooter({page,total,paid}:{page:number;total:number;paid:boolean}){return <footer className="printPageFooter"><span>{paid?"":"Created with adavi.ai"}</span><span>{paid?"":"Educational estimates only"}</span><span>Page {page} of {total}</span></footer>;}
function printDate(value:string){return new Date(`${value}T00:00:00`).toLocaleDateString("en-CA",{month:"long",day:"numeric",year:"numeric"});}
function scheduleSubtitle(rows:ReturnType<typeof paginateReportSchedule>[number]){const names=[...new Set(rows.filter((row)=>row.level==="category").map((row)=>row.label.replace(/ \(continued\)$/,"")))];return names.length?names.join(" and "):"Confirmed account schedule";}
function PrintReport({groupName,statementDate,currency,currentLabel,previousLabel,assets,previousAssets,liabilities,previousLiabilities,netWorth,previousNetWorth,netWorthChange,groups,assetMix,paid}:{groupName:string;statementDate:string;currency:string;currentLabel:string;previousLabel:string;assets:number;previousAssets:number;liabilities:number;previousLiabilities:number;netWorth:number;previousNetWorth:number;netWorthChange:number;groups:ReportGroup[];assetMix:Array<{category:string;total:number;percentage:number}>;paid:boolean}){
  const schedulePages=useMemo(()=>filterPrintableSchedulePages(paginateReportSchedule(groups)),[groups]);const totalPages=schedulePages.length+2;const branding=paid?"paidPrint":"freePrint";
  return <div className={`printReport ${branding}`}>
    <section className="printPage reportPage executivePage">{!paid&&<div className="pageWatermark">adavi.ai</div>}<PrintLogo/><div className="printHero"><p>Statement of Net Worth</p><h1>Consolidated Net Worth Report</h1><h2>{groupName}</h2><div><span>Statement date</span><strong>{printDate(statementDate)}</strong><span>Currency</span><strong>{currency}</strong></div></div><div className="printSummaryCards"><Summary label="Total Assets" current={money(assets)} previous={money(previousAssets)} currentLabel={currentLabel} previousLabel={previousLabel} tone="assets"/><Summary label="Total Liabilities" current={money(liabilities)} previous={money(previousLiabilities)} currentLabel={currentLabel} previousLabel={previousLabel} tone="liabilities"/><Summary label="Net Worth" current={money(netWorth)} previous={money(previousNetWorth)} currentLabel={currentLabel} previousLabel={previousLabel} change={money(netWorthChange)} tone="networth"/></div><div className="reportingBasis"><span>Reporting basis</span><strong>Confirmed account balances, consolidated across the selected investor group</strong></div><PrintFooter page={1} total={totalPages} paid={paid}/></section>
    {schedulePages.map((rows,index)=><section className="printPage reportPage schedulePage" key={`schedule-page-${index}`}>{!paid&&<div className="pageWatermark">adavi.ai</div>}<header className="schedulePageHead"><PrintLogo/><div><h1>Consolidated Report</h1><p>{scheduleSubtitle(rows)}</p><small>{groupName} · {printDate(statementDate)} · {currency}</small></div></header><table className="printSchedule"><colgroup><col/><col className="printAmountColumn"/><col className="printAmountColumn"/></colgroup><thead><tr><th>Account / Description</th><th>Current</th><th>Previous</th></tr></thead><tbody>{rows.map((row)=><tr className={`printRow-${row.level}`} key={row.key}><th scope="row">{row.label}</th><td>{row.current===undefined?"":money(row.current)}</td><td>{row.previous===undefined?"":money(row.previous)}</td></tr>)}</tbody></table><PrintFooter page={index+2} total={totalPages} paid={paid}/></section>)}
    <section className="printPage reportPage assetMixPage">{!paid&&<div className="pageWatermark">adavi.ai</div>}<header className="schedulePageHead"><PrintLogo/><div><h1>Asset Mix</h1><p>Current-period composition of total confirmed assets</p><small>{groupName} · {printDate(statementDate)} · {currency}</small></div></header><div className="printAssetMix">{assetMix.map((entry)=><div className="printMix" key={entry.category}><strong>{entry.category}</strong><div className="printMixTrack"><i style={{width:`${entry.percentage}%`}}/></div><span>{money(entry.total)}</span><em>{entry.percentage.toFixed(1)}%</em></div>)}</div><div className="printTotalAssets"><strong>Total Assets</strong><span>{money(assets)}</span></div><PrintFooter page={totalPages} total={totalPages} paid={paid}/></section>
  </div>;
}
