# Kimo React 前端

基于 [kimo-fastapi](https://github.com/ChanYiCYJ/kimo-fastapi) 后端 API 重构的 **React 前端**，模仿并优化了原 [Kimo](https://github.com/ChanYiCYJ/Kimo)（Flask + Jinja）的博客风格。

## ✨ 技术栈

- **React 19** + **TypeScript** + **Vite 8**
- **Tailwind CSS v4**（`@tailwindcss/vite`）
- **React Router v7**（SPA 客户端路由）
- **Milkdown v7**（Markdown 编辑器，支持表格 / 代码高亮 / 图片上传，后台写作与 Agent 编辑器共用）
- **react-markdown + remark-gfm + rehype-highlight**（客户端 Markdown 渲染与代码高亮）
- **pixi.js + pixi-live2d-display**（Live2D 看板娘实时渲染）
- **DOMPurify**（自定义页面 HTML 消毒）
- **Vitest**（单元测试，`src/lib/__tests__/` 覆盖 300+ 用例）

## 🎨 设计亮点（对比原 Kimo 的优化）

| 维度          | 原 Kimo（Flask） | 本前端（React）                                |
| ------------- | ---------------- | ---------------------------------------------- |
| 页面切换      | 整页刷新         | SPA 无刷新路由                                 |
| 写作编辑器    | Vditor           | Milkdown（React 原生）                         |
| Markdown 渲染 | 服务端 HTML      | 客户端渲染（防 XSS）                           |
| 登录态        | Session          | JWT + localStorage + Context                   |
| 提示反馈      | alert 弹窗       | 轻量 Toast 通知                                |
| 图片上传      | -                | 编辑器内上传 + 封面/头像上传                   |
| 代码体积      | -                | 后台页面按需加载（Route-level code splitting） |

## 🤖 AI 对话中心（/ai）

内置一套完整的 **ChatGPT 风格 AI 对话应用**，管理员可在后台「AI 管理」创建/编辑多个 AI 助手，访客可随时切换，并可与 **Live2D 虚拟形象** 实时互动：

### 💬 会话管理

- 多会话、自动标题、手动重命名、删除、导出/导入全部（JSON）
- 对话记忆（本机问答对）+ 自动压缩（防 token 滥用）+ **auto-knowledge 人格学习**（对话后自动提炼偏好，越聊越贴合人设）

### 🔍 三种搜索模式（Fast / Auto / Deep）

| 模式             | 说明                                                            |
| ---------------- | --------------------------------------------------------------- |
| **Fast**         | 纯本地快速回答，不联网、不生成文章                              |
| **Auto**（默认） | 先答，缺数据自动升级：联网搜索并让 AI 重答，不自动生成完整文章  |
| **Deep**         | 联网搜索 + 自动生成完整综合文章（View 面板查看 / 保存到知识库） |

### 🔌 搜索 API 平台

- 设置 →「搜索 API」可接入 **Tavily**（专为 AI 设计，免费 1000 次/月，支持当天新闻时间过滤）或 **SearXNG**（开源元搜索，直接填实例地址）
- 配置存本机浏览器（localStorage），经 Worker 代理执行（免 CORS）；未配置或被拦截时自动降级免费引擎，**不硬刚、不做绕过**
- 搜索结果实时更新（提示词注入当天日期、可调缓存时效），面板「重新生成」可强制刷新

### 🧠 搜索智能

- **多语言关键词**：中 / 英 / 日 / 韩 自动识别并增强（动漫查询自动附日文关键词）
- **意图识别**：天气（Open-Meteo 实时预报）、新番动画（Bangumi）、Bilibili、新闻、通用等自动选引擎
- **多引擎并行**：Worker `/api/search` 并行抓取 Bing / DuckDuckGo / Brave / Google News / Mojeek / Qwant / Wikipedia / 百度 / Bilibili，按域名多样化去重
- **搜索规划器**：查询分段（多子查询并发）+ 无结果自动纠错 + 结果合并/去重/相关性过滤 + 搜索定式缓存（学习最优引擎组合）
- **结果缓存**：localStorage 6h TTL、增量写缓存，刷新不重复搜索，历史命中显示绿点

### 🎭 Live2D 虚拟形象

- **AI 即角色**：AI 模型本身就是 Live2D 角色，回复情绪实时驱动表情/动作（自动情绪识别 + `[表情:xxx]` 标签 + `[PARAM:]/[MOTION:]/[EXPRESSION:]` 动作指令协议）
- **25 个 BanG Dream 角色**（5 乐队分组）：自动随机选角、**AI 按记忆/知识库智能选角**、bestdori 模型名 / 第三方 Cubism2 `model.json` 网址一键导入
- **角色设定**：首次自动联网深度整理角色世界观 / 性格 / 语气 / 背景 / 喜好 / 关系 / 资料要点，存为本机角色档案，可在「切换角色 → 角色资料」查看
- **手机沉浸模式**：全屏 Live2D 背景 + AI 一句话 + 输入栏，边聊天边看角色
- 口型同步（朗读时张嘴）、鼠标凝视、眨眼/随机小动作环境动画、低端设备自动降级

### 🧰 Agent 工具箱

- **知识库**：AI 可直接创建/编辑条目（`[KB-SAVE:]` / `[KB-EDIT:]` 协议），内置 Milkdown 编辑器（自动保存 / 草稿 / 多选删除 / 导入导出），站点内容 + 本机笔记双数据源
- **View**：联网搜索 + AI 综合文章生成（含配图），可一键保存到知识库
- **Live2D**：角色舞台 + 切换角色 / 角色资料面板
- **设置**：对话字体、搜索模式、搜索 API、模型 API 配置、数据管理

### ⚙️ 其他

- **自定义模型 API**：访客可填自己的接口/Key/模型（存本机，不传服务器），自动解除次数/冷却限制，内置 DeepSeek / Kimi / OpenAI 快捷预设 + 一键测试连接
- **多模型路由**：注册多个模型时，搜索/关键词等快任务自动路由到便宜快速模型（fast），主对话用主模型（primary）
- **推理模型适配**：DeepSeek reasoner / Kimi thinking 等推理模型自适应 `max_tokens`，兼容 `reasoning_content` / `<|thinking|>` 流式
- **数据管理**：知识库 / 对话历史 / 网页缓存 / 自定义 AI / Live2D 五类本机数据可勾选导出 / 导入
- **水印**：AI 生成内容带多重水印（含模型名 + API 状态），防止被冒用
- **写文章**：后台开关 `enable_ai_articles` 开启后，可直接在对话中撰写并发布文章
- **适用范围**：每个助手可设「仅管理员可用」；主页「AI」菜单可用 `show_ai` 关闭；访客自定义 API 可用 `enable_custom_api` 开关

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

| 变量              | 说明                                | 默认      |
| ----------------- | ----------------------------------- | --------- |
| `VITE_API_BASE`   | API 基础路径                        | `/api/v1` |
| `VITE_USE_MOCK`   | 强制使用演示数据（`1`）             | 关闭      |
| `VITE_MEDIA_BASE` | 静态资源/图片源（跨源部署时拼前缀） | 关闭      |

## ☁️ 一键部署到 Vercel

本项目**不内置任何后端地址**，通过 `vercel.ts` 在构建时读取 `API_BACKEND` 环境变量，动态生成 `/api` 与 `/static` 的反代规则（服务端转发，后端无需开启 CORS），其余路由回退到 `index.html`（SPA 客户端路由）。

> 点击下方按钮即可把本仓库 **克隆到你的账号** 并引导填写 `API_BACKEND`：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FChanYiCYJ%2Fkimo-frontend&env=API_BACKEND&envDescription=%E5%90%8E%E7%AB%AF%E5%9C%B0%E5%9D%80%EF%BC%88%E4%B8%8D%E5%90%AB%E5%B0%BE%E9%83%A8%E6%96%9C%E6%9D%A0%EF%BC%8C%E5%A6%82%20https%3A%2F%2Fapi.example.com%EF%BC%89&project-name=kimo-frontend&repository-name=kimo-frontend)

