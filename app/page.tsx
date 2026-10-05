"use client";

import { useMemo, useRef, useState } from "react";
import { parseDocument, type Kind, type ParsedRow as Row } from "./lib/documentParser";
import { buildReportModel, type ReportModel, type ReportRow } from "./lib/netWorthReport";

type Step = "upload" | "review" | "report";

const sampleRows: Row[] = [
  { id: "1", investorId: "primary-investor", include: true, investor: "Primary Investor", category: "Cash & Bank Accounts", institution: "Sample Bank", description: "CAD Chequing", current: 42500, previous: 40000, kind: "Asset", source: "sample-bank.csv", ownership: 100 },
  { id: "2", investorId: "primary-investor", include: true, investor: "Primary Investor", category: "Investments", institution: "Sample Brokerage", description: "Non-registered Portfolio", current: 215000, previous: 202000, kind: "Asset", source: "sample-portfolio.csv", ownership: 100 },
  { id: "3", investorId: "primary-investor", include: true, investor: "Primary Investor", category: "Real Estate", institution: "Principal Residence", description: "Estimated Fair Market Value", current: 780000, previous: 750000, kind: "Asset", source: "sample-property.csv", ownership: 100 },
  { id: "4", investorId: "primary-investor", include: true, investor: "Primary Investor", category: "Mortgages", institution: "Sample Lender", description: "Residential Mortgage", current: 325000, previous: 340000, kind: "Liability", source: "sample-mortgage.csv", ownership: 100 },
];

const categoryOptions = ["Cash & Bank Accounts", "Investments", "Registered Accounts", "Real Estate", "Business Interests", "Vehicles", "Mortgages", "Credit Cards", "Loans", "Taxes Owing", "Other"];

