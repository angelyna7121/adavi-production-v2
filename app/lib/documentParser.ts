export type Kind = "Asset" | "Liability";
export type AssetCategory = "Cash & Bank Accounts" | "Investments" | "Mortgage Investments / Mortgage Receivables" | "Loans Receivable" | "Vehicles" | "Insurance Cash Value" | "Inherited Assets" | "Real Estate" | "Other Assets";
export type LiabilityCategory = "Mortgages Payable" | "Loans Payable" | "Taxes Owing" | "Accounts Payable" | "Credit Cards" | "Other Liabilities";
export type Category = AssetCategory | LiabilityCategory;

export type ParsedRow = {
  id: string; include: boolean; investor: string; investorId?: string;
  category: Category; holder: string; accountName: string; institution: string;
  description: string; current: number | ""; previous: number | null;
  kind: Kind; source: string;
};
type Progress = (message: string) => void;

const amountPattern = /(?:CAD|USD|\$)?\s*\(?-?\d[\d,]*(?:\.\d{1,2})?\)?/g;
const totalLine = /^\s*(?:grand\s+total|sub\s*total|subtotal|total)(?:\s|:|-|$)/i;
const prohibited = /\b(equity|retained earnings|net income|income|revenue|expense)s?\b/i;
const metadata = /^(?:page(?:\s+\d+)?|date|currency|client id|client number|account number|exchange rate|statement of|balance sheet|current|previous|description|assets? liabilities?|address)(?:\s|:|$)/i;

