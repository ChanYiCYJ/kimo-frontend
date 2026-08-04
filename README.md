# Kimo React 前端

基于 [kimo-fastapi](https://github.com/ChanYiCYJ/kimo-fastapi) 后端 API 重构的 **React 前端**，模仿并优化了原 [Kimo](https://github.com/ChanYiCYJ/Kimo)（Flask + Jinja）的博客风格。

## ✨ 技术栈

- **React 19** + **TypeScript** + **Vite 8**
- **Tailwind CSS v4**（`@tailwindcss/vite`）
- **React Router v7**（SPA 客户端路由）
- **react-markdown + remark-gfm + rehype-highlight**（客户端 Markdown 渲染与代码高亮）
- **@uiw/react-md-editor**（后台写作编辑器，支持图片上传）
- **DOMPurify**（自定义页面 HTML 消毒）

## 🎨 设计亮点（对比原 Kimo 的优化）

| 维度 | 原 Kimo（Flask） | 本前端（React） |
| --- | --- | --- |
| 页面切换 | 整页刷新 | SPA 无刷新路由 |
| 写作编辑器 | Vditor | @uiw/react-md-editor（React 原生） |
| Markdown 渲染 | 服务端 HTML | 客户端渲染（防 XSS） |
| 登录态 | Session | JWT + localStorage + Context |
| 提示反馈 | alert 弹窗 | 轻量 Toast 通知 |
| 图片上传 | - | 编辑器内上传 + 封面/头像上传 |
| 代码体积 | - | 后台页面按需加载（Route-level code splitting） |

## 🤖 AI 对话中心（/ai）

内置一套完整的 **ChatGPT 风格 AI 对话应用**，管理员可在后台「AI 管理」创建/编辑多个 AI 助手，访客可随时切换：

- **会话管理**：多会话、自动标题、手动重命名、删除、导出/导入全部（JSON）
- **Coser 角色扮演**：为 AI 配置人设（角色提示词）+ 站点内容（选文章/分类）+ 自定义设定（本机笔记，可导入 Markdown），可导出设定
- **网络搜索**：优先走站点后端 `/api/search`（可绕过地域限制），回退维基百科（zh→en）；默认关闭，可在用户设置中开启
- **自定义模型 API**：非管理员可填自己的接口/Key/模型（存本机，不传服务器），自动解除次数/冷却限制，并支持自定义提示词
- **水印**：AI 生成内容带多重水印（含模型名 + API 状态），防止被冒用
- **写文章**：后台开关 `enable_ai_articles` 开启后，可直接在对话中撰写并发布文章
- **适用范围**：每个助手可设「仅管理员可用」；主页「AI」菜单可用 `show_ai` 关闭；访客自定义 API 可用 `enable_custom_api` 开关
- **用户设置**：侧边栏「用户设置」面板整合 自动朗读/网络搜索、导出导入、模型 API、使用文档、GitHub 开源链接

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动前端（默认代理到 localhost:8000 的 FastAPI 后端）
npm run dev
```

访问 http://localhost:5173

## 🔌 后端对接

前端通过 Vite 代理将 `/api` 与 `/static` 转发到 FastAPI 后端：

```ts
// vite.config.ts
server: {
  proxy: {
    '/api': { target: 'http://localhost:8000', changeOrigin: true },
    '/static': { target: 'http://localhost:8000', changeOrigin: true },
  },
}
```

可用的环境变量（`.env`）：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `VITE_API_BASE` | API 基础路径 | `/api/v1` |
| `VITE_USE_MOCK` | 强制使用演示数据（`1`） | 关闭 |
| `VITE_MEDIA_BASE` | 静态资源/图片源（跨源部署时拼前缀） | 关闭 |

## 🗺 路由

| 路径 | 说明 |
| --- | --- |
| `/` | 首页（文章列表、分页、分类筛选、搜索） |
| `/article/:id` | 文章详情 |
| `/page/:name` | 自定义页面（markdown / list / link） |
| `/ai`、`/ai/:botId` | **AI 对话中心**（多助手切换） |
| `/login` | 登录 / 注册 |
| `/dashboard` | 管理后台（需管理员 role=0） |
| `/dashboard/articles*` | 文章管理 / 新建 / 编辑 |
| `/dashboard/pages*` | 页面管理 / 新建 / 编辑 |
| `/dashboard/ai` | **AI 助手管理**（统一管理所有助手） |
| `/dashboard/categories` | 分类标签 |
| `/dashboard/settings` | 站点设置（含 AI 改写、功能开关、默认落地页） |
| `/dashboard/users` | 用户管理 |

> 💡 后端未启动时，前端会自动回退到**演示数据**（`src/lib/mock.ts`），便于本地预览 UI。

## ☁️ 一键部署到 Vercel

本项目**不内置任何后端地址**，通过 `vercel.ts` 在构建时读取 `API_BACKEND` 环境变量，动态生成 `/api` 与 `/static` 的反代规则（服务端转发，后端无需开启 CORS），其余路由回退到 `index.html`（SPA 客户端路由）。

> 点击下方按钮即可把本仓库 **克隆到你的账号** 并引导填写 `API_BACKEND`：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FChanYiCYJ%2Fkimo-frontend&env=API_BACKEND&envDescription=%E5%90%8E%E7%AB%AF%E5%9C%B0%E5%9D%80%EF%BC%88%E4%B8%8D%E5%90%AB%E5%B0%BE%E9%83%A8%E6%96%9C%E6%9D%A0%EF%BC%8C%E5%A6%82%20https%3A%2F%2Fapi.example.com%EF%BC%89&project-name=kimo-frontend&repository-name=kimo-frontend)

### 环境变量

| 变量 | 必填 | 说明 | 示例 |
| --- | --- | --- | --- |
| `API_BACKEND` | ✅ | 后端 FastAPI 地址（**不带尾部斜杠**），用于反代 `/api`、`/static` | `https://api.example.com` |
| `VITE_USE_MOCK` | 可选 | 置 `1` 强制使用演示数据（不联网） | `1` |

> 未设置 `API_BACKEND` 也能构建成功，但站点无法联网（仅渲染静态页面），构建日志会给出提醒。

### 方式一：Deploy 按钮 / GitHub 集成

1. 点击上面的 **Deploy with Vercel** 按钮（或到 Vercel **Add New → Project** 导入本仓库）
2. 在配置向导中填写 `API_BACKEND`（指向你自己的后端）
3. 点击 **Deploy**，完成后即可访问 `https://<project>.vercel.app`

### 方式二：Vercel CLI

```bash
npm i -g vercel
vercel login
vercel link
vercel env add API_BACKEND production https://your-api.example.com
vercel --prod
```

> 💡 前端请求仍走相对路径 `/api/v1`（`VITE_API_BASE` 保持默认），由 Vercel 反代到 `API_BACKEND`，因此同源、无跨域问题。

## ⚡ 一键部署到 Cloudflare Workers

同样**不内置后端地址**，用 `worker.js` 在 Worker 边缘把 `/api`、`/static` 反代到真实后端（服务端转发，无 CORS 问题），静态资源由 Cloudflare **Assets** 托管，前端路由刷新回退到 `index.html`（`wrangler.jsonc` 中 `not_found_handling = "single-page-application"`）。

> 点击下方按钮，把本仓库导入你的 Cloudflare 账户、构建并创建 Worker：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ChanYiCYJ/kimo-frontend)

