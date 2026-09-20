import type { PDFPageProxy } from "pdfjs-dist";

export type Kind = "Asset" | "Liability";
export type AssetCategory = "Cash & Bank Accounts" | "Investments" | "Mortgage Investments / Mortgage Receivables" | "Loans Receivable" | "Corporate Tax Instalment Receivable" | "Other Receivables" | "Vehicles" | "Insurance Cash Value" | "Inherited Assets" | "Real Estate" | "Other Assets";
export type LiabilityCategory = "Corporate Tax Payable" | "Loans Payable" | "Shareholder Advances" | "Mortgages Payable" | "Taxes Owing" | "Accounts Payable" | "Credit Cards" | "Other Liabilities";
/** Built-in categories remain suggested, while reconciled rows may use a user-defined category. */
export type Category = AssetCategory | LiabilityCategory | (string & {});

export type ParsedRow = {
  id: string; include: boolean; investor: string; investorId?: string;
  statementId?: string; ownershipPercentage?: number;
  rowOwnershipOverride?: number | null; manuallyCreated?: boolean;
  rawCurrent?: number | ""; rawPrevious?: number | null;
  category: Category; holder: string; accountName: string; institution: string;
  description: string; current: number | ""; previous: number | null;
  kind: Kind; source: string;
  ocrConfidence?: number; needsReview?: boolean;
  accountNumber?: string; sourcePage?: number; sourceInvestor?: string;
  sourceSubaccounts?: string[];
  manuallyReviewRequired?: boolean; isLeafAccount?: boolean; isSourceTotal?: boolean;
  sourceCurrentNetWorth?: number | null; sourcePreviousNetWorth?: number | null;
  sourceCurrentDate?: string; sourcePreviousDate?: string;
  sourceCategoryControlCurrent?: number | null; sourceCategoryControlPrevious?: number | null;
  ocrRowBox?: { x0:number; y0:number; x1:number; y1:number };
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
  if (/corporate tax/.test(d)) return "Corporate Tax Payable";
  if (/shareholder advance/.test(d)) return "Shareholder Advances";
  if (/tax/.test(d)) return "Taxes Owing";
  if (/accounts? payable|trade payable/.test(d)) return "Accounts Payable";
  if (/credit card|visa|mastercard|amex/.test(d)) return "Credit Cards";
  if (/loan|line of credit/.test(d)) return "Loans Payable";
  return "Other Liabilities";
}

function makeRow(source: string, kind: Kind, holder: string, accountName: string, description: string, current: number, previous: number | null, category?: Category): ParsedRow {
  return { id: id(), include: true, investor: "", category: category ?? inferCategory(`${accountName} ${description} ${holder}`, kind), holder, accountName, institution: holder, description, current: Math.abs(current), previous: previous === null ? null : Math.abs(previous), kind, source, isLeafAccount:true, isSourceTotal:false };
}

export type PortfolioEvaluationPage = { text:string; pageNumber:number; confidence?:number };

