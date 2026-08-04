# 宝塔面板部署 · 快速参考（前后端一致）

本项目包含两个仓库：
- **前端** `kimo-frontend`：React SPA，构建产物 `dist/`，Nginx 静态托管
- **后端** `kimo-fastapi`：FastAPI + Tortoise ORM，uvicorn :8000，PM2 托管

## 首次部署（服务器上）

### 前端
```bash
cd /www/wwwroot
git clone https://github.com/ChanYiCYJ/kimo-frontend.git kimo-frontend
cd kimo-frontend
npm ci
npm run build
```

### 后端
```bash
cd /www/wwwroot
git clone https://github.com/ChanYiCYJ/kimo-fastapi.git kimo-fastapi
cd kimo-fastapi
python3 -m venv venv
venv/bin/pip install -r requirements.txt
cp .env.example .env          # 修改 DB_* / JWT_SECRET_KEY / ADMIN_PASSWORD
venv/bin/python -m aerich upgrade
pm2 start "venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000" --name kimo-api
pm2 save
```

> 默认管理员：首次启动自动创建 `admin / admin@kimo.dev / admin123`（**请改密码**）。

### Nginx
站点配置把 `root` 指向前端 `dist`，加入 SPA 回退与 `/api`、`/static` 反代（完整配置见 `.github/copilot/skills/baota-deploy/SKILL.md`）。

## 热更新（日常）

**保持前后端一致：先后端、再前端**

```bash
# 后端：git pull → pip → aerich 迁移 → pm2 restart
bash /www/wwwroot/kimo-fastapi/deploy/baota-deploy-api.sh

# 前端：git pull → npm ci → build → rsync dist → nginx reload
bash /www/wwwroot/kimo-frontend/deploy/baota-deploy.sh
```

### 后端脚本参数

| 环境变量 | 作用 | 默认值 |
| --- | --- | --- |
| `APP_DIR` | 项目目录 | `/www/wwwroot/kimo-fastapi` |
| `BRANCH` | 分支 | `main` |
| `VENV_DIR` | Python venv 目录 | 空（用系统 python3） |
| `MIGRATE` | 是否跑 `aerich upgrade` | `1` |
| `PM2_APP` | PM2 应用名 | `kimo-api` |
| `SKIP_INSTALL` `SKIP_MIGRATE` `SKIP_RESTART` | 置 `1` 跳过对应步骤 | `0` |

### 前端脚本参数

| 环境变量 | 作用 | 默认值 |
| --- | --- | --- |
| `APP_DIR` | 项目目录 | `/www/wwwroot/kimo-frontend` |
| `BRANCH` | 分支 | `main` |
| `WEB_ROOT` | Nginx 静态根目录 | `$APP_DIR/dist` |
| `PM2_APP` | PM2 应用名 | 空（跳过） |
| `SKIP_INSTALL` `SKIP_BUILD` `SKIP_SYNC` `SKIP_PM2` | 置 `1` 跳过对应步骤 | `0` |

## 相关文件

- `deploy/baota-deploy.sh` — 前端热更新脚本
- `deploy/baota-deploy-api.sh` — 后端热更新脚本（使用时复制到后端服务器）
- `.github/copilot/skills/baota-deploy/SKILL.md` — 完整部署技能说明（架构、版本一致流程、Nginx、回滚、排查）
