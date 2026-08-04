---
name: baota-deploy
description: 将 kimo-frontend（React SPA）部署到宝塔面板服务器并执行热更新。当用户提到「部署到服务器」「宝塔」「热更新」「更新线上」「发布到服务器」等请求时使用本技能。
---

# 宝塔面板部署与热更新

本技能指导如何把本项目（Vite + React SPA，构建产物为 `dist/`）部署到用户的**宝塔面板（BT Panel）**服务器，并支持**热更新**（拉取 GitHub 最新代码 → 安装依赖 → 构建 → 同步到线上 → 刷新进程）。

## 1. 架构概览

```
GitHub (ChanYiCYJ/kimo-frontend, main)
        │  git pull
        ▼
宝塔服务器 /www/wwwroot/kimo-frontend
        │  npm ci && npm run build
        ▼
dist/ ──► Nginx 静态托管（root 指向 dist，SPA 回退到 index.html）
        │
        └──► （可选）PM2 托管 Node 进程，构建后 pm2 restart
```

- **前端**：纯静态 SPA，Nginx 托管 `dist/` 即可，无需常驻 Node 进程。
- **后端**：`kimo-fastapi`（uvicorn 于 8000 端口），前端通过 `/api/v1` 与 `/static` 反向代理访问（见 `vite.config.ts` 的本地代理映射）。
- **热更新**：因为产物是静态文件，`git pull → build → 同步 dist` 即可完成，秒级生效，无需重启业务进程；若用 PM2 托管再执行 `pm2 restart`。

## 2. 服务器前置准备（首次）

在宝塔面板中完成一次即可：

1. **安装软件**：宝塔「软件商店」安装 **Nginx** 和 **Node.js**（建议 18 LTS 及以上，本项目 `package.json` 有 `engines` 约束时以其为准）。
2. **添加站点**：网站 → 添加站点，域名指向 `/www/wwwroot/kimo-frontend`。
3. **放置代码**：
   ```bash
   cd /www/wwwroot
   git clone https://github.com/ChanYiCYJ/kimo-frontend.git kimo-frontend
   cd kimo-frontend
   npm ci
   npm run build
   ```
4. **配置 Nginx 伪静态（SPA 路由回退 + API 反代）**：
   站点设置 → 配置文件，在 `server` 块中加入：
   ```nginx
   # 静态根目录指向构建产物
   root /www/wwwroot/kimo-frontend/dist;
   index index.html;

   # SPA 路由回退（刷新任意前端路由不 404）
   location / {
       try_files $uri $uri/ /index.html;
   }

   # 后端 API 与静态资源反代（后端在本机 8000 端口时）
   location /api/ {
       proxy_pass http://127.0.0.1:8000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   location /static/ {
       proxy_pass http://127.0.0.1:8000;
       proxy_set_header Host $host;
   }
   ```
   保存后点击「重载配置」（或 `nginx -s reload`）。
5. **（可选）PM2 托管**：若后端用 PM2 跑 uvicorn，`pm2 start "uvicorn app.main:app --host 127.0.0.1 --port 8000" --name kimo-api`。

> 环境变量：若部署到「非根路径」或「自定义 API 域名」，构建前需设置 `VITE_API_BASE`（生产构建时会内联到 JS）。默认走同域 `/api/v1` 反代，通常无需改动。

## 3. 热更新流程（核心）

当用户说「热更新」「更新线上」时，执行以下步骤（可直接在服务器上运行 `deploy/baota-deploy.sh`）：

```bash
cd /www/wwwroot/kimo-frontend

# 1) 拉取最新代码
git fetch origin && git checkout main && git pull --ff-only origin main

# 2) 安装依赖（有 lockfile 用 ci，保证可复现）
npm ci            # 或 npm install

# 3) 构建
npm run build

# 4) 同步到 Nginx 托管目录（若 root 直接指向 dist 则跳过）
rsync -a --delete dist/ /www/wwwroot/kimo-frontend/dist/

# 5) 若用 PM2 托管，刷新进程
pm2 restart kimo-api    # 仅当后端/Node 托管时

# 6) 验证
curl -I https://你的域名/ | head -5
```

### 更省事：一键脚本

项目根目录已提供 `deploy/baota-deploy.sh`。把脚本放到服务器 `/www/wwwroot/kimo-frontend/deploy/` 后执行：

```bash
bash /www/wwwroot/kimo-frontend/deploy/baota-deploy.sh
```

脚本通过环境变量配置，常用：

```bash
APP_DIR=/www/wwwroot/kimo-frontend \
BRANCH=main \
WEB_ROOT=/www/wwwroot/kimo-frontend/dist \
bash deploy/baota-deploy.sh
```

## 4. 回滚

构建失败或上线后发现异常：

```bash
cd /www/wwwroot/kimo-frontend
git log --oneline -5
git checkout <上一个大版本 commit>
npm ci && npm run build
# 同步 dist 后刷新
```

由于 `dist/` 是构建产物，建议把上一个可用的 `dist` 备份一份：`cp -r dist dist.bak-$(date +%F)`。

## 5. 常见问题排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 刷新任意路由 404 | Nginx 缺 `try_files $uri $uri/ /index.html;` |
| 前端请求 `/api/v1` 502 | 后端未启动，或 `proxy_pass` 端口不对；先 `curl http://127.0.0.1:8000/api/v1/health` 确认 |
| 图片 `/static` 打不开 | 确认 `location /static/` 反代到后端 |
| `npm ci` 报错 | lockfile 与 package.json 不同步，改用 `npm install` 后提交更新的 lockfile |
| 构建后样式/功能还是旧的 | 浏览器缓存，`nginx -s reload` 或加版本号 `?v=` 强刷 |
| 前端访问的是旧 API 地址 | 重新构建并设置正确的 `VITE_API_BASE` |
| 宝塔面板 SSL | 站点 → SSL → Let's Encrypt 申请证书，开「强制 HTTPS」 |

## 6. 目录速查

- `deploy/baota-deploy.sh` — 服务器端热更新一键脚本
- `.github/copilot/skills/baota-deploy/SKILL.md` — 本技能说明
- `dist/` — 构建产物（Nginx root 指向此处）
- `vite.config.ts` — 本地开发代理（`/api`、`/static` → `localhost:8000`）

## 7. 交付检查清单

- [ ] 服务器已装 Nginx + Node.js
- [ ] Nginx 已配置 SPA 回退与 API 反代
- [ ] 首次 `npm ci && npm run build` 成功，`dist/` 可被访问
- [ ] 热更新脚本可执行（`bash deploy/baota-deploy.sh`）
- [ ] 部署后首页、文章页、后台均可访问
