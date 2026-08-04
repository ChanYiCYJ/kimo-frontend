---
name: baota-deploy
description: 将 kimo-frontend（React SPA）与 kimo-fastapi（FastAPI 后端）部署到宝塔面板服务器并执行热更新，保持前后端版本一致。当用户提到「部署到服务器」「宝塔」「热更新」「更新线上」「发布到服务器」「前后端一起更新」等请求时使用本技能。
---

# 宝塔面板部署与热更新（前后端一致）

本技能指导把本项目**前端（kimo-frontend）**与**后端（kimo-fastapi）**部署到用户的**宝塔面板（BT Panel）**服务器，并提供**前后端保持一致**的热更新流程（拉取 GitHub 最新代码 → 安装依赖 → 构建/迁移 → 同步到线上 → 刷新进程）。

## 1. 架构概览

```
GitHub
 ├─ ChanYiCYJ/kimo-frontend   (React SPA)
 └─ ChanYiCYJ/kimo-fastapi    (FastAPI 后端)
          │  git pull
          ▼
宝塔服务器 /www/wwwroot/
 ├─ kimo-frontend ─► npm ci && npm run build ─► dist/ ──► Nginx 静态托管
 └─ kimo-fastapi  ─► pip install && aerich upgrade ─► PM2 托管 uvicorn :8000
 Nginx：/api、/static 反向代理到 127.0.0.1:8000
```

- **前端**：纯静态 SPA，Nginx 托管 `dist/`，无需常驻 Node 进程。
- **后端**：FastAPI + Tortoise ORM，`uvicorn app.main:app` 于 8000 端口，用 **PM2** 托管保活。
- **版本一致原则**：前后端为两个独立仓库，同一次需求改动应**同时提交并推送**两个仓库；部署时先后端、再前端，最终 Nginx reload，保证线上前后端处于同一发布版本。

## 2. 前后端版本一致的工作流（核心）

一次完整的「更新线上」应**同时**更新前后端，避免版本错位：

```bash
# ===== ① 后端（先迁移再重启） =====
bash /www/wwwroot/kimo-fastapi/deploy/baota-deploy-api.sh
# 等价于：git pull → pip install → aerich upgrade → pm2 restart kimo-api

# ===== ② 前端（构建再同步） =====
bash /www/wwwroot/kimo-frontend/deploy/baota-deploy.sh
# 等价于：git pull → npm ci → npm run build → rsync dist → nginx reload
```

> **顺序建议**：先后端再前端。若改动涉及数据库结构，必须让后端先完成迁移、重启后再同步前端，避免前端已上线而后端未就绪造成请求 500。
> **分支/提交**：两仓库默认都走 `main`。需要对齐时，可让两仓库检出相同的 tag/commit（如 `git checkout v1.2.0`）再各自构建。

## 3. 服务器前置准备（首次）

宝塔面板中完成一次：

1. **安装软件**：宝塔「软件商店」安装 **Nginx**、**Node.js**（18 LTS+）与 **Python 3.10+**。
2. **添加站点**：网站 → 添加站点，域名指向 `/www/wwwroot/kimo-frontend`（前端静态目录）。
3. **克隆两个仓库**：
   ```bash
   cd /www/wwwroot
   git clone https://github.com/ChanYiCYJ/kimo-frontend.git kimo-frontend
   git clone https://github.com/ChanYiCYJ/kimo-fastapi.git kimo-fastapi
   ```
4. **准备前端**：
   ```bash
   cd /www/wwwroot/kimo-frontend
   npm ci && npm run build
   ```
5. **准备后端（venv + 配置 + PM2）**：
   ```bash
   cd /www/wwwroot/kimo-fastapi
   python3 -m venv venv
   venv/bin/pip install -r requirements.txt
   cp .env.example .env   # 按需修改：DB_*、JWT_SECRET_KEY、ADMIN_PASSWORD 等
   venv/bin/python -m aerich upgrade   # 首次建表/迁移
   pm2 start "venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000" --name kimo-api
   pm2 save
   ```
6. **配置 Nginx**（站点设置 → 配置文件，`server` 块内）：
   ```nginx
   root /www/wwwroot/kimo-frontend/dist;
   index index.html;

   location / {                     # SPA 路由回退
       try_files $uri $uri/ /index.html;
   }
   location /api/ {                 # 后端 API 反代
       proxy_pass http://127.0.0.1:8000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   location /static/ {              # 上传图片等静态资源
       proxy_pass http://127.0.0.1:8000;
       proxy_set_header Host $host;
   }
   ```
   保存后「重载配置」（`nginx -s reload`）。

> 环境变量：前端若非根路径/自定义 API 域名，构建前设置 `VITE_API_BASE`（默认同域 `/api/v1` 反代，通常无需改动）。

## 4. 默认管理员与开放注册（重要）

