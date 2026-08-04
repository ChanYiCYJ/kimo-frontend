# 宝塔面板部署 · 快速参考

本项目为 React SPA，构建产物为 `dist/`，通过宝塔面板的 **Nginx 静态托管**上线，支持 Git 热更新。

## 首次部署（服务器上）

```bash
cd /www/wwwroot
git clone https://github.com/ChanYiCYJ/kimo-frontend.git kimo-frontend
cd kimo-frontend
npm ci
npm run build
```

然后到宝塔「网站」→ 站点设置 → 配置文件，把 `root` 指向 `dist` 并加入 SPA 回退与 API 反代（详见 `.github/copilot/skills/baota-deploy/SKILL.md`）。

## 热更新（日常）

```bash
bash /www/wwwroot/kimo-frontend/deploy/baota-deploy.sh
```

常用参数：

| 环境变量 | 作用 | 默认值 |
| --- | --- | --- |
| `APP_DIR` | 项目目录 | `/www/wwwroot/kimo-frontend` |
| `BRANCH` | 分支 | `main` |
| `WEB_ROOT` | Nginx 静态根目录 | `$APP_DIR/dist` |
| `PM2_APP` | PM2 应用名（后端/Node） | 空（跳过） |
| `SKIP_INSTALL` `SKIP_BUILD` `SKIP_SYNC` `SKIP_PM2` | 置 `1` 跳过对应步骤 | `0` |

## 相关文件

- `deploy/baota-deploy.sh` — 热更新脚本
- `.github/copilot/skills/baota-deploy/SKILL.md` — 完整部署技能说明（含 Nginx 配置、回滚、排查）
