"""Update the three customer PDFs from the checked-in 1037de5fe originals.

Keep existing screenshot pages and their page numbers; replace the cover, update
the CLI JSON example, append the required r5 checklist, and refresh all footers.
Run with the PDF runtime plus .pdfdeps (PyMuPDF) on PYTHONPATH.
"""
from pathlib import Path
import io
import subprocess
import pymupdf as fitz
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Preformatted

WEB = Path(__file__).resolve().parents[2]
ROOT = WEB.parent
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
PUBLIC = WEB / 'kividas-web/public/gateway'
BASE = '1037de5fe6a11c89af394843fb1e72624e9e6861'
FONT = '/Library/Fonts/Arial Unicode.ttf'
pdfmetrics.registerFont(TTFont('CJK', FONT))
BLUE = colors.HexColor('#225B82')
INK = colors.HexColor('#20313B')
styles = {
    'body': ParagraphStyle('body', fontName='CJK', fontSize=10.5, leading=16, textColor=INK, wordWrap='CJK', spaceAfter=8),
    'title': ParagraphStyle('title', fontName='CJK', fontSize=25, leading=32, textColor=INK, spaceAfter=8),
    'sub': ParagraphStyle('sub', fontName='CJK', fontSize=13, leading=20, textColor=BLUE, spaceAfter=12),
    'h': ParagraphStyle('h', fontName='CJK', fontSize=13, leading=20, textColor=BLUE, spaceBefore=10, spaceAfter=6),
    'small': ParagraphStyle('small', fontName='CJK', fontSize=9, leading=14, textColor=INK, wordWrap='CJK', spaceAfter=6),
    'code': ParagraphStyle('code', fontName='Courier', fontSize=8.5, leading=13, textColor=INK, spaceAfter=10),
}


def p(text, style='body'):
    return Paragraph(text, styles[style])


def box(text):
    t = Table([[p(text)]], colWidths=[507])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#EAF2F7')),
        ('BOX', (0, 0), (-1, -1), 0.7, BLUE),
        ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    return t


def page(story):
    data = io.BytesIO()
    doc = SimpleDocTemplate(data, pagesize=(595.28, 841.89), leftMargin=44, rightMargin=44,
                            topMargin=42, bottomMargin=49)
    doc.build(story)
    assert len(PdfReader(io.BytesIO(data.getvalue())).pages) == 1, 'new content overflowed'
    return data.getvalue()


def download():
    return p('登录 <link href="https://chat.kividas.com/code" color="#225B82">https://chat.kividas.com/code</link>，'
             '在网关资料区域下载“网关一键配置”，确认版本为 <b>r5</b>。完整解压，保留同一文件夹中的全部文件。')


def cover(platform, pages, navigation):
    return page([
        p('KIVIDAS · 2026-11-11 更新', 'small'),
        p('Claude 网关配置教程'),
        p(platform, 'title'),
        box('<b>必须关闭遥测与错误上报</b><br/>首次接入和已经配置过网关的用户都必须完成。'
            '请下载并运行最新的 r5 一键配置；仅更新网页、下载文件或升级 Claude 不会自动替你完成此设置。'),
        p('1. 下载最新 r5 一键配置', 'h'), download(),
        p('2. 选择正确的配置方式', 'h'),
        p('<b>已经使用网关：</b>选择默认的“更新隐私设置（无需 Key）”，点击开始。'
          '不需要重新生成 Key、安装识别码或重新导入客户 TXT。'),
        p('<b>首次接入：</b>先安装官方 Claude Desktop / CLI，再选择桌面端、CLI 或两者，'
          '读取原客户接入资料 TXT。r5 配置网关时会同时关闭遥测与错误上报。'),
        p('<b>仅选择“只补用量 MCP”不能代替隐私设置：</b>完成后还必须单独运行“更新隐私设置（无需 Key）”。'),
        p('3. 重启客户端并新建会话', 'h'),
        p('等待工具显示对应客户端已更新或已核对。完全退出 Claude Desktop / CLI，重新打开后新建会话，'
          '测试一条正常消息及一次本机文件操作。每台使用网关的电脑都要执行一次。'),
        p('Mac 完全退出：Claude → Quit Claude 或 Command+Q。Windows：菜单 → File → Exit。'
          'CLI：输入 /exit 后关闭旧终端，再打开新终端运行 claude。', 'small'),
        p('继续阅读图文步骤', 'h'),
        p(navigation + f'<br/><b>r5 操作与关闭遥测核对：第 {pages} 页。</b>', 'small'),
        p('后续手动配置步骤继续适用，但完成后也必须执行 r5 隐私更新。'
          '网关模式使用服务方提供的资料，无需先购买个人 Claude 订阅；安装和组件下载需要可用的网络。', 'small'),
    ])


