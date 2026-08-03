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

> 💡 后端未启动时，前端会自动回退到**演示数据**（`src/lib/mock.ts`），便于本地预览 UI。

## 📁 目录结构

```
src/
├── main.tsx / App.tsx        # 入口与路由
├── index.css                 # Tailwind + 全局样式 / Markdown 排版
├── lib/
│   ├── api.ts                # API 客户端（统一响应解包、JWT、演示回退）
│   ├── types.ts              # 与后端 schema 对应的类型
│   ├── mock.ts               # 演示数据
│   ├── auth.tsx              # 登录态 Context
│   ├── site.tsx              # 站点设置 Context
│   ├── toast.tsx             # Toast 通知
│   └── format.ts             # 日期 / 阅读时间工具
├── components/
│   ├── Layout.tsx            # 前台布局（背景 + 头部 + 侧栏 + 页脚）
│   ├── Header.tsx / Sidebar.tsx / PostCard.tsx / Pagination.tsx
│   ├── Markdown.tsx / MdEditor.tsx / Modal.tsx / Spinner.tsx / ui.tsx
│   └── admin/AdminLayout.tsx # 后台布局（左侧图标导航）
└── pages/
    ├── Home.tsx / Article.tsx / PageView.tsx / Login.tsx / NotFound.tsx
    └── admin/
        ├── DashboardHome.tsx   # 统计概览 + 快捷入口
        ├── ManageArticles.tsx  # 文章管理（列表 / 删除）
        ├── ArticleEditor.tsx   # 文章写作（Markdown 编辑器）
        ├── ManagePages.tsx     # 页面管理
        ├── PageEditor.tsx      # 页面编辑（markdown / html / list / link）
        └── Settings.tsx        # 站点设置
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

