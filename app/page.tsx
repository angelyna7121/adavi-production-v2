"use client";

import { useMemo, useRef, useState } from "react";
import { parseDocument, type Kind, type Category, type ParsedRow as Row } from "./lib/documentParser";
import { assignInvestor, confirmedDetailRows, createReportCsv, groupReportRows, hasUnnamedIncludedRows } from "./lib/reportData";

type Step = "upload" | "review" | "report";
type Investor = { id: string; name: string; files: string[] };

const sampleRows: Row[] = [
  { id: "1", include: true, investorId: "sample-a", investor: "Alex Morgan", category: "Cash & Bank Accounts", holder: "Sample Bank", accountName: "Chequing", institution: "Sample Bank", description: "CAD Chequing", current: 42500, previous: null, kind: "Asset", source: "alex-bank.csv" },
  { id: "2", include: true, investorId: "sample-a", investor: "Alex Morgan", category: "Investments", holder: "Sample Brokerage", accountName: "Non-registered Portfolio", institution: "Sample Brokerage", description: "Non-registered Portfolio", current: 215000, previous: 202000, kind: "Asset", source: "alex-portfolio.csv" },
  { id: "3", include: true, investorId: "sample-b", investor: "Jordan Morgan", category: "Real Estate", holder: "Principal Residence", accountName: "Property", institution: "Principal Residence", description: "Estimated Fair Market Value", current: 780000, previous: 750000, kind: "Asset", source: "jordan-property.csv" },
  { id: "4", include: true, investorId: "sample-b", investor: "Jordan Morgan", category: "Mortgages Payable", holder: "Sample Lender", accountName: "Residential Mortgage", institution: "Sample Lender", description: "Residential Mortgage", current: 325000, previous: null, kind: "Liability", source: "jordan-mortgage.csv" },
];

const assetCategories: Category[] = ["Cash & Bank Accounts", "Investments", "Mortgage Investments / Mortgage Receivables", "Loans Receivable", "Vehicles", "Insurance Cash Value", "Inherited Assets", "Real Estate", "Other Assets"];
const liabilityCategories: Category[] = ["Mortgages Payable", "Loans Payable", "Taxes Owing", "Accounts Payable", "Credit Cards", "Other Liabilities"];

