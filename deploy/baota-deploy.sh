#!/usr/bin/env bash
# =============================================================================
# kimo-frontend 宝塔服务器热更新脚本
#
# 作用：git pull → 安装依赖 → 构建 → 同步 dist → （可选）PM2 重启
# 用法：
#   bash deploy/baota-deploy.sh
# 可用环境变量（均可覆盖）：
#   APP_DIR  项目目录，默认 /www/wwwroot/kimo-frontend
#   BRANCH   目标分支，默认 main
#   REMOTE   远程名，默认 origin
#   WEB_ROOT Nginx 静态根目录；留空则跳过 rsync（root 直接指向 dist）
#   PM2_APP  PM2 应用名；留空则跳过 pm2 restart
#   SKIP_INSTALL / SKIP_BUILD / SKIP_SYNC / SKIP_PM2  置 1 跳过对应步骤
# 示例：
#   APP_DIR=/www/wwwroot/kimo-frontend WEB_ROOT= bash deploy/baota-deploy.sh
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/kimo-frontend}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
WEB_ROOT="${WEB_ROOT:-$APP_DIR/dist}"
PM2_APP="${PM2_APP:-}"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }

if [[ ! -d "$APP_DIR" ]]; then
  echo "错误：目录不存在 $APP_DIR（请先 git clone 或修改 APP_DIR）" >&2
  exit 1
fi

cd "$APP_DIR"

# 确保在干净分支上，避免本地改动冲突
if [[ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]]; then
  git checkout "$BRANCH"
fi

# ---------- 1. 拉取最新代码 ----------
step "1/4 拉取代码 $REMOTE/$BRANCH"
git fetch "$REMOTE"
git pull --ff-only "$REMOTE" "$BRANCH"
ok "代码已更新到 $(git rev-parse --short HEAD)"

# ---------- 2. 安装依赖 ----------
if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  step "2/4 安装依赖"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  ok "依赖安装完成"
else
  step "2/4 跳过依赖安装（SKIP_INSTALL=1）"
fi

# ---------- 3. 构建 ----------
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  step "3/4 构建"
  npm run build
  ok "构建完成（dist/）"
else
  step "3/4 跳过构建（SKIP_BUILD=1）"
fi

# ---------- 4. 同步 dist 到 Nginx 托管目录 ----------
if [[ "${SKIP_SYNC:-0}" != "1" && -n "$WEB_ROOT" ]]; then
  step "4/4 同步 dist → $WEB_ROOT"
  mkdir -p "$WEB_ROOT"
  # 先备份上一版，方便回滚
  if [[ -d "$WEB_ROOT" && -d "$APP_DIR/dist" ]]; then
    cp -r "$WEB_ROOT" "$WEB_ROOT.bak-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
    # 清理过旧备份，只留最近 3 份
    ls -d "$WEB_ROOT".bak-* 2>/dev/null | head -n -3 | xargs -r rm -rf || true
  fi
  rsync -a --delete "$APP_DIR/dist/" "$WEB_ROOT/"
  ok "dist 已同步"
fi

# ---------- 5. （可选）PM2 刷新 ----------
if [[ "${SKIP_PM2:-0}" != "1" && -n "$PM2_APP" ]]; then
  step "PM2 重启 $PM2_APP"
  pm2 restart "$PM2_APP"
  ok "PM2 已重启"
fi

# ---------- 6. 刷新 Nginx（若托管）----------
if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && nginx -s reload 2>/dev/null || true
  ok "Nginx 已 reload（如有）"
fi

printf '\n\033[1;32m热更新完成 ✅\033[0m\n'
