# 验证记录

日期：2026-09-23。测试对象为独立 `kividas-web`，未修改线上数据。

## 自动验证

- `npm run build` 通过：TypeScript 检查与 Vite 生产构建成功。
- `npm test` 通过：3 个测试文件、28 项测试。
- 覆盖模型权限规范化、已下架模型保留、访客全不选/全选语义、聊天分支保留、SSE 分块解析、CSV 转义、套餐空值/零值、礼品卡禁用与作废不同接口、服务端错误传播、会话失效、超管角色白名单。
- 管理页面为独立延迟加载模块，非 admin 会话不挂载该模块。

## Chrome 本地示例验证

- 桌面首页、模型选择、发送与流式显示、历史记录保存。
- Subscriptions：编辑套餐描述并保存，显示成功提示。
- Gift Cards：批量生成 2 张示例卡并显示结果；禁用示例卡后按钮变为 Enable。
- Guest Access：保存每日额度；添加示例 IP 黑名单后显示记录。
- Projects：列表可进入项目详情并显示新对话入口。
- 390 × 844 手机尺寸：首页、侧栏、管理表单无横向溢出；检查后已恢复桌面尺寸。
- 普通用户：侧栏和账号菜单没有 Admin Panel；直接打开三个管理地址均返回首页。用户自己的 Subscription 入口仍保留，用于查看本人套餐和兑换礼品卡。
- 超管：管理入口与三个管理页保留。

本地示例使用内存数据，重启后还原。此结果不能替代真实后端验收。

## 后端权限依据

现有后端 `get_admin_user` 严格要求数据库用户的 `role == 'admin'`。Subscriptions / Gift Cards 的所有 admin 接口和 Guest Access 管理接口均依赖该校验。当前角色模型没有额外的 `superadmin` 角色；独立前端沿用既有最高管理角色 `admin`，不新增或提升账号权限。

## 尚未执行

- 真实后端测试账号的登录、聊天、附件处理、OAuth 完整流程。
- 真实后端的套餐保存、卡片生成/撤销、访客策略写入；未为测试创建或消耗线上礼品卡。
- 生产部署与域名切换。

接入验收时使用测试账号、测试套餐及测试礼品卡，确认真实网关同步和配额执行后，再切换生产静态资源。旧部署可用于回滚。

## 本次追加：Code、Effort、用户 Overview

- 最新构建通过，自动测试共 6 个文件、46 项通过。
- 新增测试覆盖独立平台版本、旧版下载接口兼容、无扩展名 CLI 下载、下载域名校验、可用模型分组、Effort 参数传递、用户套餐精确到期时间、额度同步部分失败及专用封禁接口。
- Chrome 示例验证：Code 两个平台安装包、CLI 版本与四个平台下载链接正确显示，复制按钮显示 Copied。
- Chrome 示例验证：官方风格主模型菜单、Effort 子菜单、More models；选择 Extra 后，示例服务实际收到 `params.reasoning_effort: xhigh` 并在回复中回显，保存后的会话仍显示 Extra。
- Chrome 示例验证：用户列表和搜索；编辑示例用户姓名成功；套餐由 Max 7x 改为 Max 10x，列表更新；可访问资源预览显示模型/知识/工具。
- 普通用户直接打开 `/admin/users/overview` 返回首页且没有 Admin Panel；同一普通用户可打开 Code 下载页。
- 手机 390px Code 下载页无横向溢出，桌面安装包与 CLI 内容可纵向浏览。

所有写入验证仍只操作本地内存示例。没有执行线上账号修改、封禁、密码重置、额度重置或删除。用户 Groups 的独立权限配置页面尚未迁移。
- 手机 390px Effort 子菜单验证通过：切换为单面板并提供返回入口，五档选项可见，无横向溢出；已恢复桌面视口。

## 本次追加：Claude 子菜单、Skills 与 Kividas Code 品牌

- 56 项自动测试通过（8 个文件）；最新 TypeScript 与生产构建通过。
- 用用户已登录的 Chrome 只读检查 Claude：侧栏 More、编辑侧栏、会话菜单、过滤菜单、Projects 创建、Artifacts、Scheduled 手动创建与频率、Customize 三个分类与创建表单，以及设置的各主要分类。细目和能力差异见 `CLAUDE-UI-AUDIT.md`。
- 本地 Skills：从 Discover 添加 Learn，Yours 数量更新；Use in chat 后显示选中项；示例聊天响应确认收到该 skill ID 和 `xhigh`，并保存到聊天数据。
- 本地 Scheduled：创建工作日 09:00 任务，页面显示正确规则；Pause 生效，Run now 可查看成功记录。示例不执行真实后台任务。
- 本地会话菜单：Pin 操作成功；分栏 Settings 的 General 与 Account 正常显示。
- Chrome 桌面检查 Customize 新布局，390 × 844 手机检查确认 `scrollWidth == innerWidth == 390`，已恢复视口并关闭临时检查标签。
- 使用安装应用内的原始蓝紫圆环图标，覆盖 favicon、touch icon、侧栏、欢迎页、聊天头像和 Code 下载页。
- 原 Open WebUI 工作树仍干净；无线上部署、无 Claude 账号配置修改。
- 项目详情验证：保存项目 Instructions 后，重新显示已保存内容；原会话入口保留。

## 本次追加：目录页与缺失导入修复

- 补齐 `src/pages/Marketplace.tsx`，`Customize.tsx` 的导入可正常解析；内置浏览器实际打开 Skills、Connectors、Plugins，无 Vite 错误遮罩。
- 最新 TypeScript / Vite 构建成功，9 个文件、65 项测试通过。新增覆盖插件私有授权、部分失败重试、他人共享技能排除、目录完整性、连接器地址校验、配置保留和重复连接防护。
- 内置浏览器示例验证：Data 选择 sql-queries 添加后 Yours 显示 1；重新进入详情可 Use in chat，输入框显示选中的 sql-queries。
- 内置浏览器示例验证：添加 `https://example.test/mcp` 的无认证连接，保存后 Yours 显示连接，Use in chat 后输入框显示连接器名称。该验证只经过内存模拟接口，没有向示例地址联网。
- 修复目录渐变使用未定义颜色变量，以及公开技能的多行描述解析；自定义导入包不显示不适用的 Apache 许可证。
- 尚未执行第三方账号 OAuth 授权、供应商 MCP 工具调用或线上配置写入。公开插件仅导入 Markdown 指令，不执行脚本/代理/Hook。
- 旧 `kb_open-webui` 工作树仍干净，无生产部署。
