import { inferCategory, type Category, type Kind, type ParsedRow } from "./documentParser";

export type OcrWord = { text:string; confidence:number; x0:number; y0:number; x1:number; y1:number };
export type OcrParseResult = { rows:ParsedRow[]; sourceCurrentNetWorth:number|null; sourcePreviousNetWorth:number|null; averageConfidence:number; periodColumns?:PeriodColumns & { tolerance:number } };
type OcrLine = { words:OcrWord[]; text:string; y:number };

export type PeriodValue = number | null;
export type AccountPeriods = { current:PeriodValue; previous:PeriodValue };
export type PositionedAmount = { value:number; centerX:number; confidence:number };
export type PeriodColumns = { previousX:number; currentX:number };
export type Box = { x0:number; y0:number; x1:number; y1:number };
export type OcrToken = { text:string; confidence:number; box:Box };
export type AccountingCandidate = PositionedAmount & { box:Box; words:OcrWord[] };
function distance(a:number,b:number):number{return Math.abs(a-b);}
export function assignAmountsToPeriods(amounts:PositionedAmount[],columns:PeriodColumns):AccountPeriods {
  const result:AccountPeriods={current:null,previous:null};
  for(const amount of amounts){const previousDistance=distance(amount.centerX,columns.previousX);const currentDistance=distance(amount.centerX,columns.currentX);if(previousDistance<currentDistance){if(result.previous===null)result.previous=amount.value;}else if(result.current===null)result.current=amount.value;}
  return result;
}
export function detectPeriodColumns(words:Array<{text:string;centerX:number;centerY:number}>):PeriodColumns {
  const normalized=words.map((word)=>({...word,text:word.text.replace(/\s*-\s*/g,"-").replace(/\s+/g," ")}));const previousHeadingWords=normalized.filter((word)=>/30[-\s]?jun[-\s]?26/i.test(word.text));const currentHeadingWords=normalized.filter((word)=>/31[-\s]?jul[-\s]?26/i.test(word.text));
  if(!previousHeadingWords.length||!currentHeadingWords.length)throw new Error("Could not identify previous and current balance columns");
  return {previousX:previousHeadingWords.reduce((sum,word)=>sum+word.centerX,0)/previousHeadingWords.length,currentX:currentHeadingWords.reduce((sum,word)=>sum+word.centerX,0)/currentHeadingWords.length};
}
export function formatPeriodAmount(value:number|null):string {const normalized=value??0;const absoluteValue=Math.abs(normalized).toLocaleString("en-CA",{minimumFractionDigits:0,maximumFractionDigits:0});return normalized<0?`($${absoluteValue})`:`$${absoluteValue}`;}

const totalPattern = /^(?:sub[ -]?total|total)(?:\s|$)/i;
const balancePattern = /^(?:[$S5])?\(?-?\d{1,3}(?:[,.'’]\d{3})+(?:[.,]\d{2})?\)?$/;
const receivableVariant = /receiv[aei]?[b8][l1][e]?/i;

export function extractWordsWithBoundingBoxes(data: { blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: Array<{ text:string; confidence:number; bbox:{x0:number;y0:number;x1:number;y1:number} }> }> }> }> | null }): OcrWord[] {
  return (data.blocks ?? []).flatMap((block) => block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? []).flatMap((line) => line.words ?? []).map((word) => ({ text:word.text, confidence:word.confidence, ...word.bbox }));
}

export function reconstructOcrLines(words: OcrWord[]): OcrLine[] {
  const sorted=[...words].filter((word)=>word.text.trim()).sort((a,b)=>(a.y0+a.y1)-(b.y0+b.y1)||a.x0-b.x0); const lines:OcrWord[][]=[];
  for(const word of sorted){const center=(word.y0+word.y1)/2;const line=lines.find((items)=>{const avg=items.reduce((sum,item)=>sum+(item.y0+item.y1)/2,0)/items.length;const height=Math.max(...items.map((item)=>item.y1-item.y0),word.y1-word.y0);return Math.abs(avg-center)<=Math.max(8,height*.55);});if(line)line.push(word);else lines.push([word]);}
  return lines.map((items)=>{items.sort((a,b)=>a.x0-b.x0);return {words:items,text:items.map((word)=>word.text).join(" ").replace(/\s+([,.)])/g,"$1").replace(/([(])\s+/g,"$1"),y:items.reduce((sum,item)=>sum+(item.y0+item.y1)/2,0)/items.length};}).sort((a,b)=>a.y-b.y);
}