function money(value: number | null | "") {
  if (value === null || value === "" || !Number.isFinite(Number(value))) return "N/A";
  const number = Number(value);
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(number);
}

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedInvestorIds, setSelectedInvestorIds] = useState<Set<string>>(new Set());
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const included = useMemo(() => rows.filter((row) => row.include && row.current !== ""), [rows]);
  const hasInvalidIncludedRows = rows.some((row) => row.include && (!row.description.trim() || row.current === ""));
  const assets = included.filter((row) => row.kind === "Asset").reduce((sum, row) => sum + Number(row.current), 0);
  const liabilities = included.filter((row) => row.kind === "Liability").reduce((sum, row) => sum + Number(row.current), 0);
  const netWorth = assets - liabilities;
  const investors = useMemo(() => Array.from(new Map(rows.map((row) => [row.investorId, row.investor])).entries()), [rows]);
  const activeInvestorIds = selectedInvestorIds;
  const report = useMemo(() => buildReportModel(rows, activeInvestorIds, statementDate), [rows, statementDate, activeInvestorIds]);

  async function acceptFiles(list: FileList | File[]) {
    const selected = Array.from(list);
    if (!selected.length) return;
    const parsed: Row[] = [];
    const errors: string[] = [];
    setError("");
    setProcessing("Preparing statements…");
    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index];
      try {
        setProcessing(`Processing ${file.name} (${index + 1} of ${selected.length})…`);
        parsed.push(...await parseDocument(file, setProcessing));
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
    setRows(parsed);
    setSelectedInvestorIds(new Set(parsed.map((row) => row.investorId)));
    setFiles(selected.map((file) => file.name));
    setStep("review");
  }

  function loadSample() {
    setRows(sampleRows);
    setSelectedInvestorIds(new Set(sampleRows.map((row) => row.investorId)));
    setFiles(["sample-bank.csv", "sample-portfolio.csv", "sample-property.csv"]);
    setError("");
    setStep("review");
  }

  function addRow() {
    const firstInvestor = investors[0] || ["primary-investor", "Primary Investor"];
    setRows((current) => [...current, { id: crypto.randomUUID(), investorId: firstInvestor[0], include: true, investor: firstInvestor[1], category: "Other", institution: "", description: "", current: "", previous: null, kind: "Asset", source: "Manual entry", ownership: 100 }]);
  }

  function update(id: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function downloadCsv() {
    const header = "Investor,Category,Institution,Description,Current Value,Previous Value,Type,Source";
    const body = included.map((r) => [r.investor, r.category, r.institution, r.description, r.current, r.previous ?? "N/A", r.kind, r.source].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","));
    const blob = new Blob([[header, ...body].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `adavi-net-worth-${statementDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
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
              <div className="uploadIcon">⇧</div>
              <h2>Drop statements here or browse</h2>
              <p>PDF, JPG, PNG, CSV, XLSX, OCR scans and Adobe-exported statements up to 10 MB each.</p>
              <div className="buttonRow"><button className="primary" disabled={Boolean(processing)} onClick={() => fileRef.current?.click()}>{processing || "Browse files"}</button><button className="secondary" disabled={Boolean(processing)} onClick={loadSample}>Use sample statements</button></div>
              <input ref={fileRef} hidden type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx,.xls" onChange={(e) => { const snapshot = e.target.files ? Array.from(e.target.files) : []; e.currentTarget.value = ""; if (snapshot.length) acceptFiles(snapshot); }} />
              {error && <div className="errorToast"><strong>We couldn’t process this statement</strong><span>{error}</span></div>}
            </div>
            <aside className="setupCard">
              <h2>Report setup</h2>
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
            <fieldset className="investorPicker"><legend>Investors to print</legend>{investors.map(([id, name]) => <label key={id}><input type="checkbox" checked={activeInvestorIds.has(id)} onChange={(event) => setSelectedInvestorIds((current) => { const next = new Set(current); if (event.target.checked) next.add(id); else next.delete(id); return next; })} /> {name}</label>)}</fieldset>
            <div className="tableWrap" tabIndex={0} aria-label="Review extracted financial rows">
              <table className="reviewTable"><thead><tr><th>Include</th><th>Investor</th><th>Category</th><th>Institution / Account</th><th>Description</th><th>Ownership</th><th>Current Value</th><th>Previous Value</th><th>Asset / Liability</th><th>Source</th><th></th></tr></thead>
                <tbody>{rows.map((row) => <tr key={row.id}>
                  <td><input type="checkbox" checked={row.include} onChange={(e) => update(row.id, { include: e.target.checked })} /></td>
                  <td><input value={row.investor} onChange={(e) => update(row.id, { investor: e.target.value })} /></td>
                  <td><select value={row.category} onChange={(e) => update(row.id, { category: e.target.value })}>{categoryOptions.map((c) => <option key={c}>{c}</option>)}</select></td>
                  <td><input value={row.institution} placeholder="Institution / account" onChange={(e) => update(row.id, { institution: e.target.value })} /></td>
                  <td><input required aria-invalid={!row.description.trim()} className={!row.description.trim() ? "invalid" : ""} value={row.description} placeholder="Required" onChange={(e) => update(row.id, { description: e.target.value })} /></td>
                  <td><input type="number" min="0" max="100" value={row.ownership ?? 100} onChange={(e) => update(row.id, { ownership: Number(e.target.value) })} /></td>
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
            <div className="reportReady"><div><span className="eyebrow">Report ready</span><h2>Your net worth statement is complete</h2><p>{report.investorTitle}</p></div><div className="buttonRow"><button className="secondary" onClick={() => setStep("review")}>Edit data</button><button className="secondary" onClick={() => window.print()}>Print</button><button className="primary" onClick={downloadCsv}>Download data</button></div></div>
            <Overview report={report} statementDate={statementDate} />
            <ReportSummary report={report} />
            <Detailed report={report} />
          </section>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className={`metric ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong></div>; }
function Summary({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className={`summary ${tone}`}><span>{label}</span><strong>{value}</strong></div>; }

function Brand() { return <div className="paperBrand"><span className="brandMark">ϟ</span> adavi</div>; }
function ReportFooter({ type, pages = "1 of 1" }: { type: string; pages?: string }) { return <footer className="paperFooter"><span>{type}</span><span>Page {pages}</span></footer>; }
function ReportHeader({ report, title }: { report: ReportModel; title: string }) { return <><div className="reportTop"><Brand /><span>{title.toUpperCase()}</span></div><div className="reportHeading"><div><small>Investor</small><strong>{report.investorTitle}</strong><h1>{title}</h1></div><dl><div><dt>Current</dt><dd>{report.currentLabel}</dd></div><div><dt>Previous</dt><dd>{report.previousLabel}</dd></div><div><dt>Currency</dt><dd>CAD</dd></div></dl></div></>; }

function Overview({ report, statementDate }: { report: ReportModel; statementDate: string }) {
  const assetPercent = report.currentAssets ? Math.round(report.currentAssets / (report.currentAssets + report.currentLiabilities) * 100) : 0;
  return <article className="paper reportPage overviewPage"><ReportHeader report={report} title="Net Worth Overview" /><div className="overviewMeta"><span>Statement date</span><strong>{new Date(`${statementDate}T12:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</strong></div><section className="heroValue"><small>Current Net Worth</small><strong>{money(report.currentNetWorth)}</strong><div><span>Previous Net Worth <b>{money(report.previousNetWorth)}</b></span><span>Change in Net Worth <b>{money(report.currentNetWorth - report.previousNetWorth)}</b></span></div></section><div className="overviewTotals"><Summary label="Total Assets" value={money(report.currentAssets)} tone="plain" /><Summary label="Total Liabilities" value={money(report.currentLiabilities)} tone="plain" /></div><section className="position"><h2>How the portfolio is positioned</h2><div className="positionBar"><i style={{ width: `${assetPercent}%` }} /></div><div><span>Assets <b>{assetPercent}%</b></span><span>Liabilities <b>{100 - assetPercent}%</b></span></div></section><ReportFooter type="Net Worth Overview" /></article>;
}

function reportCategories(report: ReportModel, kind: "Asset" | "Liability") {
  return [...new Set(report.rows.filter((row) => row.kind === kind).map((row) => row.normalizedCategory))].map((name) => ({ name, rows: report.rows.filter((row) => row.kind === kind && row.normalizedCategory === name) }));
}
function categoryTotal(rows: ReportRow[], field: "shareCurrent" | "sharePrevious") { return rows.reduce((sum, row) => sum + Math.abs(row[field] ?? 0), 0); }
function ReportSummary({ report }: { report: ReportModel }) {
  return <article className="paper reportPage summaryPage"><ReportHeader report={report} title="Net Worth Summary" />{(["Asset", "Liability"] as const).map((kind) => <section className="summarySection" key={kind}><h2>{kind === "Asset" ? "Assets" : "Liabilities"}</h2><table><thead><tr><th>Category</th><th>Current</th><th>Previous</th></tr></thead><tbody>{reportCategories(report, kind).map((category) => <tr key={category.name}><td>{category.name}</td><td>{money(categoryTotal(category.rows, "shareCurrent"))}</td><td>{money(categoryTotal(category.rows, "sharePrevious"))}</td></tr>)}</tbody><tfoot><tr><td>Total {kind === "Asset" ? "Assets" : "Liabilities"}</td><td>{money(kind === "Asset" ? report.currentAssets : report.currentLiabilities)}</td><td>{money(kind === "Asset" ? report.previousAssets : report.previousLiabilities)}</td></tr></tfoot></table></section>)}<div className="netTotal"><span>Net Worth</span><strong>{money(report.currentNetWorth)}</strong><strong>{money(report.previousNetWorth)}</strong></div><ReportFooter type="Net Worth Summary" /></article>;
}
function Amount({ share, raw, ownership }: { share: number | null; raw: number | null; ownership: number }) { return <div className="amount"><strong>{money(share)}</strong>{ownership < 100 && <small>100% {money(raw)}</small>}</div>; }
function Detailed({ report }: { report: ReportModel }) {
  const ordered = (["Asset", "Liability"] as const).flatMap((kind) => reportCategories(report, kind).flatMap((category) => category.rows));
  const pageSize = 14;
  const pages = Array.from({ length: Math.max(1, Math.ceil(ordered.length / pageSize)) }, (_, index) => ordered.slice(index * pageSize, (index + 1) * pageSize));
  return <>{pages.map((pageRows, pageIndex) => <article className="paper reportPage detailedPage" key={pageIndex}><ReportHeader report={report} title="Net Worth Detailed" /><table className="detailTable"><thead><tr><th>Investment / Account</th><th>Ownership</th><th>Current</th><th>Previous</th></tr></thead><tbody>{pageRows.map((row, rowIndex) => { const previous = pageRows[rowIndex - 1]; const showCategory = !previous || previous.kind !== row.kind || previous.normalizedCategory !== row.normalizedCategory; return <FragmentRow key={row.id} row={row} showCategory={showCategory} />; })}</tbody>{pageIndex === pages.length - 1 && <tfoot><tr><td colSpan={2}>Net Worth</td><td>{money(report.currentNetWorth)}</td><td>{money(report.previousNetWorth)}</td></tr></tfoot>}</table><ReportFooter type="Net Worth Detailed" pages={`${pageIndex + 1} of ${pages.length}`} /></article>)}</>;
}

function FragmentRow({ row, showCategory }: { row: ReportRow; showCategory: boolean }) { return <>{showCategory && <tr className="categoryRow"><th colSpan={4}>{row.kind}s · {row.normalizedCategory}</th></tr>}<tr><td><strong>{row.description}</strong><small>{row.institution || row.investor}</small></td><td className="ownership"><strong>{row.effectiveOwnership}%</strong>{row.effectiveOwnership < 100 && <small>100%</small>}</td><td><Amount share={row.shareCurrent} raw={Number(row.current)} ownership={row.effectiveOwnership} /></td><td><Amount share={row.sharePrevious} raw={row.previous} ownership={row.effectiveOwnership} /></td></tr></>; }