def appendix():
    return page([
        p('必须完成：关闭遥测与错误上报', 'title'),
        p('最新 r5 一键配置 · 新老用户均适用', 'sub'),
        download(),
        p('Windows / Mac 启动方式', 'h'),
        p('<b>Windows：</b>完整解压后，双击“配置Windows.cmd”。<br/>'
          '<b>Mac：</b>打开终端，输入 <font name="Courier">/bin/bash </font>（末尾留一个空格），'
          '再把“配置Mac.sh”拖入终端并回车。详细说明见压缩包内的“Mac启动说明.txt”。'),
        p('已有网关用户：选择“更新隐私设置（无需 Key）”', 'h'),
        p('保存当前任务并退出 Claude，运行 r5，选择默认的“更新隐私设置（无需 Key）”。'
          '工具会更新当前启用的 Kividas Desktop 和已有 CLI 配置，保留原网关身份和其他设置。'),
        p('新用户选择桌面端、CLI 或两者并导入客户 TXT，即可随网关一起完成隐私设置。'
          '若沿用正文中的手动配置方式，完成后再运行一次 r5 隐私更新。'),
        box('<b>以下情况不算完成：</b>只下载没有运行；只更新网页；只选择“老用户：只补用量 MCP”；'
            '工具显示相关客户端被跳过。被跳过时，先确认该客户端已经正确配置网关，再重新运行隐私更新。'),
        p('工具应核对的关闭项', 'h'),
        p('<b>Desktop：</b>关闭非必要遥测和必要遥测。r5 设置 '
          '<font name="Courier">disableNonessentialTelemetry=true</font> 与 '
          '<font name="Courier">disableEssentialTelemetry=true</font>。', 'small'),
        p('<b>CLI：</b>在已有 <font name="Courier">settings.json</font> 的 '
          '<font name="Courier">env</font> 中保留以下两项；保留原来的 Key、识别码、权限和其他配置。', 'small'),
        Preformatted('"DISABLE_TELEMETRY": "1",\n"DISABLE_ERROR_REPORTING": "1"', styles['code']),
        p('完成前逐项检查', 'h'),
        p('① 使用 r5，并实际运行了配置工具。<br/>'
          '② 每个需要使用的客户端都显示已更新或已核对，没有未处理的“跳过”。<br/>'
          '③ 每台电脑均已执行；Desktop / CLI 已完全退出并重开，且新建了会话。<br/>'
          '④ 新会话可以正常回复，并能按授权读取或创建本机测试文件。', 'small'),
        p('隐私设置关闭的是遥测与错误上报；网关对话和用量查询仍需要正常联网。', 'small'),
    ])