function id() { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function parseAmount(raw: string) { const cleaned = raw.replace(/[^\d.]/g, ""); const value = Number(cleaned); return cleaned && Number.isFinite(value) ? value : null; }
function cleanLabel(value: string) { return value.replace(/[|•]+/g, " ").replace(/\s{2,}/g, " ").replace(/^[-–—:\s]+|[-–—:\s]+$/g, "").trim(); }

export function inferCategory(description: string, kind: Kind): Category {
  const d = description.toLowerCase();
  if (kind === "Asset") {
    if (/cash surrender|cash value|policy value/.test(d)) return "Insurance Cash Value";
    if (/loan|receivable/.test(d)) return "Loans Receivable";
    if (/mortgage/.test(d)) return "Mortgage Investments / Mortgage Receivables";
    if (/cash|chequ|saving|bank/.test(d)) return "Cash & Bank Accounts";
    if (/portfolio|investment|brokerage|securit|margin/.test(d)) return "Investments";
    if (/vehicle|automobile|car\b/.test(d)) return "Vehicles";
    if (/inherit/.test(d)) return "Inherited Assets";
    if (/property|real estate|residence|\bhome\b|\bland\b/.test(d)) return "Real Estate";
    return "Other Assets";
  }
  if (/mortgage/.test(d)) return "Mortgages Payable";
  if (/tax/.test(d)) return "Taxes Owing";
  if (/accounts? payable|trade payable/.test(d)) return "Accounts Payable";
  if (/credit card|visa|mastercard|amex/.test(d)) return "Credit Cards";
  if (/loan|line of credit/.test(d)) return "Loans Payable";
  return "Other Liabilities";
}

function makeRow(source: string, kind: Kind, holder: string, accountName: string, description: string, current: number, previous: number | null, category?: Category): ParsedRow {
  return { id: id(), include: true, investor: "", category: category ?? inferCategory(`${accountName} ${description} ${holder}`, kind), holder, accountName, institution: holder, description, current: Math.abs(current), previous: previous === null ? null : Math.abs(previous), kind, source };
}

/** Parses section-aware statement text. Numeric rows outside ASSETS/LIABILITIES are deliberately ignored. */
export function parseFinancialText(text: string, source: string): ParsedRow[] {
  let section: Kind | null = null;
  let holder = "";
  let accountType = "";
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (/^(?:current\s+)?assets?\s*:?$/i.test(line)) { section = "Asset"; holder = ""; accountType = ""; continue; }
    if (/^(?:current\s+)?liabilities?\s*:?$/i.test(line)) { section = "Liability"; holder = ""; accountType = ""; continue; }
    if (/^(?:shareholders?'?\s+)?equity\s*:?$/i.test(line) || /^(?:income|revenue|expenses?)\s*:?$/i.test(line)) { section = null; continue; }
    if (!section || !line || totalLine.test(line) || prohibited.test(line) || metadata.test(line)) continue;
    const matches = [...line.matchAll(amountPattern)]
      .filter((match) => !/^\s*[A-Za-z]/.test(line.slice((match.index ?? 0) + match[0].length)))
      .map((match) => ({ index: match.index ?? 0, value: parseAmount(match[0]) }))
      .filter((match): match is {index:number;value:number} => match.value !== null);
    if (!matches.length) {
      if (line.length > 2 && !/^[\d\W]+$/.test(line)) {
        const heading = line.replace(/:$/, "");
        if (/^(?:mortgage investments?|mortgage receivables?|loans? receivable|cash|bank accounts?|cash & bank accounts?|investments?|real estate|accounts? payable|loans? payable|mortgages? payable)$/i.test(heading)) accountType = heading;
        else { holder = heading; accountType = ""; }
      }
      continue;
    }
    const label = cleanLabel(line.slice(0, matches[0].index));
    if (!label || totalLine.test(label) || prohibited.test(label) || metadata.test(label)) continue;
    const current = matches.length > 1 ? matches[matches.length - 2].value : matches[0].value;
    const previous = matches.length > 1 ? matches[matches.length - 1].value : null;
    const key = `${section}|${holder}|${label}|${current}|${previous}`.toLowerCase();
    if (!seen.has(key)) { seen.add(key); rows.push(makeRow(source, section, holder, accountType || label, label, current, previous)); }
  }
  return rows;
}

function normalize(value: unknown) { return String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " "); }
export function parseTabularRows(data: unknown[][], source: string): ParsedRow[] {
  if (data.length < 2) return [];
  const headers = data[0].map(normalize);
  const find = (...names: string[]) => headers.findIndex((h) => names.some((name) => h === name || h.includes(name)));
  const descriptionIndex = find("description", "account name", "name");
  const holderIndex = find("holder", "entity", "institution", "bank");
  const accountIndex = find("account type", "account name");
  const sectionIndex = find("section", "asset / liability", "asset/liability", "type");
  const categoryIndex = find("category");
  const currentIndex = find("current value", "current period", "amount", "balance");
  const previousIndex = find("previous value", "prior period", "previous", "prior");
  const cashIndex = find("cash"); const investmentsIndex = find("investments");
  if (descriptionIndex < 0 || sectionIndex < 0 || (currentIndex < 0 && cashIndex < 0 && investmentsIndex < 0)) return [];
  return data.slice(1).flatMap((values) => {
    const description = String(values[descriptionIndex] ?? "").trim();
    const rawSection = String(values[sectionIndex] ?? "").trim();
    if (!description || totalLine.test(description) || prohibited.test(description) || !/^(asset|liabilit)/i.test(rawSection)) return [];
    const kind: Kind = /^liabilit/i.test(rawSection) ? "Liability" : "Asset";
    const holder = holderIndex >= 0 ? String(values[holderIndex] ?? "").trim() : "";
    const account = accountIndex >= 0 ? String(values[accountIndex] ?? description).trim() : description;
    const previous = previousIndex >= 0 ? parseAmount(String(values[previousIndex] ?? "")) : null;
    const result: ParsedRow[] = [];
    const cash = cashIndex >= 0 ? parseAmount(String(values[cashIndex] ?? "")) : null;
    const investments = investmentsIndex >= 0 ? parseAmount(String(values[investmentsIndex] ?? "")) : null;
    if (cash !== null) result.push(makeRow(source, kind, holder, account, `${description} — Cash`, cash, null, "Cash & Bank Accounts"));
    if (investments !== null) result.push(makeRow(source, kind, holder, account, `${description} — Investments`, investments, null, "Investments"));
    if (result.length) return result;
    const current = parseAmount(String(values[currentIndex] ?? "")); if (current === null) return [];
    const rawCategory = String(values[categoryIndex] ?? "").trim();
    return [makeRow(source, kind, holder, account, description, current, previous, rawCategory ? inferCategory(`${rawCategory} ${description}`, kind) : undefined)];
  });
}

async function parseSpreadsheet(file: File) { const XLSX = await import("xlsx"); const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false }); return book.SheetNames.flatMap((name) => parseTabularRows(XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: "" }), file.name)); }
async function createOcrWorker(progress: Progress) { const { createWorker } = await import("tesseract.js"); return createWorker("eng", 1, { workerPath: "/ocr/worker.min.js", corePath: "/ocr/core", langPath: "/ocr/lang", logger: (m) => { if (m.status === "recognizing text") progress(`Reading scan… ${Math.round((m.progress || 0) * 100)}%`); } }); }
async function parseImage(file: File, progress: Progress) { const worker = await createOcrWorker(progress); try { return parseFinancialText((await worker.recognize(file)).data.text, file.name); } finally { await worker.terminate(); } }
async function parsePdf(file: File, progress: Progress) { const pdfjs = await import("pdfjs-dist"); pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs"; const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; const rows: ParsedRow[] = []; let worker: Awaited<ReturnType<typeof createOcrWorker>> | null = null; try { for (let n=1;n<=Math.min(pdf.numPages,25);n++) { progress(`Reading PDF page ${n} of ${Math.min(pdf.numPages,25)}…`); const page=await pdf.getPage(n); const content=await page.getTextContent(); let text=content.items.map((item)=>"str" in item ? `${item.str}${"hasEOL" in item && item.hasEOL ? "\n":" "}`:"").join("").trim(); if(text.length<40){const viewport=page.getViewport({scale:2});const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext("2d");if(!context)continue;await page.render({canvasContext:context,viewport,canvas}).promise;worker ||= await createOcrWorker(progress);text=(await worker.recognize(canvas)).data.text;} rows.push(...parseFinancialText(text,file.name)); } } finally { await worker?.terminate(); await pdf.destroy(); } return rows; }
export async function parseDocument(file: File, progress: Progress): Promise<ParsedRow[]> { const extension=file.name.split(".").pop()?.toLowerCase(); if(file.size>10*1024*1024)throw new Error(`${file.name} exceeds the 10 MB limit.`);if(["csv","xlsx","xls"].includes(extension||""))return parseSpreadsheet(file);if(extension==="pdf")return parsePdf(file,progress);if(["jpg","jpeg","png"].includes(extension||""))return parseImage(file,progress);throw new Error(`${file.name} is not a supported statement format.`); }