> 一键部署完成后，还需在控制台做两步：
> 1. Worker「设置 → 变量和 Secret」添加 `API_BACKEND`（后端地址，**不带尾部斜杠**，如 `https://api.example.com`）
> 2. Worker「设置 → 域」绑定自定义域名（如 `v2.yogofor.top`），即可访问
>
> 若按钮未能自动构建（`dist` 不在仓库中），请使用下方 CLI 方式。

### 方式一：CLI 部署

```bash
# 1. 安装依赖（已含 wrangler）
npm install

# 2. 配置后端地址（写入 Worker 环境变量/Secret）
npx wrangler secret put API_BACKEND
# 输入：https://your-api.example.com（不带尾部斜杠）

# 3. 构建并部署
npm run deploy:cf        # 等价于 npm run build && wrangler deploy
```

### 方式二：Cloudflare Dashboard

1. 构建：`npm run build`（产出 `dist/`）
2. 在 Cloudflare 控制台创建 **Workers**，把 `dist` 作为 **Assets** 上传，`worker.js` 作为 Worker 脚本
3. 在 Worker「设置 → 变量和 Secret」添加 `API_BACKEND`
4. 在「设置 → 域」绑定自定义域名（如 `v2.yogofor.top`）

### 本地预览（Cloudflare）

