"""Invented fixtures only. Requires reportlab and fonttools; no source PDFs."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white, black
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
class OutlinePen(BasePen):
    def __init__(self,glyphs,path):super().__init__(glyphs);self.path=path
    def _moveTo(self,p):self.path.moveTo(*p)
    def _lineTo(self,p):self.path.lineTo(*p)
    def _curveToOne(self,a,b,c):self.path.curveTo(*a,*b,*c)
    def _closePath(self):self.path.close()
import argparse

parser=argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--font', default='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
font=TTFont(args.font);glyphs=font.getGlyphSet();cmap=font.getBestCmap();units=font['head'].unitsPerEm

def text(c,x,y,value,size=12,outlined=False,right=False):
    width=sum(glyphs[cmap[ord(ch)]].width for ch in value)*size/units if outlined else c.stringWidth(value,'Helvetica',size)
    if right:x-=width
    if not outlined:
        c.setFont('Helvetica',size);c.drawString(x,y,value);return
    c.saveState();c.translate(x,y);c.scale(size/units,size/units)
    for ch in value:
        glyph=glyphs[cmap[ord(ch)]];pen=OutlinePen(glyphs,c.beginPath());glyph.draw(pen);c.drawPath(pen.path,fill=1,stroke=0);c.translate(glyph.width,0)
    c.restoreState()

def page(c,outlined=False,earnings=False,missing=False,mismatch=False):
    c.setFillColor(HexColor('#183340'));c.rect(0,695,612,97,fill=1,stroke=0);c.setFillColor(white)
    text(c,35,750,'Statement of Earnings' if earnings else 'Statement of Financial Position',18,outlined)
    text(c,35,716,'Invented test data only',11,outlined)
    c.setFillColor(black);text(c,35,660,'TOTAL ASSETS',11,outlined);text(c,260,660,'TOTAL LIABILITIES',11,outlined);text(c,475,660,'TOTAL EQUITY',11,outlined)
    text(c,35,635,'$9,999,999',16,outlined);text(c,260,635,'$8,888,888',16,outlined);text(c,475,635,'$7,777,777',16,outlined)
    c.setFillColor(HexColor('#183340'));c.rect(25,560,562,40,fill=1,stroke=0);c.setFillColor(white)
    text(c,35,577,'Account',12,outlined);text(c,445,577,'Oct 31, 2026',11,outlined,True);text(c,575,577,'Sep 30, 2026',11,outlined,True)
    c.setFillColor(black)
    def line(y,label,current=None,previous=None):
        text(c,35,y,label,12,outlined)
        if current is not None:text(c,445,y,current,12,outlined,True)
        if previous is not None:text(c,575,y,previous,12,outlined,True)
    if earnings:
        line(530,'REVENUE');line(500,'Example Revenue','90,000','80,000');line(470,'Net Income','50,000','40,000')
    else:
        line(530,'ASSETS - CASH AND INVESTMENTS')
        line(500,'Invented Bank operating','12,345.67',None if missing else '11,000.25')
        line(470,'Invented Fund portfolio','20,000','19,000')
        line(440,'1177 Fiction Street property','40,000','39,000')
        line(410,'Invented Bank zero','0','0')
        line(380,'Subtotal assets','72,345.67','69,000.25')
        line(350,'TOTAL ASSETS','72,445.67' if mismatch else '72,345.67','69,000.25')
        line(320,'LIABILITIES: LOANS AND PAYABLES')
        line(290,'Invented Lender loan','5,000','4,000')
        line(260,'TOTAL LIABILITIES','5,000','4,000')
        line(230,'EQUITY');line(200,'Retained Earnings','60,000','50,000');line(170,'Net Income','7,345.67','15,000.25')
        line(140,'TOTAL EQUITY','67,345.67','65,000.25');line(110,'INSIGHTS');line(80,'Assets increased by 3,345.42')
    c.showPage()

for name,modes,missing,mismatch in [
    ('mixed-earnings-outlined.pdf',[(False,True),(True,False)],False,False),
    ('outlined.pdf',[(True,True),(True,False)],False,False),
    ('mixed-position-pages.pdf',[(False,False),(True,False)],False,False),
    ('missing-prior.pdf',[(True,False)],True,False),
    ('unreconciled.pdf',[(True,False)],False,True),
    ('embedded.pdf',[(False,False)],False,False),
]:
    c=canvas.Canvas(str(out/name),pagesize=(612,792))
    for outlined,earnings in modes:page(c,outlined,earnings,missing,mismatch)
    c.save()
print('Generated six synthetic PDFs (invented names and values).')
c=canvas.Canvas(str(out/'partial.pdf'),pagesize=(612,792));page(c,False,False);text(c,35,700,'Invented unsupported memorandum',18,True);c.showPage();c.save()
c=canvas.Canvas(str(out/'unreadable.pdf'),pagesize=(612,792));c.showPage();c.save()
c=canvas.Canvas(str(out/'unsupported.pdf'),pagesize=(612,792));page(c,False,True);c.save()
