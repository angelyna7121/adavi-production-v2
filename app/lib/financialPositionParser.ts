import type { Kind, ParsedRow } from "./documentParser";
import { inferCategory } from "./documentParser";
import { reconstructOcrLines, type OcrWord } from "./ocrFinancialParser";

const compact = (text:string) => text.toLowerCase().replace(/[^a-z]/g, "");
export function statementType(text:string):"position"|"earnings"|"net-worth"|"unknown" {
  const value=compact(text);
  if(value.includes("statementoffinancialposition")||value.includes("balancesheet"))return "position";
  if(value.includes("statementofearnings")||value.includes("incomestatement")||value.includes("statementofincome"))return "earnings";
  if(value.includes("networth"))return "net-worth";
  // Titles can be outlined or missed by OCR. Both explicit section headings
  // provide independent balance-sheet evidence; summary cards alone do not.
  const lines=text.split(/\n/).map(compact);
  if(lines.some(line=>/^(?:current|noncurrent)?assets/.test(line))&&lines.some(line=>/^(?:current|noncurrent)?liabilities/.test(line)))return "position";
  return "unknown";
}
export function statementSection(text:string):Kind|"excluded"|null {
  const value=compact(text);
  if(/^(?:shareholders?|stockholders?|owners?)?equity/.test(value)||/^(?:retainedearnings|netincome|yeartodate|narrativeinsights|insights|revenue|expenses|income)/.test(value))return "excluded";
  if(/^(?:current|noncurrent|fixed)?assets/.test(value))return "Asset";
  if(/^(?:current|noncurrent|longterm)?liabilities/.test(value))return "Liability";
  return null;
}
/** Equity-only continuation pages contain no net-worth leaves. Do not silently
 * ignore a page with monetary data before its explicit equity section. */