### 环境变量

| 变量            | 必填 | 说明                                                              | 示例                      |
| --------------- | ---- | ----------------------------------------------------------------- | ------------------------- |
| `API_BACKEND`   | ✅   | 后端 FastAPI 地址（**不带尾部斜杠**），用于反代 `/api`、`/static` | `https://api.example.com` |
| `VITE_USE_MOCK` | 可选 | 置 `1` 强制使用演示数据（不联网）                                 | `1`                       |

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
>
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

| 文件                | 作用                                                                |
| ------------------- | ------------------------------------------------------------------- |
| `wrangler.jsonc`    | Worker 配置：`assets`(dist 静态托管 + SPA 回退)、`API_BACKEND` 变量 |
| `worker.js`         | 反代 `/api`、`/static` 到后端，其余交给 Assets                      |
| `.dev.vars.example` | 本地 `wrangler dev` 环境变量示例                                    |

> 💡 部署到任意平台（Vercel / Cloudflare / 宝塔 Nginx）的**落地页跳转逻辑一致**：`route_map` 精确匹配优先。若某个精确域名被父域后缀匹配抢先导致不跳转（如 `v2.yogofor.top` 被 `yogofor.top` 抢成 `/`），请确保使用最新代码（该 bug 已修复）。

> 📦 使用**宝塔面板（Nginx）**部署？请参考 [`deploy/README.md`](deploy/README.md) 与 `deploy/` 下的脚本（Nginx SPA 回退 + `/api`、`/static` 反代，前后端版本一致部署工作流）。

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

