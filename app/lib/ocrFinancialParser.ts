import { inferCategory, type Category, type Kind, type ParsedRow } from "./documentParser";

export type OcrWord = { text:string; confidence:number; x0:number; y0:number; x1:number; y1:number };
export type OcrParseResult = { rows:ParsedRow[]; sourceCurrentNetWorth:number|null; sourcePreviousNetWorth:number|null; averageConfidence:number };
type OcrLine = { words:OcrWord[]; text:string; y:number };

const totalPattern = /^(?:sub[ -]?total|total)(?:\s|$)/i;
const balancePattern = /^(?:[$S5])?\(?-?\d{1,3}(?:[,.'’]\d{3})+(?:[.,]\d{2})?\)?$/;

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

function financialCategory(label:string, heading:string, negative:boolean):{kind:Kind;category:Category;holder:string;accountName:string} {
  const text=`${heading} ${label}`.toLowerCase();
  if(negative){
    if(/shareholder advance/i.test(label))return {kind:"Liability",category:"Shareholder Advances",holder:label.replace(/^shareholder advance\s*[-–—]?\s*/i,"")||"Shareholder",accountName:"Shareholder advance payable"};
    if(/loan payable/i.test(label)){const entity=label.replace(/^loan payable\s*[-–—]?\s*/i,"").trim();return {kind:"Liability",category:"Loans Payable",holder:entity||"No holder specified",accountName:"Loan payable"};}
    if(/corporate tax/.test(text))return {kind:"Liability",category:"Corporate Tax Payable",holder:"Corporate tax",accountName:"Corporate tax payable / offset"};
    return {kind:"Liability",category:"Other Liabilities",holder:heading||"No holder specified",accountName:label};
  }
  // Explicit leaf descriptions override a stale or missed OCR section heading.
  if(/\bcibc bank/i.test(label))return {kind:"Asset",category:"Cash and Bank Accounts",holder:"CIBC Bank",accountName:label};
  if(/receivable/.test(label)&&!/loans? receivable/.test(heading))return {kind:"Asset",category:"Other Receivables",holder:label.includes("-")?label.split("-").at(-1)?.trim()||"Receivable":"Receivables",accountName:"Receivable"};
  if(/real estate/.test(text))return {kind:"Asset",category:"Real Estate",holder:"Real Estate",accountName:"Real estate equity"};
  if(/investments?/.test(heading))return {kind:"Asset",category:"Investments",holder:"Investments",accountName:"Investment"};
  if(/mortgages?/.test(heading))return {kind:"Asset",category:"Mortgage Investments / Mortgage Receivables",holder:"Mortgage investments",accountName:"Mortgage investment"};
  if(/loans? receivable/.test(heading))return {kind:"Asset",category:"Loans Receivable",holder:"Loans receivable",accountName:"Loan receivable"};
  if(/corporate tax instalment/.test(text))return {kind:"Asset",category:"Corporate Tax Instalment Receivable",holder:"Corporate tax",accountName:"Corporate tax instalment receivable"};
  return {kind:"Asset",category:inferCategory(text,"Asset"),holder:heading||"No holder specified",accountName:label};
}

function lineAmount(line:OcrLine,columnX:number,maxDistance=Number.POSITIVE_INFINITY):number|null {
  const candidates=line.words.flatMap((word,index)=>{const combinations=[word.text];if(index&&/^[$S5]$/.test(line.words[index-1].text))combinations.push(`${line.words[index-1].text} ${word.text}`);return combinations.map((text)=>({amount:parseAccountingAmount(text),distance:Math.abs((word.x0+word.x1)/2-columnX)}));}).filter((item):item is {amount:number;distance:number}=>item.amount!==null&&item.distance<=maxDistance).sort((a,b)=>a.distance-b.distance);
  return candidates[0]?.amount??null;
}

function controlKey(heading:string){const value=heading.toLowerCase();if(/^mortgages?/.test(value))return "Mortgage Investments / Mortgage Receivables";if(/^investments?/.test(value))return "Investments";if(/^loans? receivable/.test(value))return "Loans Receivable";if(/^real estate/.test(value))return "Real Estate";return heading;}

export function parseOcrFinancialWords(words:OcrWord[],source:string):OcrParseResult {
  const lines=reconstructOcrLines(words);const fullText=lines.map((line)=>line.text).join("\n");if(!/\bnet\s*worth\b/i.test(fullText))return {rows:[],sourceCurrentNetWorth:null,sourcePreviousNetWorth:null,averageConfidence:0};
  const dateWords=words.filter((word)=>/(?:30[-\s]jun|31[-\s]jul|jun(?:e)?\s*30|jul(?:y)?\s*31)/i.test(word.text));
  let previousX=dateWords.find((word)=>/jun/i.test(word.text))?((dateWords.find((word)=>/jun/i.test(word.text))!.x0+dateWords.find((word)=>/jun/i.test(word.text))!.x1)/2):470;
  let currentX=dateWords.find((word)=>/jul/i.test(word.text))?((dateWords.find((word)=>/jul/i.test(word.text))!.x0+dateWords.find((word)=>/jul/i.test(word.text))!.x1)/2):Math.max(...words.map((word)=>word.x1))*.9;
  if(currentX<previousX)[previousX,currentX]=[currentX,previousX];
  const columnTolerance=Math.max(40,Math.abs(currentX-previousX)*.22);
  const parseDate=(text:string)=>{const match=text.match(/(\d{1,2})[-\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s](\d{2,4})/i);if(!match)return undefined;const months=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];const year=Number(match[3])+(match[3].length===2?2000:0);return `${year}-${String(months.indexOf(match[2].slice(0,3).toLowerCase())+1).padStart(2,"0")}-${match[1].padStart(2,"0")}`;};
  const previousDate=parseDate(dateWords.find((word)=>/jun/i.test(word.text))?.text??"");const currentDate=parseDate(dateWords.find((word)=>/jul/i.test(word.text))?.text??"");
  let heading="";let lastDescription="";const rows:ParsedRow[]=[];const controls=new Map<string,{current:number|null;previous:number|null}>();let sourceCurrentNetWorth:number|null=null;let sourcePreviousNetWorth:number|null=null;
  const headingPattern=/^(real estate|investments?|loans? receivable|mortgages?|corporate tax instalment)$/i;
  for(const line of lines){
    const text=line.text.trim();if(headingPattern.test(text)){heading=text;continue;}
    if(/total net\s*worth/i.test(text)){sourcePreviousNetWorth=lineAmount(line,previousX,columnTolerance);sourceCurrentNetWorth=lineAmount(line,currentX,columnTolerance);continue;}
    if(/\b(?:income|fees|interest earned)\b/i.test(text))continue;
    const previous=lineAmount(line,previousX,columnTolerance),current=lineAmount(line,currentX,columnTolerance);if(current===null&&previous===null)continue;
    const amountWords=line.words.filter((word)=>parseAccountingAmount(word.text)!==null);if(!amountWords.length)continue;
    const firstBalanceX=Math.min(...amountWords.map((word)=>word.x0));let label=line.words.filter((word)=>word.x1<firstBalanceX-4&&!/^[$S5]$/.test(word.text)).map((word)=>word.text).join(" ").replace(/\b\d+(?:\.\d+)?%/g,"").replace(/\s{2,}/g," ").trim();
    if(totalPattern.test(label)||(!label&&heading)){controls.set(controlKey(heading),{current,previous});continue;}
    const rawCurrent=current??0;if(label.length<3&&rawCurrent<0&&lastDescription)label=`${lastDescription} payable / offset`;if(label.length<3||/^\d+[.)]?$/i.test(label)||/^page\b/i.test(label))continue;
    lastDescription=label;const classification=financialCategory(label,heading,rawCurrent<0);const confidence=line.words.reduce((sum,word)=>sum+word.confidence,0)/line.words.length;
    rows.push({id:`ocr-${rows.length}-${Math.round(line.y)}`,include:true,investor:"",category:classification.category,holder:classification.holder,accountName:classification.accountName,institution:classification.holder,description:label,current:Math.abs(rawCurrent),previous:previous===null?null:Math.abs(previous),kind:classification.kind,source,ocrConfidence:confidence,needsReview:confidence<70||line.words.some((word)=>word.confidence<60),sourceCurrentNetWorth:null,sourcePreviousNetWorth:null,sourceCurrentDate:currentDate,sourcePreviousDate:previousDate});
  }
  for(const row of rows){row.sourceCurrentNetWorth=sourceCurrentNetWorth;row.sourcePreviousNetWorth=sourcePreviousNetWorth;const control=controls.get(row.category);row.sourceCategoryControlCurrent=control?.current??null;row.sourceCategoryControlPrevious=control?.previous??null;}
  return {rows,sourceCurrentNetWorth,sourcePreviousNetWorth,averageConfidence:words.length?words.reduce((sum,word)=>sum+word.confidence,0)/words.length:0};
}

export function financialScore(text:string,confidence:number){const amounts=text.match(/\(?\s*\$?\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?\s*\)?/g)?.length??0;const headings=["net worth","investments","loans receivable","mortgages","loan payable","total net worth"].filter((heading)=>text.toLowerCase().includes(heading)).length;return confidence+amounts*2+headings*10;}
