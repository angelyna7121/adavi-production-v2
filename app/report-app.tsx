"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { parseDocument, type Kind, type Category, type ParsedRow as Row } from "./lib/documentParser";
import { formatPeriodAmount } from "./lib/ocrFinancialParser";
import { applyOwnershipToRow, assignInvestor, assignStatement, calculateAssetMix, calculatePeriodTotals, calculateReconciliation, confirmedDetailRows, createReportCsv, duplicateFinancialRow, effectiveOwnershipPercentage, groupReportRows, hasUnnamedIncludedRows, paginateReportSchedule, removeInvestorRows, removeStatementRows, setRowOwnershipOverride, setStatementOwnership, validateOwnershipPercentage, type PrintScheduleRow, type ReportGroup, type StatementRecord } from "./lib/reportData";

type Step = "upload" | "review" | "report";
type Investor = { investorId: string; name: string; statements: StatementRecord[] };
type RowEditor = { mode:"add"|"duplicate"; sourceRowId?:string; draft:Row };

const sampleRows: Row[] = [
  { id: "1", include: true, investorId: "sample-a", investor: "Alex Morgan", statementId:"sample-statement-1", ownershipPercentage:100, rawCurrent:42500, rawPrevious:null, category: "Cash & Bank Accounts", holder: "Sample Bank", accountName: "Chequing", institution: "Sample Bank", description: "CAD Chequing", current: 42500, previous: null, kind: "Asset", source: "alex-bank.csv" },
  { id: "2", include: true, investorId: "sample-a", investor: "Alex Morgan", statementId:"sample-statement-2", ownershipPercentage:50, rawCurrent:430000, rawPrevious:404000, category: "Investments", holder: "Sample Brokerage", accountName: "Non-registered Portfolio", institution: "Sample Brokerage", description: "Non-registered Portfolio", current: 215000, previous: 202000, kind: "Asset", source: "alex-portfolio.csv" },
  { id: "3", include: true, investorId: "sample-b", investor: "Jordan Morgan", statementId:"sample-statement-3", ownershipPercentage:100, rawCurrent:780000, rawPrevious:750000, category: "Real Estate", holder: "Principal Residence", accountName: "Property", institution: "Principal Residence", description: "Estimated Fair Market Value", current: 780000, previous: 750000, kind: "Asset", source: "jordan-property.csv" },
  { id: "4", include: true, investorId: "sample-b", investor: "Jordan Morgan", statementId:"sample-statement-4", ownershipPercentage:100, rawCurrent:325000, rawPrevious:null, category: "Mortgages Payable", holder: "Sample Lender", accountName: "Residential Mortgage", institution: "Sample Lender", description: "Residential Mortgage", current: 325000, previous: null, kind: "Liability", source: "jordan-mortgage.csv" },
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
  const [investorList, setInvestorList] = useState<Investor[]>([{ investorId: crypto.randomUUID(), name: "", statements: [] }]);
  const [activeInvestorId, setActiveInvestorId] = useState(() => investorList[0].investorId);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState("");
  const [dragging, setDragging] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [editingStatementId, setEditingStatementId] = useState<string | null>(null);
  const [ownershipError, setOwnershipError] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [rowEditor, setRowEditor] = useState<RowEditor | null>(null);
  const [rowEditorError, setRowEditorError] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const searchMatchesRef = useRef<HTMLElement[]>([]);
  const searchIndexRef = useRef(-1);
  const fileRef = useRef<HTMLInputElement>(null);

  const included = useMemo(() => confirmedDetailRows(rows), [rows]);
  const hasInvalidIncludedRows = rows.some((row) => row.include && (!row.description.trim() || row.current === "")) || hasUnnamedIncludedRows(rows);
  const statements = investorList.flatMap((investor) => investor.statements);
  const activeInvestor = investorList.find((investor) => investor.investorId === activeInvestorId);
  const hasPartialOwnership = statements.some((statement) => statement.ownershipPercentage < 100) || rows.some((row)=>effectiveOwnershipPercentage(row)<100);
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
    const completedStatements: StatementRecord[] = [];
    const errors: string[] = [];
    setError("");
    setProcessing("Preparing statements…");
    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index];
      const statement: StatementRecord = { statementId:crypto.randomUUID(), investorId:activeInvestorId, filename:file.name, ownershipPercentage:100, parseStatus:"processing" };
      try {
        setProcessing(`Processing ${file.name} (${index + 1} of ${selected.length})…`);
        const extracted = await parseDocument(file, setProcessing);
        parsed.push(...assignStatement(assignInvestor(extracted, activeInvestorId, investorName),{...statement,parseStatus:"ready"}));
        completedStatements.push({...statement,parseStatus:"ready"});
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
    setInvestorList((current) => current.map((investor) => investor.investorId === activeInvestorId ? { ...investor, statements: [...investor.statements, ...completedStatements] } : investor));
  }

  function loadSample() {
    setRows(sampleRows);
    setInvestorList([{ investorId: "sample-a", name: "Alex Morgan", statements: [{statementId:"sample-statement-1",investorId:"sample-a",filename:"alex-bank.csv",ownershipPercentage:100,parseStatus:"ready"},{statementId:"sample-statement-2",investorId:"sample-a",filename:"alex-portfolio.csv",ownershipPercentage:50,parseStatus:"ready"}] }, { investorId: "sample-b", name: "Jordan Morgan", statements: [{statementId:"sample-statement-3",investorId:"sample-b",filename:"jordan-property.csv",ownershipPercentage:100,parseStatus:"ready"},{statementId:"sample-statement-4",investorId:"sample-b",filename:"jordan-mortgage.csv",ownershipPercentage:100,parseStatus:"ready"}] }]);
    setActiveInvestorId("sample-a");
    setError("");
    setStep("review");
  }

  function addRow() {
    const selected=rows.find((row)=>row.id===selectedRowId);const investor=investorList.find((item)=>item.investorId===(selected?.investorId??activeInvestorId))??investorList.find((item)=>item.name.trim());const statement=statements.find((item)=>item.statementId===selected?.statementId);const percentage=statement?.ownershipPercentage??100;
    setRowEditorError("");setRowEditor({mode:"add",draft:{id:crypto.randomUUID(),include:true,investor:investor?.name.trim()??"",investorId:investor?.investorId,statementId:statement?.statementId,ownershipPercentage:percentage,rowOwnershipOverride:percentage,rawCurrent:"",rawPrevious:null,category:"Other Assets",holder:"",accountName:"",institution:"",description:"",current:"",previous:null,kind:"Asset",source:statement?.filename??"Manual entry",manuallyCreated:true}});
  }

  function duplicateSelectedRow(){const source=rows.find((row)=>row.id===selectedRowId);if(!source)return;const duplicate=duplicateFinancialRow(source,crypto.randomUUID());setSelectedRowId(duplicate.id);setRowEditorError("");setRowEditor({mode:"duplicate",sourceRowId:source.id,draft:setRowOwnershipOverride(duplicate,effectiveOwnershipPercentage(source))});}

  function patchEditor(patch:Partial<Row>){setRowEditor((current)=>current?{...current,draft:{...current.draft,...patch}}:current);}
  function patchEditorRaw(period:"current"|"previous",value:number|""|null){setRowEditor((current)=>{if(!current)return current;const draft=period==="current"?{...current.draft,rawCurrent:value as number|""}:{...current.draft,rawPrevious:value as number|null};return {...current,draft:applyOwnershipToRow(draft,draft.ownershipPercentage??100)};});}
  function patchEditorOwnership(value:number|null){
    try {
      // Validate before scheduling the React state update. Errors thrown from a
      // state-updater callback run during React's render work and cannot be
      // caught by the surrounding event-handler try/catch.
      const validated = value === null ? null : validateOwnershipPercentage(value);
      setRowEditorError("");
      setRowEditor((current)=>current?{...current,draft:setRowOwnershipOverride(current.draft,validated)}:current);
    } catch(reason) {
      setRowEditorError(reason instanceof Error?reason.message:"Enter an ownership percentage greater than 0 and no more than 100.");
    }
  }
  function saveRowEditor(){if(!rowEditor)return;try{if(!rowEditor.draft.description.trim())throw new Error("Account / Description is required.");if(rowEditor.draft.rawCurrent==="")throw new Error("Raw Current Value is required.");const saved=setRowOwnershipOverride(rowEditor.draft,rowEditor.draft.rowOwnershipOverride??null);setRows((current)=>{if(rowEditor.mode==="add")return [...current,saved];const index=current.findIndex((row)=>row.id===rowEditor.sourceRowId);return index<0?[...current,saved]:[...current.slice(0,index+1),saved,...current.slice(index+1)];});setSelectedRowId(saved.id);setRowEditor(null);setRowEditorError("");}catch(reason){setRowEditorError(reason instanceof Error?reason.message:"Review the row before saving.");}}

  function update(id: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function updateRawAmount(id:string,period:"current"|"previous",value:number|""|null){setRows((current)=>current.map((row)=>{if(row.id!==id)return row;const patched=period==="current"?{...row,rawCurrent:value as number|""}:{...row,rawPrevious:value as number|null};return applyOwnershipToRow(patched,row.ownershipPercentage??100);}));}

  function renameInvestor(id: string, name: string) {
    setInvestorList((current) => current.map((investor) => investor.investorId === id ? { ...investor, name } : investor));
    setRows((current) => current.map((row) => row.investorId === id ? { ...row, investor: name } : row));
  }

  function addInvestor() {
    const investor = { investorId: crypto.randomUUID(), name: "", statements: [] };
    setInvestorList((current) => [...current, investor]);
    setActiveInvestorId(investor.investorId);
  }

  function uploadForInvestor(investorId:string){setActiveInvestorId(investorId);setTimeout(()=>fileRef.current?.click(),0);}

  function changeStatementOwnership(statementId:string,value:number){
    try{const percentage=validateOwnershipPercentage(value);setOwnershipError("");setInvestorList((current)=>current.map((investor)=>({...investor,statements:investor.statements.map((statement)=>statement.statementId===statementId?{...statement,ownershipPercentage:percentage}:statement)})));setRows((current)=>setStatementOwnership(current,statementId,percentage));}
    catch(reason){setOwnershipError(reason instanceof Error?reason.message:"Enter an ownership percentage greater than 0 and no more than 100.");}
  }

  function removeStatement(statement:StatementRecord){
    if(!window.confirm(`Remove ${statement.filename}? All extracted and reconciled rows from this statement will be removed from the report.`))return;
    if(statement.objectUrl)URL.revokeObjectURL(statement.objectUrl);
    setRows((current)=>removeStatementRows(current,statement.statementId));
    setInvestorList((current)=>current.map((investor)=>({...investor,statements:investor.statements.filter((item)=>item.statementId!==statement.statementId)})));
    setEditingStatementId(null);
  }

  function removeInvestor(investor:Investor){
    const suffix=investor.statements.length?" This will also remove all statements and reconciled rows assigned to this investor.":"";
    if(!window.confirm(`Remove ${investor.name.trim()||"this investor"}?${suffix}`))return;
    investor.statements.forEach((statement)=>{if(statement.objectUrl)URL.revokeObjectURL(statement.objectUrl);});
    setRows((current)=>removeInvestorRows(current,investor.investorId));
    setInvestorList((current)=>{const remaining=current.filter((item)=>item.investorId!==investor.investorId);if(remaining.length){setActiveInvestorId(remaining[0].investorId);return remaining;}const empty={investorId:crypto.randomUUID(),name:"",statements:[]};setActiveInvestorId(empty.investorId);return [empty];});
  }

  function reassignStatement(statementId:string|undefined,targetInvestorId:string){
    const target=investorList.find((investor)=>investor.investorId===targetInvestorId);if(!target)return;
    if(!statementId){return;}
    setInvestorList((current)=>{let moving:StatementRecord|undefined;const without=current.map((investor)=>({...investor,statements:investor.statements.filter((statement)=>{if(statement.statementId===statementId){moving={...statement,investorId:targetInvestorId};return false;}return true;})}));return without.map((investor)=>investor.investorId===targetInvestorId&&moving?{...investor,statements:[...investor.statements,moving]}:investor);});
    setRows((current)=>current.map((row)=>row.statementId===statementId?{...row,investorId:targetInvestorId,investor:target.name}:row));
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

  function clearSearchHighlight() {
    searchMatchesRef.current.forEach((element) => element.classList.remove("pageSearchMatch", "pageSearchCurrent"));
    searchMatchesRef.current = [];
    searchIndexRef.current = -1;
    setSearchMatchCount(0);
  }

  function searchPage() {
    const query = searchQuery.trim().toLocaleLowerCase("en-CA");
    clearSearchHighlight();
    if (!query) { setSearchStatus("Enter a word or number to search this page."); return; }
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("main h1, main h2, main h3, main h4, main h5, main h6, main p, main td, main th, main label, main input, main select, main button, main small, main strong, main span"));
    const matches = candidates.filter((element) => {
      if (element.closest(".pageSearchPanel") || element.offsetParent === null) return false;
      const value = element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value : element.innerText;
      return value.toLocaleLowerCase("en-CA").includes(query);
    });
    searchMatchesRef.current = matches;
    setSearchMatchCount(matches.length);
    matches.forEach((element) => element.classList.add("pageSearchMatch"));
    if (!matches.length) { setSearchStatus(`No results for “${searchQuery.trim()}”.`); return; }
    searchIndexRef.current = 0;
    matches[0].classList.add("pageSearchCurrent");
    matches[0].scrollIntoView({ behavior: "smooth", block: "center" });
    setSearchStatus(`Result 1 of ${matches.length}.`);
  }

  function nextSearchResult() {
    const matches = searchMatchesRef.current;
    if (!matches.length) { searchPage(); return; }
    matches[searchIndexRef.current]?.classList.remove("pageSearchCurrent");
    searchIndexRef.current = (searchIndexRef.current + 1) % matches.length;
    const current = matches[searchIndexRef.current];
    current.classList.add("pageSearchCurrent");
    current.scrollIntoView({ behavior: "smooth", block: "center" });
    setSearchStatus(`Result ${searchIndexRef.current + 1} of ${matches.length}.`);
  }

  function closeSearch() {
    clearSearchHighlight();
    setShowSearch(false);
    setSearchStatus("");
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#"><span className="brandMark">ϟ</span><span>adavi.ai</span></a>
        <nav><a href="#">Dashboard</a><a className="active" href="#">Net Worth</a><a href="#">Income Strategy</a><a href="#">Reports</a></nav>
        <div className="topbarActions"><button type="button" className="searchButton" aria-expanded={showSearch} aria-controls="page-search-panel" onClick={() => showSearch ? closeSearch() : setShowSearch(true)}>⌕&nbsp;&nbsp; Search</button><button className="upgrade">♕&nbsp;&nbsp; Upgrade</button></div>
      </header>

      {showSearch && <form id="page-search-panel" className="pageSearchPanel" role="search" onSubmit={(event) => { event.preventDefault(); searchPage(); }}><label htmlFor="page-search-input">Search this page</label><input id="page-search-input" autoFocus type="search" inputMode="search" value={searchQuery} placeholder="Enter words or numbers" onChange={(event) => { setSearchQuery(event.target.value); clearSearchHighlight(); setSearchStatus(""); }} /><button type="submit" className="primary compactAction">Search</button><button type="button" className="secondary compactAction" disabled={!searchMatchCount} onClick={nextSearchResult}>Next result</button><button type="button" className="dialogClose" aria-label="Close search" onClick={closeSearch}>×</button><span className="pageSearchStatus" role="status" aria-live="polite">{searchStatus}</span></form>}

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
                {investorList.map((investor) => <div className={`investorCard ${investor.investorId === activeInvestorId ? "selected" : ""}`} key={investor.investorId} onClick={() => setActiveInvestorId(investor.investorId)}>
                  <label>Investor name<input aria-label="Investor name" value={investor.name} placeholder="Required before upload" onClick={(event) => event.stopPropagation()} onChange={(event) => renameInvestor(investor.investorId, event.target.value)} /></label>
                  <div className="statementList">{investor.statements.length?investor.statements.map((statement)=><div className="statementItem" key={statement.statementId} onClick={(event)=>event.stopPropagation()}><strong>{statement.filename}</strong><span className={statement.ownershipPercentage<100?"ownershipBadge adjusted":"ownershipBadge"}>{statement.ownershipPercentage}%{statement.ownershipPercentage<100?" included":""}</span><div className="statementActions"><button type="button" className="compactAction" aria-expanded={editingStatementId===statement.statementId} onClick={()=>{setOwnershipError("");setEditingStatementId((current)=>current===statement.statementId?null:statement.statementId);}}>Edit Ownership %</button><button type="button" className="removeAction" onClick={()=>removeStatement(statement)}>Remove statement</button></div>{editingStatementId===statement.statementId&&<div className="ownershipEditor" role="group" aria-label={`Ownership percentage for ${statement.filename}`}><label>Ownership %<input type="number" min="0.01" max="100" step="0.01" value={statement.ownershipPercentage} onChange={(event)=>changeStatementOwnership(statement.statementId,Number(event.target.value))}/></label><div className="quickOwnership" aria-label="Quick ownership choices">{[25,50,75,100].map((choice)=><button type="button" key={choice} onClick={()=>changeStatementOwnership(statement.statementId,choice)}>{choice}%</button>)}</div><button type="button" className="compactAction" onClick={(event)=>{setEditingStatementId(null);event.currentTarget.closest<HTMLElement>(".statementItem")?.querySelector<HTMLButtonElement>(".compactAction")?.focus();}}>Done</button></div>}</div>):<small>No statements assigned yet</small>}</div>
                  <div className="investorActions"><button type="button" className="secondary compactAction" disabled={!investor.name.trim()||Boolean(processing)} onClick={(event)=>{event.stopPropagation();uploadForInvestor(investor.investorId);}}>＋ Add statements</button><button type="button" className="removeInvestor" onClick={(event)=>{event.stopPropagation();removeInvestor(investor);}}>Remove investor</button></div>
                </div>)}
              </div>
              {ownershipError&&<div className="ownershipError" role="alert">{ownershipError}</div>}
              <button className="secondary addInvestor" onClick={addInvestor}>＋ Add another investor</button>
              <div className="uploadIcon">⇧</div>
              <h2>Upload {activeInvestor?.name.trim() ? `${activeInvestor.name.trim()}’s` : "this investor’s"} statements</h2>
              <p>PDF, JPG, PNG, CSV, XLSX, OCR scans and Adobe-exported statements up to 10 MB each.</p>
              <div className="buttonRow"><button className="primary" disabled={Boolean(processing) || !activeInvestor?.name.trim()} onClick={() => fileRef.current?.click()}>{processing || "Browse files"}</button><button className="secondary" disabled={Boolean(processing)} onClick={loadSample}>Use sample statements</button>{rows.length > 0 && <button className="primary" disabled={investorList.some((investor) => investor.statements.length > 0 && !investor.name.trim())} onClick={() => setStep("review")}>Review & Reconcile →</button>}</div>
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
            <div className="sectionHead"><div><span className="eyebrow">Step 2</span><h2>Review & Reconcile Extracted Line Items</h2><p>Edit values, choose what to include, and confirm before generating the statement.</p></div><div className="reviewRowActions"><button className="secondary" onClick={addRow}>＋ Add Row</button><button className="secondary" disabled={!selectedRowId} aria-describedby="duplicate-row-help" title={selectedRowId?"Duplicate the selected account row":"Select an account row first"} onClick={duplicateSelectedRow}>Duplicate Selected Row</button><span id="duplicate-row-help" className="srOnly">Select one account row using its radio button before duplicating it.</span></div></div>
            <div className="metricGrid">
              <Metric label="Files processed" value={String(statements.length)} />
              <Metric label="Extracted rows" value={String(rows.length)} />
              <Metric label="Reconciled assets" value={money(assets)} />
              <Metric label="Reconciled liabilities" value={money(liabilities)} />
              <Metric label="Net worth" value={money(netWorth)} accent />
            </div>
            {rows.some((row) => row.needsReview) && <div className="reconciliationWarning" role="status">Some OCR values had low confidence and are highlighted for review. Confirm them against the statement before generating the report.</div>}
            {currentTotals.categories.some((category) => category.status === "minor-source-difference") && <div className="reconciliationWarning" role="status">The statement contains a $1 difference between displayed leaf accounts and a printed category subtotal. The printed subtotal is used once as the reconciliation control; no adjustment account was invented.</div>}
            {reconciliation.matches === false && <div className="reconciliationWarning" role="alert">Calculated net worth differs from the statement’s TOTAL NET WORTH by {money(Math.abs(reconciliation.difference!))}. Review the highlighted extraction values.</div>}
            <div className="tableWrap" tabIndex={0} aria-label="Review extracted financial rows">
              <table className="reviewTable"><thead><tr><th>Select</th><th>Include</th><th>Investor</th><th>Category</th><th>Holder / Institution</th><th>Account / Description</th><th>Statement / Ownership</th><th>Raw Current</th><th>Included Current</th><th>Raw Previous</th><th>Included Previous</th><th>Asset / Liability</th><th></th></tr></thead>
                <tbody>{rows.map((row) => <tr key={row.id} className={`${row.needsReview ? "needsReview" : ""} ${effectiveOwnershipPercentage(row)<100?"ownershipAdjusted":""} ${selectedRowId===row.id?"selectedForDuplicate":""}`}>
                  <td><input type="radio" name="selected-review-row" aria-label={`Select ${row.description || "account row"} for duplication`} checked={selectedRowId===row.id} onChange={()=>setSelectedRowId(row.id)} /></td>
                  <td><input type="checkbox" checked={row.include} onChange={(e) => update(row.id, { include: e.target.checked })} /></td>
                  <td><select aria-label="Assigned investor" value={row.investorId??""} className={!row.investor.trim() ? "invalid" : ""} onChange={(e) => { const selected = investorList.find((investor) => investor.investorId === e.target.value);if(row.statementId)reassignStatement(row.statementId,e.target.value);else update(row.id, { investor: selected?.name??"", investorId: selected?.investorId }); }}><option value="">Select investor</option>{investorList.filter((item) => item.name.trim()).map((item) => <option key={item.investorId} value={item.investorId}>{item.name.trim()}</option>)}</select></td>
                  <td><select value={row.category} onChange={(e) => update(row.id, { category: e.target.value as Category })}>{(row.kind === "Asset" ? assetCategories : liabilityCategories).map((c) => <option key={c}>{c}</option>)}</select></td>
                  <td><input value={row.holder} placeholder="Holder / institution" onChange={(e) => update(row.id, { holder: e.target.value, institution: e.target.value })} /></td>
                  <td><input required aria-label="Account description" aria-invalid={!row.description.trim()} className={!row.description.trim() ? "invalid" : ""} value={row.description} placeholder="Description required" onChange={(e) => update(row.id, { description: e.target.value })} /></td>
                  <td className="sourceCell"><strong>{row.source}</strong><span className={effectiveOwnershipPercentage(row)<100?"ownershipBadge adjusted":"ownershipBadge"}>{effectiveOwnershipPercentage(row)}% ownership{effectiveOwnershipPercentage(row)<100?" applied":""}{row.rowOwnershipOverride!=null?" (row override)":""}</span></td>
                  <td><input aria-label={`Raw current value for ${row.description}`} required aria-invalid={(row.rawCurrent??row.current) === ""} type="number" className={(row.rawCurrent??row.current) === "" ? "invalid" : ""} value={row.rawCurrent??row.current} onChange={(e) => updateRawAmount(row.id,"current",e.target.value === "" ? "" : Number(e.target.value))} /></td>
                  <td className="effectiveValue">{money(row.current)}</td>
                  <td><input aria-label={`Raw previous value for ${row.description}`} type="number" value={row.rawPrevious!==undefined?(row.rawPrevious??""):(row.previous??"")} placeholder="$0" onChange={(e) => updateRawAmount(row.id,"previous",e.target.value === "" ? null : Number(e.target.value))} /></td>
                  <td className="effectiveValue">{money(row.previous)}</td>
                  <td><select value={row.kind} onChange={(e) => update(row.id, { kind: e.target.value as Kind })}><option>Asset</option><option>Liability</option></select></td>
                  <td><button className="delete" aria-label="Delete row" onClick={() => {setRows((current) => current.filter((item) => item.id !== row.id));setSelectedRowId((current)=>current===row.id?null:current);}}>×</button></td>
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
              {!hasVerifiedPaidEntitlement && <><div className="printWatermark" aria-hidden="true">adavi</div><div className="printBranding">Created by adavi</div></>}
              <div className="paperHead"><div>{!hasVerifiedPaidEntitlement && <div className="paperBrand"><span className="brandMark">ϟ</span> adavi</div>}<h1>Consolidated Net Worth Report</h1><p>{groupName}</p></div><div className="dateBlock"><span>Statement date</span><strong>{statementDate}</strong><span>Currency</span><strong>{currency}</strong></div></div>
              <div className="summaryCards"><Summary label="Total Assets" current={money(assets)} previous={money(previousAssets)} currentLabel={currentPeriodLabel} previousLabel={previousPeriodLabel} tone="assets" /><Summary label="Total Liabilities" current={money(liabilities)} previous={money(previousLiabilities)} currentLabel={currentPeriodLabel} previousLabel={previousPeriodLabel} tone="liabilities" /><Summary label="Net Worth" current={money(netWorth)} previous={money(previousNetWorth)} currentLabel={currentPeriodLabel} previousLabel={previousPeriodLabel} change={money(netWorthChange)} tone="networth" /></div>
              {hasPartialOwnership&&<div className="ownershipDisclosure">Certain statement values have been proportionately included based on the ownership percentages confirmed by the user.</div>}
              <section className="consolidatedSchedule printExcluded"><h3>Consolidated Schedule</h3><div className="detailedStatement">{reportGroups.map((investor) => <section className="investorGroup" key={investor.investor}><h4>{investor.investor}</h4>{investor.sections.map((section) => <section className="statementSection" key={section.kind}><h5>{section.kind === "Asset" ? "Assets" : "Liabilities"}</h5>{section.categories.map((category) => <CategoryTable category={category} key={category.category} />)}</section>)}</section>)}</div><table className="reportTable consolidatedTotal"><tfoot><tr><td>Consolidated Net Worth</td><td>{money(netWorth)}</td><td>{money(hasPrevious ? previousNetWorth : 0)}</td><td>{money(hasPrevious ? netWorth - previousNetWorth : 0)}</td></tr></tfoot></table></section>
              <div className="reportBottom"><div><h3>Asset Mix</h3>{assetMix.map((entry) => <div className="mix" key={entry.category}><span>{entry.category}</span><em>{money(entry.total)}</em><div><i style={{ width: `${entry.percentage ? Math.max(4, entry.percentage) : 0}%` }} /></div><strong>{entry.percentage.toFixed(1)}%</strong></div>)}</div><div className="disclaimer"><strong>About this report</strong><p>This report consolidates the information reviewed and confirmed by the user. A missing comparative balance is displayed as $0 and is never copied from another period.</p></div></div>
              {!hasVerifiedPaidEntitlement && <footer className="paperFooter"><span>Created by adavi</span><span>Educational estimates only · Not tax, legal, accounting, or investment advice</span></footer>}
            </article>
            <PrintReport groupName={groupName} statementDate={statementDate} currency={currency} currentLabel={currentPeriodLabel} previousLabel={previousPeriodLabel} assets={assets} previousAssets={previousAssets} liabilities={liabilities} previousLiabilities={previousLiabilities} netWorth={netWorth} previousNetWorth={previousNetWorth} netWorthChange={netWorthChange} reportGroups={reportGroups} assetMix={assetMix} paid={hasVerifiedPaidEntitlement} hasPartialOwnership={hasPartialOwnership} />
          </section>
        )}
      </div>
      {rowEditor&&<RowEditorDialog editor={rowEditor} investors={investorList} error={rowEditorError} onPatch={patchEditor} onRaw={patchEditorRaw} onOwnership={patchEditorOwnership} onCancel={()=>{setSelectedRowId(rowEditor.sourceRowId??selectedRowId);setRowEditor(null);setRowEditorError("");}} onSave={saveRowEditor}/>}
      {showUpgrade && <div className="upgradeBackdrop" role="presentation" onMouseDown={() => setShowUpgrade(false)}><section className="upgradePanel" role="dialog" aria-modal="true" aria-labelledby="upgrade-title" onMouseDown={(event) => event.stopPropagation()}><button className="dialogClose" aria-label="Close upgrade options" onClick={() => setShowUpgrade(false)}>×</button><span className="eyebrow">Subscriber benefit</span><h2 id="upgrade-title">Upgrade for data downloads and unbranded reports</h2><p>Printing the complete branded report is always free. A verified subscription adds CSV downloads and removes report branding.</p><div className="priceGrid"><div><strong>CAD $9.99</strong><span>per month</span></div><div><strong>CAD $99.99</strong><span>per year</span></div></div><ul><li>Download report data as CSV</li><li>Print or save PDF without adavi.ai branding</li><li>Existing paid download features</li></ul><div className="lockedNotice"><strong>Secure checkout is not available yet</strong><p>This build has no authenticated Stripe Checkout, verified webhook, or server-side subscription status. Paid actions remain locked; no browser setting can enable them.</p></div></section></div>}
    </main>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className={`metric ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong></div>; }
function Summary({ label, current, previous, currentLabel, previousLabel, tone, change }: { label: string; current: string; previous: string; currentLabel: string; previousLabel: string; tone: string; change?: string }) { return <div className={`summary ${tone}`}><h3>{label}</h3><div className="summaryPeriod"><span>Current · {currentLabel}</span><strong>{current}</strong></div><div className="summaryPeriod"><span>Previous · {previousLabel}</span><strong>{previous}</strong></div>{change && <div className="summaryChange"><span>Change in net worth</span><strong>{change}</strong></div>}</div>; }

function RowEditorDialog({editor,investors,error,onPatch,onRaw,onOwnership,onCancel,onSave}:{editor:RowEditor;investors:Investor[];error:string;onPatch:(patch:Partial<Row>)=>void;onRaw:(period:"current"|"previous",value:number|""|null)=>void;onOwnership:(value:number|null)=>void;onCancel:()=>void;onSave:()=>void}){
  const effective=effectiveOwnershipPercentage(editor.draft);
  return <div className="rowEditorBackdrop" role="presentation"><section className="rowEditorDialog" role="dialog" aria-modal="true" aria-labelledby="row-editor-title"><h2 id="row-editor-title">{editor.mode==="duplicate"?"Duplicate selected row":"Add row"}</h2><p>Review the account and ownership percentage before saving.</p><div className="rowEditorGrid"><label>Investor<select value={editor.draft.investorId??""} onChange={(event)=>{const investor=investors.find((item)=>item.investorId===event.target.value);onPatch({investorId:investor?.investorId,investor:investor?.name??""});}}><option value="">Select investor</option>{investors.filter((item)=>item.name.trim()).map((item)=><option key={item.investorId} value={item.investorId}>{item.name}</option>)}</select></label><label>Asset / Liability<select value={editor.draft.kind} onChange={(event)=>onPatch({kind:event.target.value as Kind,category:event.target.value==="Asset"?"Other Assets":"Other Liabilities"})}><option>Asset</option><option>Liability</option></select></label><label>Category<select value={editor.draft.category} onChange={(event)=>onPatch({category:event.target.value as Category})}>{(editor.draft.kind==="Asset"?assetCategories:liabilityCategories).map((category)=><option key={category}>{category}</option>)}</select></label><label>Holder / Institution<input value={editor.draft.holder} onChange={(event)=>onPatch({holder:event.target.value,institution:event.target.value})}/></label><label className="wideField">Account / Description<input autoFocus value={editor.draft.description} onChange={(event)=>onPatch({description:event.target.value,accountName:event.target.value})}/></label><label>Raw Current Value<input type="number" value={editor.draft.rawCurrent??editor.draft.current} onChange={(event)=>onRaw("current",event.target.value===""?"":Number(event.target.value))}/></label><label>Raw Previous Value<input type="number" value={editor.draft.rawPrevious!==undefined?(editor.draft.rawPrevious??""):(editor.draft.previous??"")} onChange={(event)=>onRaw("previous",event.target.value===""?null:Number(event.target.value))}/></label><label>Ownership Percentage<input aria-describedby="ownership-help" type="number" min="0.01" max="100" step="0.01" value={effective} onChange={(event)=>onOwnership(Number(event.target.value))}/></label><div className="ownershipChoice"><span id="ownership-help">Effective ownership: {effective}%</span><button type="button" className="secondary compactAction" onClick={()=>onOwnership(null)}>Use statement percentage</button></div></div>{error&&<div className="ownershipError" role="alert">{error}</div>}<div className="rowEditorActions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="button" className="primary" onClick={onSave}>Save row</button></div></section></div>;
}

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

function PrintLogo(){return <div className="printLogo"><Image src="/adavi-logo.svg" alt="adavi" width={194} height={48} priority /></div>;}
function PrintFooter({page,total,paid}:{page:number;total:number;paid:boolean}){return <footer className="printPageFooter"><span>{paid?"":"Created by adavi"}</span><span>{paid?"":"Educational estimates only"}</span><span>Page {page} of {total}</span></footer>;}
function printDate(value:string){return new Date(`${value}T00:00:00`).toLocaleDateString("en-CA",{month:"long",day:"numeric",year:"numeric"});}
function PrintScheduleTable({rows}:{rows:PrintScheduleRow[]}){return <table className="printSchedule"><colgroup><col/><col className="printAmountColumn"/><col className="printAmountColumn"/></colgroup><thead><tr><th>Account / Description</th><th>Current</th><th>Previous</th></tr></thead><tbody>{rows.map((row)=><tr className={`printRow-${row.level}`} key={row.key}><th scope="row">{row.label}</th><td>{row.current===undefined?"":money(row.current)}</td><td>{row.previous===undefined?"":money(row.previous)}</td></tr>)}</tbody></table>;}
function PrintReport({groupName,statementDate,currency,currentLabel,previousLabel,assets,previousAssets,liabilities,previousLiabilities,netWorth,previousNetWorth,netWorthChange,reportGroups,assetMix,paid,hasPartialOwnership}:{groupName:string;statementDate:string;currency:string;currentLabel:string;previousLabel:string;assets:number;previousAssets:number;liabilities:number;previousLiabilities:number;netWorth:number;previousNetWorth:number;netWorthChange:number;reportGroups:ReportGroup[];assetMix:Array<{category:string;total:number;percentage:number}>;paid:boolean;hasPartialOwnership:boolean}){
  const schedulePages=paginateReportSchedule(reportGroups);const totalPages=schedulePages.length+2;const branding=paid?"paidPrint":"freePrint";
  return <div className={`printReport ${branding}`}>
    <section className="printPage reportPage executivePage">{!paid&&<div className="pageWatermark">adavi</div>}<PrintLogo/><div className="printHero"><p>Statement of Net Worth</p><h1>Consolidated Net Worth Report</h1><h2>{groupName}</h2><div><span>Statement date</span><strong>{printDate(statementDate)}</strong><span>Currency</span><strong>{currency}</strong></div></div><div className="printSummaryCards"><Summary label="Total Assets" current={money(assets)} previous={money(previousAssets)} currentLabel={currentLabel} previousLabel={previousLabel} tone="assets"/><Summary label="Total Liabilities" current={money(liabilities)} previous={money(previousLiabilities)} currentLabel={currentLabel} previousLabel={previousLabel} tone="liabilities"/><Summary label="Net Worth" current={money(netWorth)} previous={money(previousNetWorth)} currentLabel={currentLabel} previousLabel={previousLabel} change={money(netWorthChange)} tone="networth"/></div><div className="reportingBasis"><span>Reporting basis</span><strong>Confirmed account balances, consolidated across the selected investor group</strong>{hasPartialOwnership&&<em>Certain statement values have been proportionately included based on the ownership percentages confirmed by the user.</em>}</div><PrintFooter page={1} total={totalPages} paid={paid}/></section>
    {schedulePages.map((rows,index)=><section className="printPage reportPage schedulePage" key={`schedule-${index}`}>{!paid&&<div className="pageWatermark">adavi</div>}<header className="schedulePageHead"><PrintLogo/><div><h1>Consolidated Report</h1><small>{groupName} · {printDate(statementDate)} · {currency}</small></div></header><PrintScheduleTable rows={rows}/><PrintFooter page={index+2} total={totalPages} paid={paid}/></section>)}
    <section className="printPage reportPage assetMixPage">{!paid&&<div className="pageWatermark">adavi</div>}<header className="schedulePageHead"><PrintLogo/><div><h1>Asset Mix</h1><p>Current-period composition of total confirmed assets</p><small>{groupName} · {printDate(statementDate)} · {currency}</small></div></header><div className="printAssetMix">{assetMix.map((entry)=><div className="printMix" key={entry.category}><strong>{entry.category}</strong><div className="printMixTrack"><i style={{width:`${entry.percentage}%`}}/></div><span>{money(entry.total)}</span><em>{entry.percentage.toFixed(1)}%</em></div>)}</div><div className="printTotalAssets"><strong>Total Assets</strong><span>{money(assets)}</span></div><PrintFooter page={totalPages} total={totalPages} paid={paid}/></section>
  </div>;
}