export function isEquityOnlyPage(words:OcrWord[]):boolean {
  const lines=reconstructOcrLines(words);
  const equity=lines.findIndex(line=>/^(?:(?:shareholders?|stockholders?|owners?)equity|equity)$/.test(compact(line.text)));
  if(equity<0||lines.some(line=>{const section=statementSection(line.text);return section==="Asset"||section==="Liability";}))return false;
  return !lines.slice(0,equity).some(line=>/(?:\$\s*\d|\d{1,3}(?:,\d{3})+|\d+\.\d{2})/.test(line.text));
}
function dateValue(text:string):string|null {
  const match=text.match(/^(?:(\d{1,2})[\s-]+([a-z]{3,9})|([a-z]{3,9})[\s-]+(\d{1,2})),?[\s-]+(\d{2}|\d{4})$/i);
  if(!match)return null;
  const months=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const month=months.indexOf((match[2]??match[3]).slice(0,3).toLowerCase());const day=Number(match[1]??match[4]);const year=Number(match[5])+(match[5].length===2?2000:0);
  if(month<0||day<1||day>31||new Date(Date.UTC(year,month,day)).getUTCDate()!==day)return null;
  return `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
/** Dates are reconstructed within one baseline, never across columns. */
export function positionedDates(words:OcrWord[]) {
  return reconstructOcrLines(words).flatMap(line=>line.words.flatMap((word,index)=>{
    for(let count=1;count<=4&&index+count<=line.words.length;count++){
      const span=line.words.slice(index,index+count);const date=dateValue(span.map(item=>item.text).join(" "));
      if(date)return [{date,x:(word.x0+span.at(-1)!.x1)/2,right:span.at(-1)!.x1,y:line.y,confidence:Math.min(...span.map(item=>item.confidence))}];
    }return [];
  }));
}
function amount(text:string):number|null {
  const value=text.trim().replace(/\s+/g,"");
  if(!/^(?:\$|CAD|USD)?\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\)?$/i.test(value))return null;
  const number=Number(value.replace(/[^\d.]/g,""));return Number.isFinite(number)?number*(/[-(]/.test(value)?-1:1):null;
}
export type PositionParseResult={rows:ParsedRow[]; status:"parsed"|"uncertain"|"unsupported"; reason?:string};
export function parseFinancialPositionWords(words:OcrWord[],source:string):PositionParseResult {
  const lines=reconstructOcrLines(words);const type=statementType(lines.map(line=>line.text).join("\n"));
  if(type!=="position")return {rows:[],status:"unsupported"};
  const firstSection=lines.find(line=>statementSection(line.text)==="Asset"||statementSection(line.text)==="Liability");
  if(!firstSection)return {rows:[],status:"uncertain",reason:"Financial sections could not be identified"};
  const dates=positionedDates(words).filter(date=>date.y<firstSection.y);
  // Use the closest complete pair on one table-header baseline, rather than
  // dates in a title, summary card or narrative paragraph.
  let columns:{current:typeof dates[number];previous:typeof dates[number]}|undefined;
  for(const date of [...dates].sort((a,b)=>b.y-a.y)){
    const peer=dates.find(other=>other.date!==date.date&&Math.abs(other.y-date.y)<20&&Math.abs(other.x-date.x)>80);
    if(peer){columns=date.date>peer.date?{current:date,previous:peer}:{current:peer,previous:date};break;}
  }
  if(!columns)return {rows:[],status:"uncertain",reason:"Dated balance columns could not be identified"};
  const span=Math.abs(columns.current.right-columns.previous.right);const tolerance=Math.max(24,span*.24);
  let section:Kind|"excluded"|null=null;const rows:ParsedRow[]=[];
  const controls:{Asset:{current:number|null;previous:number|null};Liability:{current:number|null;previous:number|null}}={Asset:{current:null,previous:null},Liability:{current:null,previous:null}};
  let heading="";let uncertain=false;
  for(let index=0;index<lines.length;index++){
    const line=lines[index];if(line.y<=firstSection.y-1)continue;
    const detected=statementSection(line.text);
    if(detected){section=detected;heading=line.text;continue;}
    if(!section||section==="excluded")continue;
    if(/^(?:insights|notes|commentary|narrative)/i.test(line.text)){section="excluded";continue;}
    const values=line.words.flatMap((word,wordIndex)=>{
      // Join only currency/parenthesis fragments to a numeric token. Never
      // concatenate neighboring numbers (which can be different periods).
      let text=word.text;let left=word.x0;let right=word.x1;let confidence=word.confidence;
      if(/^[\d,(.-]/.test(text)&&wordIndex>0&&/^(?:\$|\()$/.test(line.words[wordIndex-1].text)){text=line.words[wordIndex-1].text+text;left=line.words[wordIndex-1].x0;}
      const next=line.words[wordIndex+1];if(next?.text===")"){text+=")";right=next.x1;confidence=Math.min(confidence,next.confidence);}
      const value=amount(text);return value===null?[]:[{value,left,right,confidence}];
    });
    const pick=(period:"current"|"previous")=>values.filter(value=>Math.abs(value.right-columns![period].right)<=tolerance).sort((a,b)=>Math.abs(a.right-columns![period].right)-Math.abs(b.right-columns![period].right))[0];
    const current=pick("current"),previous=pick("previous");if(!current&&!previous)continue;
    const firstBalance=Math.min(current?.left??Infinity,previous?.left??Infinity);
    const label=line.words.filter(word=>word.x1<firstBalance-4).map(word=>word.text).join(" ").trim();
    if(!label||!/[a-z]/i.test(label))continue;
    if(/^(?:total|sub[ -]?total|grand total)\b/i.test(label)){
      if(compact(label)===(section==="Asset"?"totalassets":"totalliabilities"))controls[section]={current:current?.value??null,previous:previous?.value??null};
      continue;
    }
    if(/\b(?:equity|retained\s+earnings|net\s+income|year.to.date|net\s+worth|summary|insights)\b/i.test(label))continue;
    const leafCategory=inferCategory(label,section);
    const mixedHeading=/cash/i.test(heading)&&/investments/i.test(heading);
    const category=leafCategory===(section==="Asset"?"Other Assets":"Other Liabilities")&&!mixedHeading?inferCategory(heading,section):leafCategory;
    const needsReview=!current||(current?.value??0)<0||(previous?.value??0)<0||Math.min(current?.confidence??100,previous?.confidence??100,columns.current.confidence,columns.previous.confidence,...line.words.filter(word=>word.x1<firstBalance).map(word=>word.confidence))<70;
    uncertain ||= needsReview;
    rows.push({id:`position-${index}`,include:true,investor:"",kind:section,category,holder:label,accountName:label,institution:label,description:label,current:current?Math.abs(current.value):"",previous:previous?Math.abs(previous.value):null,source,sourceRow:index+1,sourceCurrentDate:columns.current.date,sourcePreviousDate:columns.previous.date,isLeafAccount:true,isSourceTotal:false,ocrConfidence:Math.min(current?.confidence??0,previous?.confidence??100),needsReview,ocrRowBox:{x0:line.words[0].x0,y0:Math.min(...line.words.map(word=>word.y0)),x1:Math.max(...line.words.map(word=>word.x1)),y1:Math.max(...line.words.map(word=>word.y1))}});
  }
  // Source controls are evidence, never synthetic accounts or balancing values.
  for(const period of ["current","previous"] as const){
    for(const kind of ["Asset","Liability"] as const){const control=controls[kind][period];if(control===null)continue;const leaves=rows.filter(row=>row.kind===kind);const missing=leaves.some(row=>row[period]===""||row[period]===null);const sum=leaves.reduce((total,row)=>total+Number(row[period]??0),0);if(missing||Math.abs(sum-control)>1){uncertain=true;rows.forEach(row=>{row.needsReview=true;row.manuallyReviewRequired=true;});}}
  }
  for(const row of rows){row.sourceAssetTotalCurrent=controls.Asset.current;row.sourceAssetTotalPrevious=controls.Asset.previous;row.sourceLiabilityTotalCurrent=controls.Liability.current;row.sourceLiabilityTotalPrevious=controls.Liability.previous;}
  return {rows,status:rows.length?uncertain?"uncertain":"parsed":"uncertain",reason:rows.length?uncertain?"Rows or source totals require review":undefined:"No reliable leaf accounts were identified"};
}
