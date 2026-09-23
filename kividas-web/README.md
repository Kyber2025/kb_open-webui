# Kividas Web

独立重写的 Kividas 网页前端，根据 Claude 可见界面实现，保留 Kividas 品牌和现有后端。这是新编写的 React / TypeScript 源码，不是 Anthropic 的私有源码，不依赖 Open WebUI 的前端组件或运行时。部署时由仓库根目录 Dockerfile 构建此独立前端，原后端和数据保持沿用。

## 启动

需要 Node.js 20.19+ 或 22+。

```sh
npm ci
npm run demo
```

打开 `http://127.0.0.1:5180`。顶部显示 `Local preview · Sample data · No production changes`。示例服务仅存在于开发插件中，使用内存数据，重启后还原，不读取或修改线上数据，不进入生产构建。

连接原后端：

```sh
cp .env.example .env
# 在 .env 中设置 BACKEND_ORIGIN
npm run dev
```

开发服务器将 `/api`、`/oauth`、`/ws` 代理至该后端，这个模式会访问真实数据。账号需在本地域名重新登录；不会从 Chrome 提取线上凭据。同域部署继续使用现有 token 会话与 OAuth cookie。

```sh
npm test
npm run build
```

输出为 `dist/`，可以独立托管，不需要旧前端目录。

## 已实现

- Claude 风格侧栏、主页、聊天输入框、提示分类、明暗主题与手机布局。
- 模型主菜单按 Fable / Opus / Sonnet / Haiku 展示当前账号可用模型，其余模型在 More models 中搜索。Effort 子菜单提供 Low / Medium / High / Extra / Max，Extra 对应网关的 `xhigh`。所选强度随聊天请求发送，并保存到会话和本地偏好；不支持推理的模型不发送该参数。实际支持范围由所选模型和服务端决定，不照搬 Claude 的计费倍率。
- 原账号登录、访客、会话失效处理、流式回复、停止生成、Markdown 安全渲染、附件、搜索开关、语音输入、临时聊天、历史与项目文件夹。保存旧会话时保留未选中的历史分支。
- 用户套餐信息、礼品卡兑换。
- Code 下载页：Windows/macOS 客户端、独立版本号、当前平台优先；CLI 安装命令复制、CLI/Claude Code 版本、macOS/Windows/Linux x64/Linux arm64 下载。更新信息来自原后端；失败时保留已核对的桌面安装包和固定 CLI 安装命令。

## 管理页面

| 路由 | 功能 |
| --- | --- |
| `/admin/users/overview` | 用户列表、分页、服务端搜索/排序、角色、姓名邮箱、创建/编辑账号、密码重置、头像地址；套餐授予/撤销/到期时间、5h/每周/Fable 用量和重置；封禁/解封、删除、访问权限预览、用户聊天查看/删除。 |
| `/admin/subscriptions` | 套餐创建、默认初始化、保存/删除、启用、价格/期限、5h/每周限额、超额倍率、描述、排序、模型权限。空限额与 0 语义区分，保留已下架模型配置。 |
| `/admin/gift-cards` | 批量生成、套餐/数量/期限/备注、批次复制/CSV、Excel 导出、搜索/筛选、启停、删除、已兑换卡作废并撤销订阅。 |
| `/admin/guest` | 访客开关、每日额度、完整模型目录、全选/全不选、IP 黑名单。全不选显式阻止模型，避免空允许列表被理解为允许全部。 |

所有管理入口和页面仅对后端返回 `role: admin` 的会话可见，普通用户直接打开 `/admin/*` 会返回首页，不加载管理页面。后端仍对每个管理接口校验权限，不能靠前端声明获得权限。用户自己的 Subscription 入口仍可用。

沿用现有后端的首位管理员保护、密码同步和跨服务封禁。套餐保存后若返回额度同步失败，页面显示部分失败提示。管理员提权、删除、撤销和额度重置等操作在页面内提供确认。没有修改线上账号角色。

## 当前边界

继续使用原后端、数据库和权限。未复制 Claude Cowork 或其他服务端代理能力。Artifacts 仅显示最近 20 条会话里的代码块，不执行生成代码。

本次包含用户 Overview 和三个指定管理页；独立 Groups 权限配置、其余旧管理模块、注册/找回密码、支付订单页面及图片/视频生成流程尚未迁入。整站切换前需确认这些额外模块的保留范围。

## 部署与验证

同域部署使用现有 API/OAuth/WebSocket 转发，参考 `deploy/nginx.locations.conf`。不要将后端密钥写入前端；旧静态文件保留用于回滚。

独立前端已部署至 `chat.kividas.com`，沿用原后端和数据。真实账号登录、聊天回复与刷新恢复、套餐目录和管理用量读取已验证；其他验收范围见验证记录。未为验证而修改线上套餐、用户或访客策略。

接口清单见 `API-CONTRACT.md`，验证记录见 `VERIFICATION.md`。

### Claude navigation review (2026-09-23)

The signed-in Chrome UI was reviewed and recorded in [CLAUDE-UI-AUDIT.md](CLAUDE-UI-AUDIT.md). The frontend now includes real Skills CRUD and chat selection, authorized connector selection, Scheduled task management, pinned chat menus, project descriptions/instructions, artifact search/download, and settings for profile/instructions/usage/memory/export. Account/server permissions still apply. Claude-specific remote agents, design runtime and marketplace services are not reproduced by frontend menus.

The brand icon comes from the installed Kividas Code application and is used for browser favicon, touch icon, sidebar, greeting and assistant avatar.

### Connectors 与 Plugins 目录

- Connectors：12 个服务入口、主题推荐、分类、搜索和 Yours。管理员可验证并保存私有远程 MCP 连接，支持 OAuth、API token 和无认证；用户授权使用自己的服务商账号。
- Plugins：17 个公开插件、181 个 Markdown Skills，支持查看来源/许可证、逐项选择、添加、部分失败重试、使用及移除自己安装的技能；支持导入自定义 JSON 指令包。
- 内容来自 Anthropic 公开 Apache-2.0 插件仓库，保留署名与来源。这里安装的是可由现有后端使用的技能指令，不包含 Claude 私有插件市场、脚本沙箱、Hooks 或子代理运行时。
- Google 等服务需要先提供适配的 MCP 网关；第三方服务的 OAuth 注册和授权取决于供应商支持。目录存在不代表已经连通账号。

来源、适配方式及限制见 [CATALOG-SOURCES.md](CATALOG-SOURCES.md)。

### 仅替换前端的正式发布

`deploy/Dockerfile.release` 可基于线上原后端镜像的精确 digest 构建静态资源升级，保留相同 Python 运行时、后端和入口。构建上下文为此目录，传入 `BASE_IMAGE` 与 `WEB_REVISION`。镜像通过既有 ECR、compose 和 ALB 滚动上线；不使用本地 demo 服务。仓库根 Dockerfile 同时支持从源码完整重建。
