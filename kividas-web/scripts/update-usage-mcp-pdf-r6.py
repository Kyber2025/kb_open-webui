from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from pypdf import PdfReader
import shutil

WEB=Path(__file__).resolve().parents[2]
ROOT=WEB.parent
(ROOT/'output/pdf').mkdir(parents=True,exist_ok=True)
FONT=WEB/'backend/open_webui/static/fonts/NotoSansSC-Regular.ttf'
pdfmetrics.registerFont(TTFont('CJK',str(FONT)))
pdfmetrics.registerFont(TTFont('Code','/System/Library/Fonts/Menlo.ttc',subfontIndex=0))
INK=HexColor('#252822');MUTED=HexColor('#757870');LINE=HexColor('#e4e4dc');BG=HexColor('#f7f8f4');ACCENT=HexColor('#39664e')
p=ROOT/'output/pdf/Kividas用量MCP接入教程Windows与Mac.pdf'
c=canvas.Canvas(str(p),pagesize=(595.28,841.89),pageCompression=1)
c.setTitle('Kividas 用量 MCP 接入教程 - Windows / Mac')
c.setAuthor('Kividas');c.setSubject('Windows / Mac 用量 MCP：一键配置与手动配置')
def txt(x,y,text,size=10,color=INK,font='CJK'):
 c.setFillColor(color);c.setFont(font,size);c.drawString(x,y,text)
def para(x,top,text,w=479,size=10.2,leading=16,color=INK):
 style=ParagraphStyle('body',fontName='CJK',fontSize=size,leading=leading,textColor=color,wordWrap='CJK',alignment=TA_LEFT)
 obj=Paragraph(text,style);_,h=obj.wrap(w,200);obj.drawOn(c,x,top-h);return top-h
def box(y,h,fill=BG):
 c.setFillColor(fill);c.setStrokeColor(LINE);c.setLineWidth(.7);c.roundRect(42,y,511.28,h,12,fill=1,stroke=1)
def step(n,y,title):
 c.setFillColor(ACCENT);c.circle(69,y+3,11,stroke=0,fill=1);txt(66,y-1,str(n),10,HexColor('#ffffff'),'Helvetica-Bold');txt(91,y-2,title,14)

txt(42,800,'KIVIDAS / GUIDE',10,MUTED,'Helvetica-Bold')
c.setFont('Helvetica',9);c.setFillColor(MUTED);c.drawRightString(553,800,'r6  /  2026.11.16')
txt(42,759,'直接问 Claude 查用量',24)
txt(42,733,'Windows / Mac  ·  远程 MCP  ·  kividas-usage',11,MUTED)
txt(42,706,'三步接入，无需安装悬浮球，也不需要管理员密码。',11)

box(493,195);step(1,661,'下载并运行一键配置')
para(58,640,'在 Kividas 网站的 Code 页下载“网关一键配置”r6，然后完整解压。')
c.setStrokeColor(LINE);c.line(298,538,298,610)
txt(58,600,'Windows',11,ACCENT,'Helvetica-Bold')
para(58,585,'双击 <b>配置Windows.cmd</b>。<br/>用当前登录用户直接运行。',w=219,size=10.3,leading=19)
txt(317,600,'Mac',11,ACCENT,'Helvetica-Bold')
para(317,585,'终端输入 /bin/bash 和一个空格，<br/>拖入 配置Mac.sh，再按回车。',w=219,size=10.3,leading=19)
para(58,527,'保留文件夹内所有文件。配置前，请先保存任务并退出 Claude。',size=9.5,color=MUTED)

box(342,137);step(2,453,'选择适合你的配置方式')
para(58,430,'默认选择“一键配置 · 桌面端与 CLI”，也可只配置其中一个。<br/>新老用户均可导入原 TXT，或填写配套 Key 与安装识别码。',leading=18)
para(58,384,'初始化接入配置、用量 MCP 和关闭遥测会一起完成。<br/>先备份，再更新；保留项目文件、CLAUDE.md 和其他 MCP。',leading=18)

box(207,121);step(3,302,'重开 Claude，直接提问')
para(58,279,'重新打开 Claude Code CLI，或官方桌面客户端的 Code 本地会话。')
c.setFillColor(HexColor('#eaf0e8'));c.roundRect(58,233,479,28,6,fill=1,stroke=0)
txt(70,242,'用 kividas-usage 查询我的 5 小时和每周用量。',11,ACCENT)
para(58,231,'首次询问是否允许调用工具时，选择允许即可。',size=9.5,color=MUTED)