```bash
cp .dev.vars.example .dev.vars   # 填入 API_BACKEND
npx wrangler dev                 # 或 npm run dev:cf
```

| 文件 | 作用 |
| --- | --- |
| `wrangler.jsonc` | Worker 配置：`assets`(dist 静态托管 + SPA 回退)、`API_BACKEND` 变量 |
| `worker.js` | 反代 `/api`、`/static` 到后端，其余交给 Assets |
| `.dev.vars.example` | 本地 `wrangler dev` 环境变量示例 |

> 💡 部署到任意平台（Vercel / Cloudflare / 宝塔 Nginx）的**落地页跳转逻辑一致**：`route_map` 精确匹配优先。若某个精确域名被父域后缀匹配抢先导致不跳转（如 `v2.yogofor.top` 被 `yogofor.top` 抢成 `/`），请确保使用最新代码（该 bug 已修复）。

## 🌍 域名与合规（国内外分站）

若国内主站与海外镜像同时存在（例如国内 `yogofor.top` + 海外 `v2.yogofor.top`），可在后台「站点设置 → 功能开关 → 默认落地页」配置：

- **域名 → 落地页映射**（`route_map`，JSON，优先）：
  ```json
  {
    "yogofor.top": "/",
    "v2.yogofor.top": "/ai"
  }
  ```
- **默认落地页**：`default_route`（兜底，对所有未列出的域名生效）
- 匹配规则：**精确域名优先**，再子域名后缀匹配——例如 `v2.yogofor.top` 精确命中 `v2.yogofor.top` 落 `/ai`，而 `www.yogofor.top` 无精确项时回退匹配父域 `yogofor.top` 落 `/`；访问 `127.0.0.1` 需单独写 `"127.0.0.1"` 键。
- 后台设置里 `route_map` 带**实时 JSON 校验**（非法红字 / 合法绿字），非法内容会阻止保存。
- 访客打开首页时会按域名自动重定向到对应页面，便于分站差异化与合规

> 合规提示：AI 生成内容带水印，请勿冒充人工原创用于需要真实性的场合；请遵守部署所在地法律与所用模型服务条款。

## ⚠️ 网络搜索说明

AI 的网络搜索默认**关闭**，在用户设置中开启。搜索优先调用站点后端 `/api/search`（若后端实现了搜索代理，可绕过 CORS 与地域限制）；否则回退到维基百科（zh→en）。由于维基百科在中国大陆不可直接访问，若你的主站在国内，建议在后端实现 `/api/search` 代理，或将主站放在海外/Vercel。

## � 前后端同步热更新

前后端是两个独立进程，各自拥有热重载能力：

| 端 | 命令 | 热更新机制 |
| --- | --- | --- |
| 前端（Vite） | `npm run dev` | **HMR**：保存 `.tsx/.css` 立即局部刷新，不清空状态 |
| 后端（FastAPI） | `uvicorn app.main:app --reload` | **--reload**：保存 `.py` 自动重启服务（秒级） |

两者通过 Vite 代理串联：前端请求 `/api/*` 转发到 `:8000`，因此后端代码一改、刷新即可看到新接口，无需处理跨域。

### 一条命令同时启动（推荐）

前提：把后端克隆为前端项目的**同级目录**：

```bash
# 目录结构
~/kimo-fastapi     # 后端
~/vite-test        # 前端（本项目）
```

然后在前端目录执行：

```bash
npm run dev:all
```

它会用 `concurrently` 同时启动：
- `API`（蓝色）：`cd ../kimo-fastapi && uvicorn app.main:app --reload --port 8000`
- `WEB`（绿色）：`vite`（HMR）

任意一端退出（如 Ctrl+C）会连带结束另一端（`-k` 参数）。

### 单独启动（排查问题用）