## ⚠️ 搜索模式说明

AI 的搜索模式默认 **Auto（智能）**：能答就答，缺数据自动升级（联网搜索 + AI 重答），但不自动生成完整文章。**Deep** 模式才会联网搜索并自动生成完整综合文章（View 面板查看）；**Fast** 模式纯本地快速回答。搜索优先调用 Worker `/api/search`（多引擎并行 + 域名多样化），未配置第三方搜索 API 时回退到免费引擎 + 维基百科（zh→en）。

## ⚡ 前后端同步热更新

前后端是两个独立进程，各自拥有热重载能力：

| 端              | 命令                            | 热更新机制                                         |
| --------------- | ------------------------------- | -------------------------------------------------- |
| 前端（Vite）    | `npm run dev`                   | **HMR**：保存 `.tsx/.css` 立即局部刷新，不清空状态 |
| 后端（FastAPI） | `uvicorn app.main:app --reload` | **--reload**：保存 `.py` 自动重启服务（秒级）      |

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

## 📁 目录结构

```
src/
├── main.tsx / App.tsx          # 入口与路由
├── index.css                   # Tailwind + 全局样式 / Markdown / Milkdown 排版
├── lib/
│   ├── api.ts                  # API 客户端（统一响应解包、JWT、演示回退）
│   ├── types.ts                # 与后端 schema 对应的类型
│   ├── mock.ts                 # 演示数据
│   ├── auth.tsx / site.tsx / theme.tsx / toast.tsx / format.ts / persona.ts
│   ├── ai.ts                   # AI 改写 / Live2D 智能选角
│   ├── search.ts               # 网络搜索（多引擎 + 维基回退 + 网页抓取 + 结果缓存）
│   ├── searchPlanner.ts        # 搜索规划器（分段并发 / 多语言 / 纠错 / 定式缓存）
│   ├── searchApi.ts            # 搜索 API 平台配置（Tavily/SearXNG + 连接测试）
│   ├── modelRouter.ts          # 多模型角色路由（primary / fast / verifier）
│   ├── providerPresets.ts      # 模型服务商预设（DeepSeek/Kimi/OpenAI + 推理模型适配）
│   ├── providerTest.ts         # 模型连接测试
│   ├── kb.ts                   # 知识库（条目/笔记/草稿 + [KB-SAVE:]/[KB-EDIT:] 协议）
│   ├── dataMgr.ts              # 本机数据导出 / 导入（5 类）
│   ├── localCfg.ts             # 访客自定义模型 API（本机存储）
│   ├── chatSettings.ts         # AI 设置统一存储层（字体/搜索模式/记忆/effCfg 合并）
│   ├── promptPresets.ts        # AI 助手系统提示词预设
│   ├── imageApi.ts             # 图片 API（Wikimedia / Pixiv / Danbooru / Safebooru）
│   ├── toolCmds.ts             # 工具指令解析 / 剥离（[SEARCH:]/[VIEW:]/[KB:]/[表情:]）
│   ├── perf.ts                 # 性能工具（低端设备检测 / 流式节流）
│   ├── live2d.ts / live2dCore.ts / live2dLore.ts  # Live2D 模型 / 渲染 / 角色设定
│   ├── feedback.ts             # 反馈收集
│   └── skills/                 # AI 提示词模块化（知识/人格/记忆/搜索/知识库/View/Live2D）
├── components/
│   ├── Layout.tsx              # 前台布局（域名重定向 / AI 沉浸式分支）
│   ├── Header.tsx / Sidebar.tsx / PostCard.tsx / Pagination.tsx
│   ├── Markdown.tsx / MdEditor.tsx / Modal.tsx / Spinner.tsx / ui.tsx
│   ├── AIChat.tsx              # AI 对话核心（会话/搜索/工具卡/水印/限制）
│   ├── AgentPanel.tsx          # Agent 工具箱（知识库 / View / Live2D / 设置）
│   ├── SettingsTab.tsx / SearchApiForm.tsx / LocalApiForm.tsx / LocalApiModal.tsx
│   ├── KbPicker.tsx            # 「/」快捷弹窗（搜索模式 / Live2D / 知识库条目）
│   ├── KbModal.tsx / BotEditorModal.tsx / ArticleComposerModal.tsx / DataModal.tsx
│   ├── Live2DStage.tsx / Live2DBackground.tsx / Live2DLoading.tsx / Live2DDock.tsx
│   └── admin/AdminLayout.tsx   # 后台布局（左侧图标导航）
└── pages/
    ├── Home.tsx / Article.tsx / PageView.tsx / AICenter.tsx / Login.tsx / NotFound.tsx
    └── admin/
        ├── DashboardHome.tsx   # 统计概览 + 快捷入口
        ├── ManageArticles.tsx / ArticleEditor.tsx   # 文章管理 / 写作
        ├── ManagePages.tsx / PageEditor.tsx         # 页面管理 / 编辑
        ├── AIManage.tsx        # AI 助手统一管理
        ├── CategoriesTags.tsx  # 分类标签
        ├── UserManagement.tsx  # 用户管理
        └── Settings.tsx        # 站点设置（AI 改写 / 功能开关 / 落地页）
```