const woodGundyInstitution = "CIBC Private Wealth Wood Gundy";
export function findWoodGundyAccountNumber(value:string):string|null {
  const explicit=value.match(/account\s*(?:number|n[o0]\.?|#)?\s*:?\s*([0-9OIlS][0-9OIlS\s-]{6,18}[0-9OIlS](?:\s*[A-Z])?)/i);
  const candidates=explicit?[explicit[1]]:[...value.matchAll(/\b([0-9OIlS](?:[0-9OIlS -]*[0-9OIlS])?(?:\s*[A-Z])?)\b/gi)].map((match)=>match[1]);
  for(const candidate of candidates){if(/[,$.%]/.test(candidate))continue;const normalized=candidate.replace(/[Oo]/g,"0").replace(/[Il]/g,"1").replace(/S/g,"5").replace(/[\s-]/g,"").toUpperCase();const digits=normalized.replace(/\D/g,"");if(digits.length>=8&&digits.length<=10&&/^\d{8,10}[A-Z]?$/.test(normalized))return normalized;}
  return null;
}

export function normalizeWoodGundyAccountType(value:string):string|null {
  const normalized=value.replace(/0/g,"O").replace(/[|1]/g,"I").replace(/[-_]+/g," ");
  if(/\bsp[o0]usal\s+(?:r\s*r?\s*s\s*p|r\s*s\s*p|registered retirement savings plan)\b/i.test(normalized))return "Spousal RRSP";
  if(/\b(?:registered retirement savings plan|r\s*r\s*s\s*p)\b/i.test(normalized))return "RRSP";
  if(/\b(?:tax\s*free savings account|t\s*f\s*s\s*a)\b/i.test(normalized))return "TFSA";
  if(/\b(?:non\s*regist(?:ered|fred)|cash(?:\s+account)?)\b/i.test(normalized))return "Non-registered / Cash";
  return null;
}

function portfolioValue(lines:string[],index:number):number|null {
  for(let offset=0;offset<3;offset++){
    const candidate=lines[index+offset]??"";const segment=offset===0?(candidate.split(/total\s+portfolio\s+value/i)[1]??""):candidate;
    const amounts=[...segment.matchAll(/(?:CAD|USD|\$)?\s*\(?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\)?/gi)].map((match)=>parseAmount(match[0])).filter((value):value is number=>value!==null);
    if(amounts.length)return amounts.at(-1)!;
  }
  return null;
}

/**
 * Portfolio Evaluation reports are account summaries. Their final Total
 * Portfolio Value is authoritative; security holdings and allocation totals
 * are deliberately retained only in the source document.
 */
export function parseWoodGundyPortfolioPages(pages:PortfolioEvaluationPage[],source:string):ParsedRow[] {
  const documentText=pages.map((page)=>page.text).join("\n");
  if(!/(?:CIBC\s+Private\s+Wealth|Wood\s+Gundy)/i.test(documentText)||!/Portfolio\s+Evaluation/i.test(documentText))return [];
  type Context={accountNumber:string;accountType:string;investor:string;subaccounts:Set<string>};
  const results=new Map<string,ParsedRow>();let context:Context|null=null;let investor="";
  for(const page of pages){
    const lines=page.text.replace(/\s+(?=Account\s*(?:Number|N[o0]\.?|#))/gi,"\n").split(/\r?\n/).map((line)=>line.replace(/\s+/g," ").trim()).filter(Boolean);let inAccountDetails=false;
    for(let index=0;index<lines.length;index++){
      const line=lines[index];
      const named=line.match(/^(?:investor|client|account holder|account name)\s*:?\s*(.+)$/i);if(named&&!/number|type/i.test(named[1]))investor=cleanLabel(named[1]);
      if(/account details/i.test(line)){inAccountDetails=true;continue;}
      const window=lines.slice(index,Math.min(lines.length,index+5)).join(" ");const accountNumber=findWoodGundyAccountNumber(line);const type=normalizeWoodGundyAccountType(window);
      const explicitAccount=/account\s*(?:number|n[o0]\.?|#)/i.test(line);const financialLine=/[$,%]|\b(?:total|value|income|gain|loss)\b/i.test(line);
      if(accountNumber&&(explicitAccount||(!financialLine&&!inAccountDetails))){
        if(!context||context.accountNumber!==accountNumber)context={accountNumber,accountType:type??"Unclassified investment account",investor,subaccounts:new Set()};else if(type)context.accountType=type;
        inAccountDetails=false;
      }else if(inAccountDetails&&accountNumber&&context&&accountNumber!==context.accountNumber){context.subaccounts.add(accountNumber);}
      if(!context||!/total\s+portfolio\s+value/i.test(line))continue;
      const current=portfolioValue(lines,index);if(current===null)continue;
      const confidence=page.confidence??100;const account=context;
      const evidence=.35+.35+(account.accountType!=="Unclassified investment account"?.2:0)+.1;const review=confidence<70||evidence<.7||account.accountType==="Unclassified investment account";
      results.set(account.accountNumber,{...makeRow(source,"Asset",woodGundyInstitution,account.accountType,`CIBC Wood Gundy - ${account.accountType} ${account.accountNumber}`,current,null,"Investments"),rawCurrent:current,rawPrevious:null,ownershipPercentage:100,accountNumber:account.accountNumber,sourcePage:page.pageNumber,sourceInvestor:account.investor||undefined,sourceSubaccounts:[...account.subaccounts],ocrConfidence:Math.min(100,confidence*evidence),needsReview:review,manuallyReviewRequired:review});
    }
  }
  return [...results.values()];
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
async function decodeImage(file:File){const bitmap=await createImageBitmap(file);const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext("2d",{alpha:false,willReadFrequently:true});if(!context)throw new Error("Image canvas unavailable");context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0);bitmap.close();return canvas;}
function cropCanvas(source:HTMLCanvasElement,y0:number,y1:number){const canvas=document.createElement("canvas");canvas.width=source.width;canvas.height=y1-y0;const context=canvas.getContext("2d",{alpha:false,willReadFrequently:true});if(!context)throw new Error("Image canvas unavailable");context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(source,0,y0,source.width,y1-y0,0,0,source.width,y1-y0);return canvas;}
/** Split a tall multi-page scan only at a substantial near-white horizontal gutter. */
export function findImageRegionBreaks(pixels:Uint8ClampedArray,width:number,height:number){if(height<=width*1.55)return [0,height];const rowInk=(y:number)=>{let ink=0;for(let x=0;x<width;x+=4){const offset=(y*width+x)*4;if(pixels[offset]<235||pixels[offset+1]<235||pixels[offset+2]<235)ink++;}return ink/Math.ceil(width/4);};const minimum=Math.max(10,Math.round(height*.008));const bands:Array<{start:number;end:number}>=[];let start=-1;for(let y=Math.round(width*.7);y<height-Math.round(width*.25);y++){if(rowInk(y)<.004){if(start<0)start=y;}else if(start>=0){if(y-start>=minimum)bands.push({start,end:y});start=-1;}}if(start>=0&&height-start>=minimum)bands.push({start,end:height});const preferred=bands.filter((band)=>band.start>=height*.45).sort((a,b)=>Math.abs((a.start+a.end)/2-width*1.3)-Math.abs((b.start+b.end)/2-width*1.3))[0];return preferred?[0,Math.round((preferred.start+preferred.end)/2),height]:[0,height];}
function imageRegions(canvas:HTMLCanvasElement){const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)return [canvas];const breaks=findImageRegionBreaks(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);return breaks.slice(0,-1).map((start,index)=>cropCanvas(canvas,start,breaks[index+1])).filter((region)=>region.height>40);}
function upscaleImageCanvas(source:HTMLCanvasElement){const scale=Math.max(1,Math.min(3,2000/source.width));if(scale===1)return source;const canvas=document.createElement("canvas");canvas.width=Math.round(source.width*scale);canvas.height=Math.round(source.height*scale);const context=canvas.getContext("2d",{alpha:false,willReadFrequently:true});if(!context)throw new Error("Image canvas unavailable");context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.imageSmoothingEnabled=true;context.imageSmoothingQuality="high";context.drawImage(source,0,0,canvas.width,canvas.height);return canvas;}
function rotateImageCanvas(source:HTMLCanvasElement,rotation:number){if(rotation===0)return source;const radians=rotation*Math.PI/180;const canvas=document.createElement("canvas");const swap=rotation%180!==0;canvas.width=swap?source.height:source.width;canvas.height=swap?source.width:source.height;const context=canvas.getContext("2d",{alpha:false,willReadFrequently:true});if(!context)throw new Error("Image canvas unavailable");context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.translate(canvas.width/2,canvas.height/2);context.rotate(radians);context.drawImage(source,-source.width/2,-source.height/2);return canvas;}
async function parseImage(file: File, progress: Progress) {
  const {extractWordsWithBoundingBoxes,financialScore,parseOcrFinancialWords,reconstructOcrLines,recoverMissingPeriodFromCrop}=await import("./ocrFinancialParser");const source=await decodeImage(file);const regions=imageRegions(source);const worker=await createOcrWorker(progress);const rows:ParsedRow[]=[];const portfolioPages:PortfolioEvaluationPage[]=[];
  try {for(let index=0;index<regions.length;index++){const prepared=upscaleImageCanvas(regions[index]);let best:{score:number;text:string;confidence:number;words:ReturnType<typeof extractWordsWithBoundingBoxes>;canvas:HTMLCanvasElement}|undefined;for(const rotation of rotationCandidates(0)){progress(`OCR image region ${index+1} of ${regions.length} at ${rotation}°…`);const canvas=rotateImageCanvas(prepared,rotation);const result=await worker.recognize(canvas,{}, {text:true,blocks:true});const words=extractWordsWithBoundingBoxes(result.data);const text=result.data.text||"";const score=financialScore(text,result.data.confidence||0);if(!best||score>best.score)best={score,text,confidence:result.data.confidence||0,words,canvas};}if(!best||(!best.words.length&&!best.text.trim()))continue;const positionedText=best.words.length?reconstructOcrLines(best.words).map((line)=>line.text).join("\n"):"";portfolioPages.push({text:[positionedText,best.text].filter(Boolean).join("\n"),pageNumber:index+1,confidence:best.confidence});if(!best.words.length)continue;const parsed=parseOcrFinancialWords(best.words,file.name);parsed.rows.forEach((row)=>{row.sourcePage=index+1;});if(parsed.periodColumns){for(const row of parsed.rows.filter((item)=>(item.current===""||item.previous===null)&&item.ocrRowBox)){const recovered=await recoverMissingPeriodFromCrop(best.canvas,row.ocrRowBox!,{current:row.current===""?null:Number(row.current),previous:row.previous},parsed.periodColumns,async(canvas)=>extractWordsWithBoundingBoxes((await worker.recognize(canvas,{}, {text:false,blocks:true})).data));row.current=recovered.current===null?"":Math.abs(recovered.current);row.previous=recovered.previous===null?null:Math.abs(recovered.previous);row.needsReview=row.current===""||row.previous===null||row.needsReview;}}rows.push(...parsed.rows);}}
  finally {await worker.terminate();}
  const portfolio=parseWoodGundyPortfolioPages(portfolioPages,file.name);if(portfolio.length)return portfolio;if(!rows.length)throw new Error("OCR completed, but no account candidates were found in this image. The statement remains available for manual review.");return rows;
}
export function rotationCandidates(baseRotation:number){return [0,90,180,270].map((extra)=>(baseRotation+extra)%360);}
export function shouldUseOcr(embeddedRows:ParsedRow[]){return embeddedRows.length===0;}
async function renderPage(page:PDFPageProxy,rotation:number){const viewport=page.getViewport({scale:4,rotation});const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext("2d",{alpha:false,willReadFrequently:true});if(!context)throw new Error("Canvas context unavailable");context.fillStyle="#ffffff";context.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:context,viewport,canvas,background:"#ffffff"}).promise;return canvas;}
async function parsePdf(file: File, progress: Progress) {
  const pdfjs = await import("pdfjs-dist");
  const { extractWordsWithBoundingBoxes, financialScore, parseOcrFinancialWords, reconstructOcrLines, recoverMissingPeriodFromCrop } = await import("./ocrFinancialParser");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data:new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages=[];const embeddedRows:ParsedRow[]=[];const embeddedPages:PortfolioEvaluationPage[]=[];
  try {
    for(let n=1;n<=pdf.numPages;n++){progress(`Reading PDF text page ${n} of ${pdf.numPages}…`);const page=await pdf.getPage(n);pages.push(page);const content=await page.getTextContent();const text=content.items.map((item)=>"str" in item?`${item.str}${"hasEOL" in item&&item.hasEOL?"\n":" "}`:"").join("");embeddedPages.push({text,pageNumber:n,confidence:100});embeddedRows.push(...parseFinancialText(text,file.name));}
    const embeddedPortfolio=parseWoodGundyPortfolioPages(embeddedPages,file.name);if(embeddedPortfolio.length)return embeddedPortfolio;
    if(!shouldUseOcr(embeddedRows))return embeddedRows;
    const worker=await createOcrWorker(progress);const rows:ParsedRow[]=[];const portfolioPages:PortfolioEvaluationPage[]=[];
    try {
      for(let index=0;index<pages.length;index++){const page=pages[index];let best:{score:number;text:string;confidence:number;words:ReturnType<typeof extractWordsWithBoundingBoxes>;canvas:HTMLCanvasElement}|undefined;
        for(const rotation of rotationCandidates(page.rotate||0)){progress(`OCR page ${index+1} of ${pages.length} at ${rotation}°…`);const canvas=await renderPage(page,rotation);const result=await worker.recognize(canvas,{}, {text:true,blocks:true});const words=extractWordsWithBoundingBoxes(result.data);const text=result.data.text||"";const score=financialScore(text,result.data.confidence||0);if(!best||score>best.score)best={score,text,confidence:result.data.confidence||0,words,canvas};}
        if(!best||(!best.words.length&&!best.text.trim()))continue;const positionedText=best.words.length?reconstructOcrLines(best.words).map((line)=>line.text).join("\n"):"";portfolioPages.push({text:[positionedText,best.text].filter(Boolean).join("\n"),pageNumber:index+1,confidence:best.confidence});if(!best.words.length)continue;let parsed;try{parsed=parseOcrFinancialWords(best.words,file.name);}catch{continue;}
        parsed.rows.forEach((row)=>{row.sourcePage=index+1;});if(parsed.periodColumns){for(const row of parsed.rows.filter((item)=>(item.current===""||item.previous===null)&&item.ocrRowBox)){progress(`Rechecking ${row.description} at higher resolution…`);const recovered=await recoverMissingPeriodFromCrop(best.canvas,row.ocrRowBox!,{current:row.current===""?null:Number(row.current),previous:row.previous},parsed.periodColumns,async(canvas)=>extractWordsWithBoundingBoxes((await worker.recognize(canvas,{}, {text:false,blocks:true})).data));row.current=recovered.current===null?"":Math.abs(recovered.current);row.previous=recovered.previous===null?null:Math.abs(recovered.previous);row.needsReview=row.current===""||row.previous===null||row.needsReview;}}
        rows.push(...parsed.rows);
      }
    } finally { await worker.terminate(); }
    const portfolio=parseWoodGundyPortfolioPages(portfolioPages,file.name);if(portfolio.length)return portfolio;
    if(!rows.length)throw new Error("OCR completed, but no account candidates were found. The statement remains available for manual review.");
    return rows;
  } finally { await pdf.destroy(); }
}
export async function parseDocument(file: File, progress: Progress): Promise<ParsedRow[]> { const extension=file.name.split(".").pop()?.toLowerCase(); if(file.size>10*1024*1024)throw new Error(`${file.name} exceeds the 10 MB limit.`);if(["csv","xlsx","xls"].includes(extension||""))return parseSpreadsheet(file);if(extension==="pdf")return parsePdf(file,progress);if(["jpg","jpeg","png"].includes(extension||""))return parseImage(file,progress);throw new Error(`${file.name} is not a supported statement format.`); }