- **默认管理员**：后端首次启动时若库中无 `role=0` 用户，会自动创建初始管理员（`AUTO_CREATE_ADMIN` 开启时）。
  默认账号：`ADMIN_USERNAME`（`admin`）/ `ADMIN_EMAIL`（`admin@kimo.dev`）/ `ADMIN_PASSWORD`（`admin123`）。
  > ⚠️ **部署后务必通过环境变量修改 `ADMIN_PASSWORD`**，否则存在安全隐患。
- **开放注册**：后端注册接口按「站点设置 `allow_register` > 环境变量 `ALLOW_REGISTER`」判定是否开放；关闭时返回 403。前端登录页的「注册」Tab 也会随之禁用。可在后台「站点设置 → 开放注册」开关维护。

## 5. 热更新流程（日常）

### 5.1 前端（仅改前端时）
```bash
cd /www/wwwroot/kimo-frontend
git pull --ff-only origin main
npm ci
npm run build
rsync -a --delete dist/ dist/   # root 直接指向 dist 时可跳过
nginx -s reload
```
一键：`bash /www/wwwroot/kimo-frontend/deploy/baota-deploy.sh`

### 5.2 后端（仅改后端时）
```bash
cd /www/wwwroot/kimo-fastapi
git pull --ff-only origin main
venv/bin/pip install -r requirements.txt
venv/bin/python -m aerich upgrade    # 有 schema 变更才需要
pm2 restart kimo-api --update-env
```
一键：`bash /www/wwwroot/kimo-fastapi/deploy/baota-deploy-api.sh`

### 5.3 前后端一起（保持版本一致）
按第 2 节顺序依次执行两个脚本即可；建议把两步写成一行：
```bash
bash /www/wwwroot/kimo-fastapi/deploy/baota-deploy-api.sh && \
bash /www/wwwroot/kimo-frontend/deploy/baota-deploy.sh
```

## 6. 回滚

- **前端**：`git checkout <旧 commit>` → `npm ci && npm run build` → 同步 `dist`（上线前建议 `cp -r dist dist.bak-$(date +%F)`）。
- **后端**：`git checkout <旧 commit>` → `pip install` → `pm2 restart kimo-api`。若回滚涉及数据库结构，需要谨慎：`aerich downgrade` 或手动处理（数据不可逆，先备份 DB）。

## 7. 常见问题排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 刷新任意前端路由 404 | Nginx 缺 `try_files $uri $uri/ /index.html;` |
| 前端请求 `/api/v1` 502 | 后端未启动/端口不对；`pm2 status` 查看 `kimo-api`，`curl http://127.0.0.1:8000/api/v1/settings` 确认 |
| 图片 `/static` 打不开 | 确认 `location /static/` 反代到后端 |
| 后端迁移报错 | 检查 `.env` 的 `DB_*` 与数据库权限；`venv/bin/python -m aerich heads` 查看迁移状态 |
| 前端还是旧版本 | 浏览器缓存；`nginx -s reload` 或 `?v=` 强刷 |
| 前端访问旧 API 地址 | 重新构建并设置正确的 `VITE_API_BASE` |
| 默认管理员无法登录 | 库中已有 `role=0` 用户时不会重建；直接用已有管理员登录或手动将某用户 `role` 置 0 |
| 注册 403 | 站点设置 `allow_register=0` 或 `ALLOW_REGISTER=False`；后台「站点设置 → 开放注册」打开即可 |
| 宝塔面板 SSL | 站点 → SSL → Let's Encrypt，开「强制 HTTPS」 |

## 8. 目录速查

- 前端仓库 `kimo-frontend`：
  - `deploy/baota-deploy.sh` — 前端热更新脚本
  - `.github/copilot/skills/baota-deploy/SKILL.md` — 本技能说明
  - `dist/` — 构建产物（Nginx root 指向）
  - `vite.config.ts` — 本地代理（`/api`、`/static` → `localhost:8000`）
- 后端仓库 `kimo-fastapi`：
  - `app/services/init_service.py` — 默认管理员/开放注册
  - `deploy/baota-deploy-api.sh`（前端仓库的 `deploy/` 下，复制到后端仓库或按需放置）
  - `.env.example` → `.env`（DB/JWT/ADMIN_*）
  - `venv/` — Python 虚拟环境

> 说明：`deploy/baota-deploy-api.sh` 位于前端仓库 `deploy/` 目录，使用时应复制到后端服务器目录（或由 skill 直接在终端生成/执行等价命令）。

## 9. 交付检查清单

- [ ] 服务器已装 Nginx + Node.js + Python3
- [ ] 两个仓库均已克隆到 `/www/wwwroot/`
- [ ] 后端已建 venv、安装依赖、`aerich upgrade`、PM2 托管 `kimo-api`
- [ ] Nginx 已配置 SPA 回退 + `/api`、`/static` 反代
- [ ] 前端 `npm ci && npm run build` 成功，`dist/` 可访问
- [ ] 默认管理员可登录，并已修改默认密码
- [ ] 前后端热更新脚本均可执行，一次发布顺序：后端 → 前端
- [ ] 部署后首页、文章页、后台、登录/注册均正常