> 💡 后端未启动时，前端会自动回退到**演示数据**（`src/lib/mock.ts`），便于本地预览 UI。

## 🗺 路由

| 路径                           | 说明                                    |
| ------------------------------ | --------------------------------------- |
| `/`                            | 首页（文章列表、分页、分类筛选、搜索）  |
| `/article/:id`                 | 文章详情                                |
| `/page/:name`                  | 自定义页面（markdown / list / link）    |
| `/ai`、`/ai/:botId`            | **AI 对话中心**（多助手切换 + Live2D）  |
| `/login`                       | 登录 / 注册                             |
| `/dashboard`                   | 管理后台（需管理员 role=0）             |
| `/dashboard/articles`          | 文章管理                                |
| `/dashboard/articles/new`      | 新建文章                                |
| `/dashboard/articles/:id/edit` | 编辑文章                                |
| `/dashboard/pages`             | 页面管理                                |
| `/dashboard/pages/new`         | 新建页面                                |
| `/dashboard/pages/:id/edit`    | 编辑页面                                |
| `/dashboard/ai`                | **AI 助手管理**（统一管理所有助手）     |
| `/dashboard/categories`        | 分类标签                                |
| `/dashboard/settings`          | 站点设置（AI 改写 / 功能开关 / 落地页） |
| `/dashboard/users`             | 用户管理                                |

## 🧪 测试

```bash
npm test          # 运行全部单元测试（Vitest）
npm run test:watch # 监听模式
```

测试覆盖 `src/lib/__tests__/`：搜索（多引擎/缓存/多语言/纠错）、搜索 API、知识库、Live2D（情绪/动作/角色/角色设定）、模型路由、服务商预设、连接测试、人设 / 人格、提示词预设、数据管理、性能工具、AI Chat hooks 等 **300+ 用例**。

## 🛠 常用命令

```bash
npm run dev       # 开发服务器
npm run dev:all   # 同时启动前后端（见上）
npm run build     # 类型检查 + 生产构建
npm run lint      # oxlint 代码检查
npm run preview   # 预览生产构建
npm run deploy:cf # 构建 + 部署到 Cloudflare Workers
```

## 🙏 开源致谢

本项目从零走到今天，**离不开以下开源项目与免费在线服务的支持**，在此致以诚挚的感谢：

### 📦 前端框架与工具链