function money(value: number | null | "") {
  if (value === null || value === "" || !Number.isFinite(Number(value))) return "N/A";
  const number = Number(value);
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(number);
}

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<Row[]>([]);
  const [groupName, setGroupName] = useState("The Sample Family");
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [investorList, setInvestorList] = useState<Investor[]>([{ id: crypto.randomUUID(), name: "", files: [] }]);
  const [activeInvestorId, setActiveInvestorId] = useState(() => investorList[0].id);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const included = useMemo(() => confirmedDetailRows(rows), [rows]);
  const hasInvalidIncludedRows = rows.some((row) => row.include && (!row.description.trim() || row.current === "")) || hasUnnamedIncludedRows(rows);
  const files = investorList.flatMap((investor) => investor.files);
  const activeInvestor = investorList.find((investor) => investor.id === activeInvestorId);
  const assets = included.filter((row) => row.kind === "Asset").reduce((sum, row) => sum + Number(row.current), 0);
  const liabilities = included.filter((row) => row.kind === "Liability").reduce((sum, row) => sum + Number(row.current), 0);
  const netWorth = assets - liabilities;
  const previousAssets = included.filter((row) => row.kind === "Asset" && row.previous !== null).reduce((sum, row) => sum + Number(row.previous), 0);
  const previousLiabilities = included.filter((row) => row.kind === "Liability" && row.previous !== null).reduce((sum, row) => sum + Number(row.previous), 0);
  const hasPrevious = included.some((row) => row.previous !== null);
  const previousNetWorth = previousAssets - previousLiabilities;
  const investors = Array.from(new Set(included.map((row) => row.investor)));
  const reportGroups = useMemo(() => groupReportRows(rows), [rows]);

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
            <div className="tableWrap" tabIndex={0} aria-label="Review extracted financial rows">
              <table className="reviewTable"><thead><tr><th>Include</th><th>Investor</th><th>Category</th><th>Institution / Account</th><th>Description</th><th>Current Value</th><th>Previous Value</th><th>Asset / Liability</th><th>Source</th><th></th></tr></thead>
                <tbody>{rows.map((row) => <tr key={row.id}>
                  <td><input type="checkbox" checked={row.include} onChange={(e) => update(row.id, { include: e.target.checked })} /></td>
                  <td><select aria-label="Assigned investor" value={row.investor} className={!row.investor.trim() ? "invalid" : ""} onChange={(e) => { const selected = investorList.find((investor) => investor.name === e.target.value); update(row.id, { investor: e.target.value, investorId: selected?.id }); }}><option value="">Select investor</option>{investorList.filter((item) => item.name.trim()).map((item) => <option key={item.id} value={item.name.trim()}>{item.name.trim()}</option>)}</select></td>
                  <td><select value={row.category} onChange={(e) => update(row.id, { category: e.target.value as Category })}>{(row.kind === "Asset" ? assetCategories : liabilityCategories).map((c) => <option key={c}>{c}</option>)}</select></td>
                  <td><input value={row.institution} placeholder="Institution / account" onChange={(e) => update(row.id, { institution: e.target.value })} /></td>
                  <td><input required aria-invalid={!row.description.trim()} className={!row.description.trim() ? "invalid" : ""} value={row.description} placeholder="Required" onChange={(e) => update(row.id, { description: e.target.value })} /></td>
                  <td><input required aria-invalid={row.current === ""} type="number" className={row.current === "" ? "invalid" : ""} value={row.current} onChange={(e) => update(row.id, { current: e.target.value === "" ? "" : Number(e.target.value) })} /></td>
                  <td><input type="number" value={row.previous ?? ""} placeholder="N/A" onChange={(e) => update(row.id, { previous: e.target.value === "" ? null : Number(e.target.value) })} /></td>
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
            <div className="reportReady"><div><span className="eyebrow">Report ready</span><h2>Your consolidated statement is complete</h2><p>{groupName} · {new Date(`${statementDate}T00:00:00`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}</p></div><div className="buttonRow"><button className="secondary" onClick={() => setStep("review")}>Edit data</button><button className="secondary" onClick={() => window.print()}>Print</button><button className="primary" onClick={downloadCsv}>Download data</button></div></div>
            <article className="paper">
              <div className="paperHead"><div><div className="paperBrand"><span className="brandMark">ϟ</span> adavi.ai</div><h1>Consolidated Net Worth Report</h1><p>{groupName}</p></div><div className="dateBlock"><span>Statement date</span><strong>{statementDate}</strong><span>Currency</span><strong>CAD</strong></div></div>
              <div className="summaryCards"><Summary label="Total Assets" value={money(assets)} tone="green" /><Summary label="Total Liabilities" value={money(liabilities)} tone="red" /><Summary label="Net Worth" value={money(netWorth)} tone="gold" /></div>
              <h3>Net Worth by Investor</h3>
              <table className="reportTable"><thead><tr><th>Investor</th><th>Assets</th><th>Liabilities</th><th>Net Worth</th></tr></thead><tbody>{investors.map((investor) => { const owned = included.filter((r) => r.investor === investor); const a = owned.filter((r) => r.kind === "Asset").reduce((s, r) => s + Number(r.current), 0); const l = owned.filter((r) => r.kind === "Liability").reduce((s, r) => s + Number(r.current), 0); return <tr key={investor}><td><strong>{investor}</strong></td><td>{money(a)}</td><td>{money(l)}</td><td><strong>{money(a-l)}</strong></td></tr>; })}</tbody></table>
              <h3>Detailed Consolidated Statement</h3>
              <div className="detailedStatement">{reportGroups.map((investor) => <section className="investorGroup" key={investor.investor}><h4>{investor.investor}</h4>{investor.sections.map((section) => <section className="statementSection" key={section.kind}><h5>{section.kind === "Asset" ? "Assets" : "Liabilities"}</h5>{section.categories.map((category) => <Disclosure className="categoryGroup" label={category.category} total={money(category.total)} key={category.category}>{category.holders.map((holder) => <Disclosure className="holderGroup" label={holder.holder} total={money(holder.total)} key={holder.holder}><table className="reportTable accountTable"><thead><tr><th>Account / Description</th><th>Current</th><th>Previous</th></tr></thead><tbody>{holder.rows.map((row) => <tr key={row.id}><td><strong>{row.accountName || row.description}</strong>{row.accountName !== row.description && <small>{row.description}</small>}</td><td>{money(row.current)}</td><td>{money(row.previous)}</td></tr>)}</tbody></table></Disclosure>)}</Disclosure>)}</section>)}</section>)}</div>
              <table className="reportTable consolidatedTotal"><tfoot><tr><td>Consolidated Net Worth</td><td>{money(netWorth)}</td><td>{hasPrevious ? money(previousNetWorth) : "N/A"}</td><td>{hasPrevious ? money(netWorth - previousNetWorth) : "N/A"}</td></tr></tfoot></table>
              <div className="reportBottom"><div><h3>Asset Mix</h3>{included.filter((r) => r.kind === "Asset").map((row) => <div className="mix" key={row.id}><span>{row.category}</span><div><i style={{ width: `${assets ? Math.max(4, Number(row.current) / assets * 100) : 0}%` }} /></div><strong>{assets ? (Number(row.current) / assets * 100).toFixed(1) : 0}%</strong></div>)}</div><div className="disclaimer"><strong>About this report</strong><p>This report consolidates the information reviewed and confirmed by the user. Values marked N/A were unavailable and are treated as zero only for comparative totals.</p></div></div>
              <footer className="paperFooter"><span>Prepared with adavi.ai</span><span>Educational estimates only · Not tax, legal, accounting, or investment advice</span></footer>
            </article>
          </section>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className={`metric ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong></div>; }
function Summary({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className={`summary ${tone}`}><span>{label}</span><strong>{value}</strong></div>; }

function Disclosure({ className, label, total, children }: { className: string; label: string; total: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return <section className={className}><button type="button" className="disclosureToggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><span>{label}</span><strong>{total}</strong></button><div className={`disclosureContent ${expanded ? "expanded" : "collapsed"}`}>{children}</div></section>;
}
