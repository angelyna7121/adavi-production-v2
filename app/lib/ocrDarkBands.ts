import type { OcrWord } from "./ocrFinancialParser";
type Band={y0:number;y1:number;x0:number;x1:number};
/** Find broad dark heading bands; small dark account text is left untouched. */
export function findDarkHeadingBands(pixels:Uint8ClampedArray,width:number,height:number):Band[]{
  const dark=(x:number,y:number)=>{const offset=(y*width+x)*4;return Math.max(pixels[offset],pixels[offset+1],pixels[offset+2])<180;};
  const bands:Band[]=[];let start=-1;
  for(let y=0;y<=height;y++){
    let count=0;if(y<height)for(let x=0;x<width;x+=8)if(dark(x,y))count++;
    if(y<height&&count/Math.ceil(width/8)>.45){if(start<0)start=y;}
    else if(start>=0){
      if(y-start>8){let left=width,right=0;for(let x=0;x<width;x++){let ink=0;for(let row=start;row<y;row+=4)if(dark(x,row))ink++;if(ink/Math.ceil((y-start)/4)>.6){left=Math.min(left,x);right=Math.max(right,x);}}if(right>left)bands.push({y0:start,y1:y,x0:left,x1:right+1});}start=-1;
    }
  }
  return bands;
}
/** Retry only inverted headings with a single-block OCR layout. Merge by page
 * coordinates, replacing overlapping words rather than duplicating them. */
export async function recoverDarkHeadingWords(canvas:HTMLCanvasElement,words:OcrWord[],recognize:(canvas:HTMLCanvasElement)=>Promise<OcrWord[]>):Promise<OcrWord[]>{
  const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)return words;
  const image=context.getImageData(0,0,canvas.width,canvas.height);const bands=findDarkHeadingBands(image.data,canvas.width,canvas.height);let result=[...words];
  for(const band of bands){
    const crop=document.createElement("canvas");crop.width=band.x1-band.x0+80;crop.height=band.y1-band.y0+80;const ctx=crop.getContext("2d");if(!ctx)continue;ctx.fillStyle="#fff";ctx.fillRect(0,0,crop.width,crop.height);
    const heading=context.getImageData(band.x0,band.y0,band.x1-band.x0,band.y1-band.y0);for(let i=0;i<heading.data.length;i+=4)for(let channel=0;channel<3;channel++)heading.data[i+channel]=255-heading.data[i+channel];ctx.putImageData(heading,40,40);
    const recovered=(await recognize(crop)).filter(word=>word.confidence>=30).map(word=>({...word,x0:word.x0+band.x0-40,x1:word.x1+band.x0-40,y0:word.y0+band.y0-40,y1:word.y1+band.y0-40}));
    if(recovered.length)result=[...result.filter(word=>(word.y0+word.y1)/2<band.y0||(word.y0+word.y1)/2>band.y1),...recovered];
  }
  return result;
}