| 项目                                                                                                                                                                                   | 用途                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [React](https://react.dev)                                                                                                                                                             | UI 框架                                              |
| [TypeScript](https://www.typescriptlang.org)                                                                                                                                           | 类型系统                                             |
| [Vite](https://vitejs.dev)                                                                                                                                                             | 构建工具（HMR）                                      |
| [Tailwind CSS](https://tailwindcss.com)                                                                                                                                                | 原子化样式                                           |
| [React Router](https://reactrouter.com)                                                                                                                                                | SPA 路由                                             |
| [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) + [rehype-highlight](https://github.com/rehypejs/rehype-highlight) | Markdown 渲染 / GFM 表格 / 代码高亮                  |
| [Milkdown](https://milkdown.dev)（@milkdown/\*）                                                                                                                                       | 所见即所得 Markdown 编辑器（表格 / 图片 / 代码高亮） |
| [DOMPurify](https://github.com/cure53/DOMPurify)                                                                                                                                       | HTML 消毒（防 XSS）                                  |
| [highlight.js](https://highlightjs.org)                                                                                                                                                | 代码高亮                                             |
| [lucide-react](https://lucide.dev) / [Ant Design Icons](https://ant.design/components/icon)                                                                                            | 图标库                                               |
| [Vitest](https://vitest.dev) / [jsdom](https://github.com/jsdom/jsdom)                                                                                                                 | 单元测试                                             |
| [oxlint](https://oxc.rs)                                                                                                                                                               | 代码检查                                             |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/)                                                                                                                        | Cloudflare Workers 部署                              |

### 🎭 Live2D 与模型资源

| 项目                                                                                                                                                                                                                                                                            | 用途                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Live2D Cubism](https://www.live2d.com)                                                                                                                                                                                                                                         | Live2D 运行时与 Cubism Core（`live2d.min.js` / `live2dcubismcore.min.js`） |
| [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)（guansss）                                                                                                                                                                                                | Live2D 渲染引擎（Cubism 2 加载器）                                         |
| [PixiJS](https://pixijs.com)                                                                                                                                                                                                                                                    | WebGL 渲染底层                                                             |
| [Bestdori](https://bestdori.com)                                                                                                                                                                                                                                                | BanG Dream 角色模型 / 动作 / 表情资源（经同源反代加载）                    |
| [SoulLink_Live2D](https://github.com/nanlingyin/SoulLink_Live2D)                                                                                                                                                                                                                | 表情 / 动作预设参考                                                        |
| 第三方开源模型：[shizuku](https://github.com/guansss/pixi-live2d-display)（测试模型）、[Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model)、[fghrsh/live2d_api](https://github.com/fghrsh/live2d_api)、[oh-my-live2d](https://github.com/oh-my-live2d/oh-my-live2d) | 用户可直接导入的 Cubism2 开源模型                                          |

### 🌐 在线搜索 / 数据 / 图片服务

| 服务                                                                                | 用途                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [Microsoft Bing](https://www.bing.com)（含 [Bing News](https://www.bing.com/news)） | 网页 / 新闻搜索                                         |
| [DuckDuckGo](https://duckduckgo.com)                                                | 隐私搜索 + 图片兜底（i.js）                             |
| [Brave Search](https://search.brave.com)                                            | 搜索（HTML 抓取 + [API](https://api.search.brave.com)） |
| [Google News](https://news.google.com)                                              | 新闻 RSS 实时检索                                       |
| [Mojeek](https://www.mojeek.com) / [Qwant](https://www.qwant.com)                   | 独立搜索引擎                                            |
| [Wikipedia](https://www.wikipedia.org)                                              | 百科知识 + 免 Key CORS 兜底                             |
| [百度搜索](https://www.baidu.com)                                                   | 中文话题搜索                                            |
| [Bilibili](https://www.bilibili.com)                                                | 站内视频 / 热搜 / UP 投稿检索（WBI 签名）               |
| [Open-Meteo](https://open-meteo.com)                                                | 免费天气 API（无需 Key）                                |
| [Bangumi](https://bgm.tv)                                                           | 番剧条目 / 新番季表                                     |
| [Wikimedia Commons](https://commons.wikimedia.org)                                  | 自由图片库                                              |
| [Pixiv](https://www.pixiv.net)                                                      | 二次元插画（可选配置 `PIXIV_REFRESH_TOKEN`）            |
| [Danbooru](https://danbooru.donmai.us) / [Safebooru](https://safebooru.org)         | 动漫图片 API                                            |
| [Tavily](https://tavily.com) / [SearXNG](https://docs.searxng.org)                  | 用户可选的第三方搜索 API 平台                           |

### 🤝 特别感谢

- **[Kimo](https://github.com/ChanYiCYJ/Kimo)**（原 Flask 项目）与 **[kimo-fastapi](https://github.com/ChanYiCYJ/kimo-fastapi)**（后端 API）——本项目的起点与数据支撑
- **[Vercel](https://vercel.com)** / **[Cloudflare Workers](https://workers.cloudflare.com)** / **宝塔面板**——免费 / 低成本的托管方案
- 每一位**使用、反馈、建议与贡献**的用户——你们的每次反馈都在推动这个项目变得更好
- 以及 **GitHub Copilot** 在开发全过程中的陪伴与支持 💙

---

Made with ❤️ · 前端重构自 [Kimo](https://github.com/ChanYiCYJ/Kimo)，对接 [Kimo API](https://github.com/ChanYiCYJ/kimo-fastapi)