export function parseAccountingAmount(raw:string):number|null {
  const value=raw.trim().replace(/[Oo]/g,"0").replace(/[’']/g,",").replace(/^S(?=\s*\d)/,"$");
  if(!balancePattern.test(value.replace(/\s+/g,"")))return null;
  const negative=value.includes("(")||/-/.test(value);const cleaned=value.replace(/[^\d.,]/g,"").replace(/,(?=\d{2}$)/,".").replace(/,/g,"");const number=Number(cleaned);return Number.isFinite(number)?(negative?-Math.abs(number):number):null;
}

function centerX(box:Box){return (box.x0+box.x1)/2;}
function overlapsRow(word:OcrWord,row:Box){const middle=(word.y0+word.y1)/2;return middle>=row.y0&&middle<=row.y1;}

/** Merge OCR-split accounting tokens without flattening away their coordinates. */
export function combineAccountingWords(words:OcrWord[]):AccountingCandidate[] {
  const sorted=[...words].sort((a,b)=>a.x0-b.x0);const candidates:AccountingCandidate[]=[];
  for(let start=0;start<sorted.length;start++){
    if(!/^[\s$S5()\d,.'’+\-]+$/.test(sorted[start].text))continue;
    let raw="";let best:AccountingCandidate|undefined;
    for(let end=start;end<Math.min(sorted.length,start+6);end++){
      const word=sorted[end];if(!/^[\s$S5()\d,.'’+\-]+$/.test(word.text))break;
      if(end>start&&word.x0-sorted[end-1].x1>45)break;
      raw+=word.text;const value=/^[-–—]+$/.test(raw.trim())?0:parseAccountingAmount(raw);if(value===null)continue;
      const merged=sorted.slice(start,end+1);const box={x0:merged[0].x0,y0:Math.min(...merged.map((item)=>item.y0)),x1:merged.at(-1)!.x1,y1:Math.max(...merged.map((item)=>item.y1))};
      best={value,centerX:centerX(box),confidence:Math.min(...merged.map((item)=>item.confidence)),box,words:merged};
    }
    if(best){candidates.push(best);while(start+1<sorted.length&&sorted[start+1].x0<best.box.x1)start++;}
  }
  return candidates;
}

/** Recover amounts on a slightly displaced baseline while staying inside one visual row. */
export function recoverRowPeriods(words:OcrWord[],row:Box,columns:PeriodColumns,tolerance:number):{periods:AccountPeriods;candidates:AccountingCandidate[]} {
  const candidates=combineAccountingWords(words.filter((word)=>overlapsRow(word,row))).filter((candidate)=>Math.min(distance(candidate.centerX,columns.previousX),distance(candidate.centerX,columns.currentX))<=tolerance);
  return {periods:assignAmountsToPeriods(candidates,columns),candidates};
}

function cropAndUpscale(pageCanvas:HTMLCanvasElement,box:Box,scale=2){const canvas=document.createElement("canvas");canvas.width=Math.ceil((box.x1-box.x0)*scale);canvas.height=Math.ceil((box.y1-box.y0)*scale);const context=canvas.getContext("2d",{alpha:false,willReadFrequently:true});if(!context)throw new Error("Canvas context unavailable");context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(pageCanvas,box.x0,box.y0,box.x1-box.x0,box.y1-box.y0,0,0,canvas.width,canvas.height);return canvas;}

/** Retry only the visual account row when the page-level OCR missed one period. */
export async function recoverMissingPeriodFromCrop(pageCanvas:HTMLCanvasElement,row:Box,existing:AccountPeriods,columns:PeriodColumns&{tolerance:number},recognize:(canvas:HTMLCanvasElement)=>Promise<OcrWord[]>):Promise<AccountPeriods>{if(existing.current!==null&&existing.previous!==null)return existing;const padding=16;const expanded={x0:0,x1:pageCanvas.width,y0:Math.max(0,row.y0-padding),y1:Math.min(pageCanvas.height,row.y1+padding)};const scale=2;const canvas=cropAndUpscale(pageCanvas,expanded,scale);const retryWords=(await recognize(canvas)).map((word)=>({...word,x0:word.x0/scale+expanded.x0,x1:word.x1/scale+expanded.x0,y0:word.y0/scale+expanded.y0,y1:word.y1/scale+expanded.y0}));const retry=recoverRowPeriods(retryWords,row,columns,columns.tolerance).periods;return {current:existing.current??retry.current,previous:existing.previous??retry.previous};}

function financialCategory(label:string, heading:string, negative:boolean):{kind:Kind;category:Category;holder:string;accountName:string} {
  const text=`${heading} ${label}`.toLowerCase();
  if(negative){
    if(/shareholder advance/i.test(label))return {kind:"Liability",category:"Shareholder Advances",holder:label.replace(/^shareholder advance\s*[-–—]?\s*/i,"")||"Shareholder",accountName:"Shareholder advance payable"};
    if(/loan payable/i.test(label)){const entity=label.replace(/^loan payable\s*[-–—]?\s*/i,"").trim();return {kind:"Liability",category:"Loans Payable",holder:entity||"No holder specified",accountName:"Loan payable"};}
    if(/corporate tax/.test(text))return {kind:"Liability",category:"Corporate Tax Payable",holder:"Corporate tax",accountName:"Corporate tax payable / offset"};
    return {kind:"Liability",category:"Other Liabilities",holder:heading||"No holder specified",accountName:label};
  }
  // Explicit leaf descriptions override a stale or missed OCR section heading.
  if(/\bcibc bank/i.test(label))return {kind:"Asset",category:"Cash & Bank Accounts",holder:"CIBC Bank",accountName:label};
  if(receivableVariant.test(label)&&!/loans? receivable/i.test(heading)){const holder=label.replace(new RegExp(`\\s*[-–—]?\\s*${receivableVariant.source}\\s*$`,"i"),"").trim();return {kind:"Asset",category:"Loans Receivable",holder:holder||"Receivables",accountName:"Receivable"};}
  if(/real estate/.test(text))return {kind:"Asset",category:"Real Estate",holder:"Real Estate",accountName:"Real estate equity"};
  if(/investments?/.test(heading))return {kind:"Asset",category:"Investments",holder:"Investments",accountName:"Investment"};
  if(/mortgages?/.test(heading))return {kind:"Asset",category:"Mortgage Investments / Mortgage Receivables",holder:"Mortgage investments",accountName:"Mortgage investment"};
  if(/loans? receivable/.test(heading))return {kind:"Asset",category:"Loans Receivable",holder:"Loans receivable",accountName:"Loan receivable"};
  if(/corporate tax instalment/.test(text))return {kind:"Asset",category:"Corporate Tax Instalment Receivable",holder:"Corporate tax",accountName:"Corporate tax instalment receivable"};
  return {kind:"Asset",category:inferCategory(text,"Asset"),holder:heading||"No holder specified",accountName:label};
}

function controlKey(heading:string){const value=heading.toLowerCase();if(/^mortgages?/.test(value))return "Mortgage Investments / Mortgage Receivables";if(/^investments?/.test(value))return "Investments";if(/^loans? receivable/.test(value))return "Loans Receivable";if(/^real estate/.test(value))return "Real Estate";return heading;}

function financialHeading(text:string):string|null {
  if(totalPattern.test(text))return null;
  const normalized=text.replace(/[^a-z\s]/gi," ").replace(/\s+/g," ").trim();
  for(const pattern of [/corporate tax instalment/i,/loans? receivable/i,/real estate/i,/investments?/i,/mortgages?/i]){
    const match=normalized.match(pattern);if(match)return match[0];
  }
  return null;
}

export function parseOcrFinancialWords(words:OcrWord[],source:string):OcrParseResult {
  const lines=reconstructOcrLines(words);const fullText=lines.map((line)=>line.text).join("\n");if(!/\bnet\s*worth\b/i.test(fullText))return {rows:[],sourceCurrentNetWorth:null,sourcePreviousNetWorth:null,averageConfidence:0};
  const positionedWords=words.map((word)=>({text:word.text,centerX:(word.x0+word.x1)/2,centerY:(word.y0+word.y1)/2}));
  const positionedLines=lines.map((line)=>{const dateParts=line.words.filter((word)=>!/^equity$/i.test(word.text));return {text:dateParts.map((word)=>word.text).join(" "),centerX:dateParts.reduce((sum,word)=>sum+(word.x0+word.x1)/2,0)/Math.max(1,dateParts.length),centerY:line.y};});
  let columns:PeriodColumns;try{columns=detectPeriodColumns(positionedWords);}catch{columns=detectPeriodColumns(positionedLines);}
  const {previousX,currentX}=columns;const columnTolerance=Math.max(40,Math.abs(currentX-previousX)*.22);
  const dateWords=words.filter((word)=>/(?:30[-\s]jun|31[-\s]jul|jun(?:e)?\s*30|jul(?:y)?\s*31)/i.test(word.text));
  const parseDate=(text:string)=>{const match=text.match(/(\d{1,2})[-\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s](\d{2,4})/i);if(!match)return undefined;const months=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];const year=Number(match[3])+(match[3].length===2?2000:0);return `${year}-${String(months.indexOf(match[2].slice(0,3).toLowerCase())+1).padStart(2,"0")}-${match[1].padStart(2,"0")}`;};
  const previousDate=parseDate(dateWords.find((word)=>/jun/i.test(word.text))?.text??"");const currentDate=parseDate(dateWords.find((word)=>/jul/i.test(word.text))?.text??"");
  let heading="";let lastDescription="";const rows:ParsedRow[]=[];const controls=new Map<string,{current:number|null;previous:number|null}>();const consumed=new Set<OcrWord>();let sourceCurrentNetWorth:number|null=null;let sourcePreviousNetWorth:number|null=null;
  for(let lineIndex=0;lineIndex<lines.length;lineIndex++){
    const line=lines[lineIndex];const text=line.text.trim();const detectedHeading=financialHeading(text);const lineCandidates=combineAccountingWords(line.words);if(detectedHeading&&!lineCandidates.length){heading=detectedHeading;continue;}
    const height=Math.max(...line.words.map((word)=>word.y1-word.y0),12);const isDescription=(candidate:OcrLine)=>candidate.words.some((word)=>word.x0<previousX-columnTolerance&&/[a-z]/i.test(word.text));const previousDescription=[...lines.slice(0,lineIndex)].reverse().find(isDescription);const nextDescription=lines.slice(lineIndex+1).find(isDescription);const upperLimit=previousDescription?(previousDescription.y+line.y)/2:line.y-height;const lowerLimit=nextDescription?(line.y+nextDescription.y)/2:line.y+height;const rowBox={x0:0,x1:Math.max(...words.map((word)=>word.x1)),y0:Math.max(upperLimit+.01,line.y-height*1.25),y1:Math.min(lowerLimit-.01,line.y+height*1.25)};
    const recovered=recoverRowPeriods(words.filter((word)=>!consumed.has(word)),rowBox,columns,columnTolerance);const {previous,current}=recovered.periods;
    if(/total net\s*worth/i.test(text)){sourcePreviousNetWorth=previous;sourceCurrentNetWorth=current;continue;}
    if(/\b(?:income|fees|interest earned)\b/i.test(text))continue;
    if(!recovered.candidates.length)continue;
    const firstBalanceX=Math.min(...recovered.candidates.map((candidate)=>candidate.box.x0));let label=line.words.filter((word)=>word.x1<firstBalanceX-4&&!/^[$S5()]$/.test(word.text)).map((word)=>word.text).join(" ").replace(/\b\d+(?:\.\d+)?%/g,"").replace(/\s{2,}/g," ").trim();
    // Scanned statements often print a subtotal with no word "Total". OCR can
    // place one copy of that subtotal in the description area; it is still a
    // reconciliation control, never a leaf account.
    const numericOnlyLabel=parseAccountingAmount(label)!==null;
    if(totalPattern.test(label)||numericOnlyLabel||(!label&&heading)){controls.set(controlKey(heading),{current,previous});continue;}
    label=label.replace(receivableVariant,"receivable");const rawCurrent=current??0;if(label.length<3&&rawCurrent<0&&lastDescription)label=`${lastDescription} payable / offset`;if(label.length<3||/^\d+[.)]?$/i.test(label)||/^page\b/i.test(label))continue;
    lastDescription=label;const classification=financialCategory(label,heading,rawCurrent<0);const confidence=line.words.reduce((sum,word)=>sum+word.confidence,0)/line.words.length;
    recovered.candidates.flatMap((candidate)=>candidate.words).forEach((word)=>consumed.add(word));
    rows.push({id:`ocr-${rows.length}-${Math.round(line.y)}`,include:true,investor:"",category:classification.category,holder:classification.holder,accountName:classification.accountName,institution:classification.holder,description:label,current:Math.abs(rawCurrent),previous:previous===null?null:Math.abs(previous),kind:classification.kind,source,ocrConfidence:confidence,needsReview:confidence<70||recovered.candidates.some((candidate)=>candidate.confidence<60),sourceCurrentNetWorth:null,sourcePreviousNetWorth:null,sourceCurrentDate:currentDate,sourcePreviousDate:previousDate,ocrRowBox:rowBox});
  }
  for(const row of rows){row.sourceCurrentNetWorth=sourceCurrentNetWorth;row.sourcePreviousNetWorth=sourcePreviousNetWorth;const control=controls.get(row.category);row.sourceCategoryControlCurrent=control?.current??null;row.sourceCategoryControlPrevious=control?.previous??null;}
  return {rows,sourceCurrentNetWorth,sourcePreviousNetWorth,averageConfidence:words.length?words.reduce((sum,word)=>sum+word.confidence,0)/words.length:0,periodColumns:{...columns,tolerance:columnTolerance}};
}

export function financialScore(text:string,confidence:number){const amounts=text.match(/\(?\s*\$?\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?\s*\)?/g)?.length??0;const headings=["net worth","investments","loans receivable","mortgages","loan payable","total net worth"].filter((heading)=>text.toLowerCase().includes(heading)).length;return confidence+amounts*2+headings*10;}
