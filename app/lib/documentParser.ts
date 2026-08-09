export type Kind = "Asset" | "Liability";

export type ParsedRow = {
  id: string;
  include: boolean;
  investor: string;
  investorId?: string;
  category: string;
  institution: string;
  description: string;
  current: number | "";
  previous: number | null;
  kind: Kind;
  source: string;
};

type Progress = (message: string) => void;

const amountPattern = /(?:CAD|USD|\$)?\s*\(?-?\d[\d,]*(?:\.\d{1,2})?\)?/g;
const ignoredLine = /^(page|total pages|date|currency|account number|statement|market value|book value|quantity|price|confidential|continued)/i;
const liabilityWords = /mortgage|loan|credit card|line of credit|payable|owing|debt|liabilit|overdraft|tax due/i;
const accountWords = /margin|rrsp|spousal rrsp|tfsa|rrif|lira|lif|resp|chequ|saving|cash|portfolio|investment|mortgage|loan|credit card|property|real estate|vehicle|business/i;

function id() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function parseAmount(raw: string): number | null {
  const negative = /^\s*\(/.test(raw) || /-/.test(raw);
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

function inferCategory(description: string, kind: Kind) {
  const d = description.toLowerCase();
  if (/rrsp|tfsa|rrif|lira|lif|resp/.test(d)) return "Registered Accounts";
  if (/margin|portfolio|investment|brokerage|security|securities/.test(d)) return "Investments";
  if (/chequ|saving|cash|deposit|bank/.test(d)) return "Cash & Bank Accounts";
  if (/property|real estate|residence|home value/.test(d)) return "Real Estate";
  if (/mortgage/.test(d)) return "Mortgages";
  if (/credit card/.test(d)) return "Credit Cards";
  if (kind === "Liability" && /tax/.test(d)) return "Taxes Owing";
  if (kind === "Liability") return "Loans";
  return "Other";
}

function cleanDescription(line: string) {
  return line
    .replace(amountPattern, " ")
    .replace(/[|•]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[-–—:\s]+|[-–—:\s]+$/g, "")
    .trim();
}

export function parseFinancialText(text: string, source: string): ParsedRow[] {
  const institution = /national bank|bnc|nbc/i.test(text) ? "National Bank" : "";
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length < 4 || ignoredLine.test(line)) continue;
    const matches = [...line.matchAll(amountPattern)]
      .map((match) => ({ raw: match[0], index: match.index ?? 0, value: parseAmount(match[0]) }))
      .filter((match): match is { raw: string; index: number; value: number } => match.value !== null);
    if (!matches.length) continue;

    const description = cleanDescription(line.slice(0, matches[0].index) || line);
    if (description.length < 2 || /^\d+$/.test(description)) continue;
    if (!accountWords.test(description) && !liabilityWords.test(description) && matches.length < 2) continue;

    const current = matches.length > 1 ? matches[matches.length - 2].value : matches[0].value;
    const previous = matches.length > 1 ? matches[matches.length - 1].value : null;
    const kind: Kind = liabilityWords.test(description) ? "Liability" : "Asset";
    const normalizedCurrent = Math.abs(current);
    const normalizedPrevious = previous === null ? null : Math.abs(previous);
    const key = `${description.toLowerCase()}|${normalizedCurrent}|${normalizedPrevious}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: id(), include: true, investor: "",
      category: inferCategory(description, kind), institution,
      description, current: normalizedCurrent, previous: normalizedPrevious,
      kind, source,
    });
  }
  return rows;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
}

function parseTabularRows(data: unknown[][], source: string): ParsedRow[] {
  if (data.length < 2) return [];
  const headers = data[0].map(normalizeHeader);
  const find = (...names: string[]) => headers.findIndex((h) => names.some((name) => h === name || h.includes(name)));
  const descriptionIndex = find("description", "account name", "name");
  const institutionIndex = find("institution", "bank", "account");
  const categoryIndex = find("category");
  const typeIndex = find("type", "asset / liability", "asset/liability");
  const currentIndex = find("current value", "current period", "amount", "balance");
  const previousIndex = find("previous value", "prior period", "previous", "prior");
  const investorIndex = find("investor", "owner");
  if (descriptionIndex < 0 || currentIndex < 0) return [];

  return data.slice(1).flatMap((values) => {
    const description = String(values[descriptionIndex] ?? "").trim();
    const current = parseAmount(String(values[currentIndex] ?? ""));
    if (!description || current === null) return [];
    const rawType = String(values[typeIndex] ?? "asset");
    const kind: Kind = liabilityWords.test(rawType) ? "Liability" : "Asset";
    const prior = previousIndex >= 0 ? parseAmount(String(values[previousIndex] ?? "")) : null;
    return [{
      id: id(), include: true,
      investor: investorIndex >= 0 ? String(values[investorIndex] ?? "").trim() : "",
      category: String(values[categoryIndex] ?? "").trim() || inferCategory(description, kind),
      institution: String(values[institutionIndex] ?? "").trim(),
      description, current: Math.abs(current), previous: prior === null ? null : Math.abs(prior),
      kind, source,
    }];
  });
}

async function parseSpreadsheet(file: File): Promise<ParsedRow[]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  return workbook.SheetNames.flatMap((name) => {
    const data = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "" });
    return parseTabularRows(data, file.name);
  });
}

async function createOcrWorker(progress: Progress) {
  const { createWorker } = await import("tesseract.js");
  return createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    logger: (message) => {
      if (message.status === "recognizing text") progress(`Reading scan… ${Math.round((message.progress || 0) * 100)}%`);
    },
  });
}

async function ocrImage(image: File | HTMLCanvasElement, progress: Progress) {
  const worker = await createOcrWorker(progress);
  try {
    const result = await worker.recognize(image);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

async function parseImage(file: File, progress: Progress) {
  const text = await ocrImage(file, progress);
  return parseFinancialText(text, file.name);
}

async function parsePdf(file: File, progress: Progress) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";
  const pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const rows: ParsedRow[] = [];
  const maxPages = Math.min(pdfDocument.numPages, 25);
  let ocrWorker: Awaited<ReturnType<typeof createOcrWorker>> | null = null;

  try {
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      progress(`Reading PDF page ${pageNumber} of ${maxPages}…`);
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      const embeddedText = content.items.map((item) => "str" in item ? `${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : " "}` : "").join("").trim();
      let pageText = embeddedText;
      if (embeddedText.length < 40) {
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) continue;
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        ocrWorker ||= await createOcrWorker(progress);
        pageText = (await ocrWorker.recognize(canvas)).data.text;
      }
      rows.push(...parseFinancialText(pageText, file.name));
    }
  } finally {
    await ocrWorker?.terminate();
    await pdfDocument.destroy();
  }
  return rows;
}

export async function parseDocument(file: File, progress: Progress): Promise<ParsedRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} exceeds the 10 MB limit.`);
  if (extension === "csv" || extension === "xlsx" || extension === "xls") return parseSpreadsheet(file);
  if (extension === "pdf") return parsePdf(file, progress);
  if (["jpg", "jpeg", "png"].includes(extension || "")) return parseImage(file, progress);
  throw new Error(`${file.name} is not a supported statement format.`);
}
