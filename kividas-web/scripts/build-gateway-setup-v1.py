from pathlib import Path
import hashlib,re,shutil,zipfile,json

root=Path(__file__).resolve().parent
workspace=root.parent
readme='''Kividas 一键配置 · v1（2026-11-17）
初始化接入配置 · 用量 MCP · 关闭遥测 · 主对话 1 小时缓存

开始使用
1. 完整解压，保留同文件夹内全部文件。先保存任务，完全退出 Claude，并结束 CLI 会话。
2. Windows 双击“配置Windows.cmd”；Mac 参照“Mac启动说明.txt”运行“配置Mac.sh”。
3. 默认选择“一键配置 · 桌面端与 CLI”，也可仅配置其中一个客户端。
4. 读取原客户接入资料 TXT，或填写配套 Gateway API key 与安装识别码。
5. 一次完成接入初始化、用量 MCP、遥测和主对话 1 小时缓存设置；重新打开客户端并新建会话。

菜单
- 一键配置 · 桌面端与 CLI（默认）
- 仅配置桌面端
- 仅配置 CLI
- 恢复上一次配置
用量 MCP 和关闭遥测已整合进配置流程，不再单独选择。

初始化会做什么
- 先备份，再重建选定客户端的网关地址、认证和自定义请求头。
- CLI 清理旧认证帮助程序、强制登录设置、旧 provider 选择和旧模型覆盖。
- 自定义请求头重新建立，只保留本次接入所需的安装识别码及 v1 配置标识；这些内部请求头不会转发给上游。
- 安装识别码沿用原配套值，不随机生成或更换；不要在其他设备复用。
- 配置远程 kividas-usage MCP，保留其他 MCP；旧的同名本地/远程用量配置会合并。
- 关闭选定客户端的遥测和错误上报；CLI 同时关闭已启用的 OpenTelemetry 导出。
- 将 Code 主对话提示缓存设为 1 小时，修正强制 5 分钟的覆盖项；不设置子代理缓存时长，沿用客户端默认（通常 5 分钟）或用户已有设置。

会保留什么
项目文件、CLAUDE.md、其他 Markdown、记忆、聊天历史、原权限规则、hooks、插件和其他 MCP 均保留。
企业代理和证书设置不自动删除。损坏 JSON、企业托管策略或自定义配置目录会停止自动配置。
工具不读取 Mac 钥匙串，不要求管理员密码，也不安装或更新 Claude。

验证与恢复
写入前验证用量服务的连接；这不是模型推理测试，也不会刷新上游模型用量。
完成后新建会话并发送一条消息。CLI 可用 /status 检查连接，再请求“查询我的 Kividas 用量”。
首次使用 MCP 时按客户端提示授权。用量 MCP 适用于 CLI / Code 本地会话。
重复运行不会创建重复配置；写入失败会回滚。恢复遇到后续修改会停止，避免覆盖新更改。
再次运行并选择“恢复上一次配置”，可撤销最后一批配置。
Mac 备份：~/Library/Application Support/KividasSetup/backups/
Windows 备份：%LOCALAPPDATA%\\KividasSetup\\backups\\
备份和配置文件可能含凭据，仅保存在本机并限制访问，请勿分享。

关于官方账号和全局配置
CLI 使用 ~/.claude/settings.json；官方 Desktop 的 Code 会话也可能读取这份全局配置。
本工具按选择配置 Kividas 接入，不提供官方账号与网关的完全隔离环境。
需要两种模式共存时，请先确认配置作用域；恢复上一次配置不一定等于切回官方账号。
桌面端启用 ToolSearch。共享 Code 配置写入 promptCacheTtl=1h 和 CLAUDE_CODE_PROMPT_CACHE_TTL=1h，并清除强制 5 分钟的覆盖效果；主对话由客户端生成 1 小时缓存请求，网关保持请求正文不变。子代理及后台任务不强制改为 1 小时。
这些设置适用于支持上述选项的 Claude Code / Desktop Code；纯桌面聊天或其他 API 客户端不在此范围。项目或企业管理策略、自定义启动程序仍可能覆盖设置；若仍出现 5 分钟缓存，请保留脱敏用量记录联系服务方。
1 小时缓存写入成本高于 5 分钟，但可减少长间隔后的重复写入；不保证每次都命中或总用量一定减少。
下载包继续使用 v1 名称。已配置用户也需重新下载运行，再完全重启客户端并新建会话，旧会话不会因服务器发布自动更新。
CLI 和桌面加入第一方地址兼容设置，这不会建立官方订阅登录，也不保证具备全部订阅功能。
Mac 使用系统登录任务设置桌面启动环境，Windows 使用用户环境变量；恢复功能同时恢复此前启动环境和桌面模式。无需安装常驻辅助软件。
关闭遥测不等于停止所有网络请求，也不移除正常推理正文中的工具说明、路径或已加载的指令文件。
初始化是配置维护，不是解除账号限制或保证不会封号的措施。

服务与教程
用量服务：https://ai.kividas.com/api/mcp/usage
教程：https://ai.kividas.com/api/mcp/usage/guide
下载页面：https://chat.kividas.com/code
'''
mac='''Mac 启动说明 · v1

1. 完整解压工具，打开“终端”。
2. 输入 /bin/bash 和一个空格。
3. 将同文件夹内的“配置Mac.sh”拖入终端，再回车。
4. 选择配置范围，导入原接入 TXT；初始化、用量 MCP、关闭遥测和主对话 1 小时缓存一起完成。
5. 重新打开 Claude / CLI 并新建会话。

无需 sudo、管理员密码或钥匙串密码。
请保留 core.js、mac.js 与入口脚本在同一文件夹。
运行前保存任务并退出 Claude；需要撤销时选择“恢复上一次配置”。
SHA256SUMS.txt 可核对文件完整性。
'''
results=[]
for reseller in (False,True):
    dest=workspace/'dist-setup'/('reseller' if reseller else 'direct')/'Kividas一键配置'
    dest.mkdir(parents=True,exist_ok=True)
    for name in ['core.js','mac.js','windows.ps1','配置Mac.sh','配置Windows.cmd']:
        shutil.copyfile(root/'gateway-setup-v1'/name,dest/name)
    (dest/'配置Mac.sh').chmod(0o755)
    for name,body in [('使用说明.txt',readme),('Mac启动说明.txt',mac)]:
        if reseller:body=body.replace('https://chat.kividas.com','https://proxy.kividas.com')
        (dest/name).write_bytes(('\ufeff'+body.replace('\n','\r\n')).encode())
    sums=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(dest.iterdir()) if p.name!='SHA256SUMS.txt')
    (dest/'SHA256SUMS.txt').write_text(sums)
    out=workspace/'public/gateway'/('reseller' if reseller else '')/'kividas-gateway-setup-v1.zip'
    out.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for p in sorted(dest.iterdir()):
            data=p.read_bytes()
            assert not re.search(rb'sk-kiv-desktop-[A-Za-z0-9_-]{40,128}',data),'Credential-like literal in package'
            entry=zipfile.ZipInfo('Kividas一键配置/'+p.name,(2026,11,17,12,0,0));entry.create_system=3
            entry.external_attr=((0o100755 if p.suffix=='.sh' else 0o100644)<<16);entry.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(entry,data)
    with zipfile.ZipFile(out) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist())==8
        for line in sums.splitlines():
            digest,name=line.split('  ',1)
            assert hashlib.sha256(archive.read('Kividas一键配置/'+name)).hexdigest()==digest
    results.append({'file':str(out),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()})
(workspace/'dist-setup/v1-packages.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
for item in results:print(json.dumps(item,ensure_ascii=False))
