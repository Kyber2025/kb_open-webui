"""Update the three customer PDFs from the checked-in 1037de5fe originals.

Keep existing screenshot pages and their page numbers; replace the cover, update
the CLI JSON example, append the required r6 checklist, and refresh all footers.
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
    return p(f'登录 <link href="{ORIGIN}/code" color="#225B82">{ORIGIN}/code</link>，'
             '在网关资料区域下载“网关一键配置”，确认版本为 <b>r6</b>。完整解压，保留同一文件夹中的全部文件。')


def cover(platform, pages, navigation):
    return page([
        p('KIVIDAS · 2026-11-16 更新', 'small'),
        p('Claude 网关配置教程'), p(platform, 'title'),
        box('<b>r6：一次完成接入配置</b><br/>初始化接入配置、用量 MCP 和关闭遥测已合并；无需分别选择。'
            '仅下载文件不会更改本机设置，请运行工具完成配置。'),
        p('1. 下载并完整解压 r6', 'h'), download(),
        p('2. 保存任务并完全退出 Claude', 'h'),
        p('退出 Claude Desktop，并结束 CLI 会话。先安装需要使用的官方客户端；配置工具不会安装或更新 Claude。'),
        p('3. 选择范围，导入原接入资料', 'h'),
        p('默认选择“一键配置 · 桌面端与 CLI”，也可选择“仅配置桌面端”或“仅配置 CLI”。'
          '新老用户均可读取原客户接入资料 TXT，或填入配套 Key 与安装识别码。'),
        p('工具先备份，再重建接入配置并添加用量 MCP、关闭遥测。保留项目文件、CLAUDE.md、'
          '历史记录、权限规则和其他 MCP；不需要清空本机文件。'),
        p('4. 重启客户端并新建会话', 'h'),
        p('等待配置成功后，重新打开 Claude / CLI，新建会话发送消息，再请求“查询我的 Kividas 用量”。'
          '每台电脑分别运行；不要在其他设备复用同一安装识别码。'),
        p('继续阅读图文步骤', 'h'),
        p(navigation + f'<br/><b>r6 操作核对与恢复：第 {pages} 页。</b>', 'small'),
        p('后续图文介绍客户端设置。推荐按本页使用 r6；网关模式使用服务方提供的资料。'
          'CLI 全局配置也可能影响桌面 Code 会话，本工具不提供官方账号与网关的完全隔离。', 'small'),
    ])


def appendix():
    return page([
        p('r6 一键配置与恢复', 'title'),
        p('初始化接入配置 · 用量 MCP · 关闭遥测', 'sub'), download(),
        p('Windows / Mac 启动方式', 'h'),
        p('<b>Windows：</b>完整解压后双击“配置Windows.cmd”。<br/>'
          '<b>Mac：</b>打开终端，输入 <font name="Courier">/bin/bash </font>（末尾留空格），'
          '把“配置Mac.sh”拖入终端并回车。保留同文件夹全部文件。'),
        p('菜单与接入资料', 'h'),
        p('默认“一键配置 · 桌面端与 CLI”，也可仅配置一个客户端。保存任务并退出 Claude 后，'
          '导入原客户 TXT 或填写配套 Key、安装识别码。用量 MCP 与关闭遥测随配置一起完成。'),
        box('<b>只初始化接入配置：</b>先备份，再重建网关、认证、自定义请求头和相关旧设置。'
            '保留项目文件、Markdown、历史记录、权限规则、其他 MCP、插件和企业代理证书。'),
        p('默认设置', 'h'),
        p('<b>Desktop：</b>关闭非必要遥测与必要遥测。<br/>'
          '<b>CLI：</b>关闭遥测、错误上报和 OpenTelemetry 导出。<br/>'
          '<b>用量 MCP：</b>配置远程 kividas-usage，保留其他 MCP。首次使用按提示授权。', 'small'),
        p('完成检查与撤销', 'h'),
        p('① 所选客户端配置成功；重新打开客户端并新建会话。<br/>'
          '② 消息可正常回复；用量工具可查询，文件操作按正常权限授权。<br/>'
          '③ 需要撤销时，再次运行工具并选择“恢复上一次配置”。<br/>'
          '④ 恢复遇到后续修改会停止，避免覆盖新更改。', 'small'),
        p('备份位置：Mac 为 ~/Library/Application Support/KividasSetup/backups/；'
          'Windows 为 %LOCALAPPDATA%/KividasSetup/backups/。备份可能含凭据，请勿分享。', 'small'),
        p('关闭遥测不会停止正常对话和用量查询，也不移除已加载到会话中的指令文件。'
          '初始化是配置维护，不是解除账号限制或保证不会封号的措施。', 'small'),
    ])


def cli_configuration():
    return page([
        p('步骤二 填写网关并关闭遥测', 'title'),
        p('Mac 与 Windows 使用同一份 JSON。推荐先按首页运行 r6；手动配置时，以下隐私项也必须保留。'),
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
    "DISABLE_ERROR_REPORTING": "1",
    "CLAUDE_CODE_ENABLE_TELEMETRY": "0",
    "OTEL_SDK_DISABLED": "true"
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
            '推荐使用 r6 一键配置，自动完成这些设置与用量 MCP。'),
        p('保存后退出正在运行的 CLI，新开终端并重新运行 claude，新建会话。'
          '继续第 5 页核对安装识别码，再按第 6 页验证连接。'),
    ])


GUIDES = [
    ('claude-desktop-macos.pdf', 'Mac 版', 12, '首次配置：第 2 至 8 页；查看用量：第 9 至 10 页。<br/>恢复官方登录：第 11 页；常见问题：第 12 页。'),
    ('claude-desktop-windows.pdf', 'Windows 版', 13, '首次配置：第 2 至 9 页；查看用量：第 10 至 11 页。<br/>恢复官方登录：第 12 页；常见问题：第 13 页。'),
    ('claude-code-cli.pdf', 'Claude Code CLI · Mac / Windows', 10, 'Mac 安装：第 2 页；Windows 安装：第 3 页；网关与隐私配置：第 4 至 6 页。<br/>查看用量：第 7 页；日常使用：第 8 页；排查：第 9 页；完成检查：第 10 页。'),
]

for role, ORIGIN in [('', 'https://chat.kividas.com'), ('reseller/', 'https://proxy.kividas.com')]:
    for filename, platform, original_count, navigation in GUIDES:
        source = subprocess.check_output(['git', 'show', f'{BASE}:kividas-web/public/gateway/{role}{filename}'], cwd=WEB)
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
            c.drawString(44, 22, 'Kividas · 网关配置教程 · r6 一键配置更新')
            c.drawRightString(old_page.rect.width - 44, 22, f'{index + 1} / {len(doc)}')
            c.save()
            old_page.show_pdf_page(old_page.rect, fitz.open(stream=buf.getvalue(), filetype='pdf'), 0, overlay=True)
        doc.set_metadata({**doc.metadata, 'title': f'Claude 网关配置教程 - {platform} - r6 一键配置更新',
                          'subject': '必须关闭遥测与错误上报，下载并运行最新 r6 一键配置',
                          'modDate': 'D:20261116120000+08\'00\''})
        output = OUT / role / filename
        output.parent.mkdir(parents=True, exist_ok=True)
        doc.save(output, garbage=4, deflate=True)
        PUBLIC.joinpath(role, filename).write_bytes(output.read_bytes())
        print(filename, len(doc), 'pages', output.stat().st_size, 'bytes')