def cli_configuration():
    return page([
        p('步骤二 填写网关并关闭遥测', 'title'),
        p('Mac 与 Windows 使用同一份 JSON。推荐先按首页运行 r5；手动配置时，以下隐私项也必须保留。'),
        p('1. 空白 settings.json 可使用下面的完整模板。已有内容时，只把这些字段合并到原有 env 对象，'
          '保留其他配置，不要覆盖整个文件。[3]'),
        Preformatted('''{
  "env": {
    "ANTHROPIC_BASE_URL": "https://ai.kividas.com/api",
    "ANTHROPIC_AUTH_TOKEN": "PASTE_GATEWAY_API_KEY_HERE",
    "ANTHROPIC_CUSTOM_HEADERS":
      "X-Kividas-Device-ID: PASTE_INSTALLATION_ID_HERE",
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY": "1",
    "DISABLE_TELEMETRY": "1",
    "DISABLE_ERROR_REPORTING": "1"
  }
}''', styles['code']),
        p('2. 只替换两个占位值，保留英文双引号：'),
        p('<font name="Courier">PASTE_GATEWAY_API_KEY_HERE</font>：客户资料中的完整 Gateway API key。<br/>'
          '<font name="Courier">PASTE_INSTALLATION_ID_HERE</font>：与 Key 配套的安装识别码，只粘贴 UUID。', 'small'),
        p('3. 核对网址以 /api 结尾，不再添加 /v1 或 /v1/messages。Key 不是网页登录密码。'
          '保留 <font name="Courier">X-Kividas-Device-ID:</font> 前缀。'),
        p('4. <font name="Courier">CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY</font> 设为 "1"，'
          '用于获取网关模型列表；显示结果仍取决于客户端版本和模型权限。[4]'),
        box('5. <b>必须关闭遥测与错误上报：</b><br/>'
            '<font name="Courier">DISABLE_TELEMETRY</font> 和 '
            '<font name="Courier">DISABLE_ERROR_REPORTING</font> 均设为字符串 "1"。'
            '手动保存后，再运行 r5 的“更新隐私设置（无需 Key）”核对。'),
        p('保存后退出正在运行的 CLI，新开终端并重新运行 claude，新建会话。'
          '继续第 5 页核对安装识别码，再按第 6 页验证连接。'),
    ])


GUIDES = [
    ('claude-desktop-macos.pdf', 'Mac 版', 12, '首次配置：第 2 至 8 页；查看用量：第 9 至 10 页。<br/>恢复官方登录：第 11 页；常见问题：第 12 页。'),
    ('claude-desktop-windows.pdf', 'Windows 版', 13, '首次配置：第 2 至 9 页；查看用量：第 10 至 11 页。<br/>恢复官方登录：第 12 页；常见问题：第 13 页。'),
    ('claude-code-cli.pdf', 'Claude Code CLI · Mac / Windows', 10, 'Mac 安装：第 2 页；Windows 安装：第 3 页；网关与隐私配置：第 4 至 6 页。<br/>查看用量：第 7 页；日常使用：第 8 页；排查：第 9 页；完成检查：第 10 页。'),
]

for filename, platform, original_count, navigation in GUIDES:
    source = subprocess.check_output(['git', 'show', f'{BASE}:kividas-web/public/gateway/{filename}'], cwd=WEB)
    doc = fitz.open(stream=source, filetype='pdf')
    assert len(doc) == original_count
    for index, replacement in [(0, cover(platform, original_count + 1, navigation))] + ([(3, cli_configuration())] if filename == 'claude-code-cli.pdf' else []):
        new = fitz.open(stream=replacement, filetype='pdf')
        doc.delete_page(index)
        doc.insert_pdf(new, start_at=index)
    doc.insert_pdf(fitz.open(stream=appendix(), filetype='pdf'))
    for index, old_page in enumerate(doc):
        # Actual redaction removes stale old totals from searchable/accessibility text.
        old_page.add_redact_annot(fitz.Rect(0, old_page.rect.height - 43, old_page.rect.width, old_page.rect.height), fill=(1, 1, 1))
        old_page.apply_redactions()
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(old_page.rect.width, old_page.rect.height))
        c.setFont('CJK', 8)
        c.setFillColor(colors.HexColor('#66747B'))
        c.drawString(44, 22, 'Kividas · 网关配置教程 · r5 隐私配置更新')
        c.drawRightString(old_page.rect.width - 44, 22, f'{index + 1} / {len(doc)}')
        c.save()
        old_page.show_pdf_page(old_page.rect, fitz.open(stream=buf.getvalue(), filetype='pdf'), 0, overlay=True)
    doc.set_metadata({**doc.metadata, 'title': f'Claude 网关配置教程 - {platform} - r5 隐私更新',
                      'subject': '必须关闭遥测与错误上报，下载并运行最新 r5 一键配置',
                      'modDate': 'D:20261111110000+08\'00\''})
    output = OUT / filename
    doc.save(output, garbage=4, deflate=True)
    PUBLIC.joinpath(filename).write_bytes(output.read_bytes())
    print(filename, len(doc), 'pages', output.stat().st_size, 'bytes')