box(77,116,HexColor('#ffffff'));txt(58,174,'遇到问题时',11)
para(58,158,'• 接入资料：使用原 TXT 或配套 Key 与安装识别码，无需钥匙串密码。<br/>• 更换 Key 后：重新运行一键配置。需要撤销时，选择“恢复上一次配置”。<br/>• 查询失败或暂无数据不代表 0%。MCP 查询本身不占推理 RPM；Claude 的自然语言回复仍属于正常模型对话。',size=9.2,leading=15.3)
c.setStrokeColor(LINE);c.line(42,58,553,58)
txt(42,42,'适用于 Claude Code CLI / Code 本地会话；普通 Chat、云端会话与 Cowork 不在此范围。',8.3,MUTED)
txt(42,27,'配置会自动备份。不要分享含 Key 的配置文件或截图。',8.3,MUTED)
c.setFont('Helvetica',8.3);c.drawRightString(553,27,'1 / 2')
c.showPage()
txt(42,800,'KIVIDAS / MANUAL SETUP',10,MUTED,'Helvetica-Bold')
c.setFont('Helvetica',9);c.setFillColor(MUTED);c.drawRightString(553,800,'r6  /  2026.11.16')
txt(42,759,'手动配置用量 MCP',24)
txt(42,733,'无需运行配置工具；适用于 CLI 与官方桌面 Code 本地会话。',10.5,MUTED)

box(598,111);step(1,684,'退出 Claude，备份并打开配置文件')
txt(58,660,'Windows：%USERPROFILE%\\.claude.json',10.5)
txt(58,641,'Mac：~/.claude.json',10.5)
para(58,624,'用纯文本编辑器打开。文件不存在时可新建；不是 .claude/settings.json。',size=9.5,color=MUTED)

box(249,335);step(2,559,'填入自己的 Key，合并配置')
para(58,539,'新文件使用下面示例；已有文件只合并 mcpServers 中的 kividas-usage 项，保留其他内容。把占位符换成接入 TXT 的 Gateway API key，保留 Bearer 后的一个空格，不要填网站登录密码。',size=9.6,leading=15)
c.setFillColor(HexColor('#edf1ea'));c.roundRect(58,293,479,188,6,fill=1,stroke=0)
manual={"mcpServers":{"kividas-usage":{"type":"http","url":"https://ai.kividas.com/api/mcp/usage","headers":{"Authorization":"Bearer YOUR_KIVIDAS_GATEWAY_KEY"}}}}
import json
for i,line in enumerate(json.dumps(manual,indent=2).splitlines()):txt(71,461-i*14,line,9.1,INK,'Code')
para(58,282,'若已有同名本地 MCP，更新这一项即可。旧的 kividas-usage-remote 若指向同一服务，可删除以免重复。保存为 UTF-8 JSON，勿使用中文引号或添加注释。',size=9.1,leading=14,color=MUTED)

box(83,152);step(3,209,'重开会话，检查连接')
para(58,187,'CLI 输入 /mcp，确认 kividas-usage 已连接。桌面端重新打开 Code 本地会话，再发送下面的问题；首次提示是否允许调用工具时，选择允许。',size=10.2,leading=17)
c.setFillColor(HexColor('#eaf0e8'));c.roundRect(58,118,479,28,6,fill=1,stroke=0)
txt(70,127,'用 kividas-usage 查询我的 5 小时和每周用量。',11,ACCENT)
para(58,110,'连接失败请检查 Key、网络和订阅；以后更换 Key，也要同步更新此处。',size=9.1,color=MUTED)
c.setStrokeColor(LINE);c.line(42,65,553,65)
txt(42,48,'手动配置不会自动继承模型网关密钥。需要撤销时，关闭 Claude 后恢复你保存的备份。',8.4,MUTED)
txt(42,31,'请勿分享含 Key 的配置或截图。普通 Chat、云端会话与 Cowork 不在本教程范围内。',8.4,MUTED)
c.setFont('Helvetica',8.3);c.drawRightString(553,31,'2 / 2')
c.showPage();c.save()
reader=PdfReader(str(p));assert len(reader.pages)==2
text='\n'.join(page.extract_text() for page in reader.pages)
assert 'YOUR_KIVIDAS_GATEWAY_KEY' in text and '手动配置' in text
for required in ['配置Mac.sh','配置Windows.cmd','kividas-usage','初始化接入配置','钥匙串']:
 assert required in text,required
assert '配置Mac.command' not in text
web=WEB/'kividas-web/public/gateway'
for d in [web,web/'reseller']:shutil.copyfile(p,d/'kividas-usage-mcp-guide-r6.pdf')
print(f'Created two-page PDF: {p.stat().st_size} bytes')