```bash
# 终端 1 - 后端
cd ../kimo-fastapi && uvicorn app.main:app --reload

# 终端 2 - 前端
npm run dev
```

### ⚠️ 注意事项

- 后端需要 `.env`（数据库连接等），首次启动按 `kimo-fastapi/.env.example` 配置好 MySQL
- 仅改业务代码（路由/service/CRUD）时 `--reload` 足够；**改 Tortoise 模型**后需执行 `aerich migrate && aerich upgrade` 才会生效（热重载不会自动建表）
- 若前后端不在同一机器/域名（不使用 Vite 代理），则需在后端开启 CORS 并设置 `VITE_API_BASE` 为完整地址

## �📁 目录结构

```
src/
├── main.tsx / App.tsx        # 入口与路由
├── index.css                 # Tailwind + 全局样式 / Markdown 排版
├── lib/
│   ├── api.ts                # API 客户端（统一响应解包、JWT、演示回退）
│   ├── types.ts              # 与后端 schema 对应的类型
│   ├── mock.ts               # 演示数据
│   ├── auth.tsx / site.tsx / theme.tsx / toast.tsx / format.ts
│   ├── ai.ts                 # 后台「AI 改写」调用（复用 AI 管理模型）
│   ├── search.ts             # 网络搜索（后端 /api/search → 维基百科回退）
│   ├── kb.ts                 # Coser 知识库（站点内容选择 + 本机笔记 + 导出）
│   └── localCfg.ts           # 访客自定义模型 API（本机存储）
├── components/
│   ├── Layout.tsx            # 前台布局（含域名重定向 / AI 沉浸式分支）
│   ├── Header.tsx / Sidebar.tsx / PostCard.tsx / Pagination.tsx
│   ├── Markdown.tsx / MdEditor.tsx / Modal.tsx / Spinner.tsx / ui.tsx
│   ├── AIChat.tsx            # AI 对话核心（会话/Coser/搜索/水印/限制）
│   ├── KbModal.tsx           # Coser 角色扮演设定弹窗
│   ├── LocalApiModal.tsx     # 自定义模型 API 弹窗
│   ├── UserSettingsPanel.tsx # 用户设置面板（侧滑）
│   ├── UsageDocModal.tsx     # 使用文档
│   ├── ArticleComposerModal.tsx # 对话内写文章
│   ├── BotEditorModal.tsx    # AI 助手编辑弹窗
│   └── admin/AdminLayout.tsx # 后台布局（左侧图标导航）
└── pages/
    ├── Home.tsx / Article.tsx / PageView.tsx / AICenter.tsx / Login.tsx / NotFound.tsx
    └── admin/
        ├── DashboardHome.tsx   # 统计概览 + 快捷入口
        ├── ManageArticles.tsx / ArticleEditor.tsx   # 文章管理/写作
        ├── ManagePages.tsx / PageEditor.tsx         # 页面管理/编辑
        ├── AIManage.tsx        # AI 助手统一管理
        └── Settings.tsx        # 站点设置（AI 改写 / 功能开关 / 落地页）
```

## 🗺 路由

| 路径 | 说明 |
| --- | --- |
| `/` | 首页（文章列表、分页、分类筛选、搜索） |
| `/article/:id` | 文章详情 |
| `/page/:name` | 自定义页面（markdown / list / link） |
| `/login` | 登录 / 注册 |
| `/dashboard` | 管理后台（需管理员 role=0） |
| `/dashboard/articles` | 文章管理 |
| `/dashboard/articles/new` | 新建文章 |
| `/dashboard/articles/:id/edit` | 编辑文章 |
| `/dashboard/pages` | 页面管理 |
| `/dashboard/pages/new` | 新建页面 |
| `/dashboard/pages/:id/edit` | 编辑页面 |
| `/dashboard/settings` | 站点设置 |

## 🛠 常用命令

```bash
npm run dev      # 开发服务器
npm run build    # 类型检查 + 生产构建
npm run lint     # oxlint 代码检查
npm run preview  # 预览生产构建
```

---

Made with ❤️ · 前端重构自 [Kimo](https://github.com/ChanYiCYJ/Kimo)，对接 [Kimo API](https://github.com/ChanYiCYJ/kimo-fastapi)

