#!/usr/bin/env bash
# =============================================================================
# kimo-fastapi 宝塔服务器热更新脚本
#
# 作用：git pull → pip 安装依赖 → aerich 迁移 → PM2 重启 uvicorn
# 用法：
#   bash deploy/baota-deploy-api.sh
# 可用环境变量（均可覆盖）：
#   APP_DIR   项目目录，默认 /www/wwwroot/kimo-fastapi
#   BRANCH    目标分支，默认 main
#   REMOTE    远程名，默认 origin
#   VENV_DIR  Python venv 目录（推荐）；留空则使用系统 python3/pip
#   REQUIREMENTS 依赖文件；置空可跳过 pip 安装
#   MIGRATE   "1"=跑 aerich 迁移（默认），"0"=跳过（无 schema 变更时提速）
#   PM2_APP   PM2 应用名，默认 kimo-api；置空跳过 pm2 restart
#   SKIP_INSTALL / SKIP_MIGRATE / SKIP_RESTART  置 1 跳过对应步骤
# 示例：
#   VENV_DIR=/www/wwwroot/kimo-fastapi/venv \
#   bash deploy/baota-deploy-api.sh
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/kimo-fastapi}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
VENV_DIR="${VENV_DIR:-}"
REQUIREMENTS="${REQUIREMENTS:-requirements.txt}"
MIGRATE="${MIGRATE:-1}"
PM2_APP="${PM2_APP:-kimo-api}"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }

if [[ ! -d "$APP_DIR" ]]; then
  echo "错误：目录不存在 $APP_DIR（请先 git clone 或修改 APP_DIR）" >&2
  exit 1
fi

cd "$APP_DIR"

# 选择 Python 解释器（venv 优先）
PYTHON="python3"
PIP="pip"
if [[ -n "$VENV_DIR" ]]; then
  PYTHON="$VENV_DIR/bin/python"
  PIP="$VENV_DIR/bin/pip"
  if [[ ! -x "$PYTHON" ]]; then
    echo "错误：venv 不存在 $PYTHON（请先 python3 -m venv $VENV_DIR）" >&2
    exit 1
  fi
fi

# 确保在干净分支上，避免本地改动冲突
if [[ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]]; then
  git checkout "$BRANCH"
fi

# ---------- 1. 拉取最新代码 ----------
step "1/4 拉取代码 $REMOTE/$BRANCH"
git fetch "$REMOTE"
git pull --ff-only "$REMOTE" "$BRANCH"
ok "代码已更新到 $(git rev-parse --short HEAD)"

# ---------- 2. 安装 Python 依赖 ----------
if [[ "${SKIP_INSTALL:-0}" != "1" && -n "$REQUIREMENTS" && -f "$REQUIREMENTS" ]]; then
  step "2/4 安装依赖（$PYTHON -m pip install -r $REQUIREMENTS）"
  "$PYTHON" -m pip install -r "$REQUIREMENTS"
  ok "依赖安装完成"
else
  step "2/4 跳过依赖安装（SKIP_INSTALL=1 或未找到 $REQUIREMENTS）"
fi

# ---------- 3. 数据库迁移（aerich） ----------
if [[ "${SKIP_MIGRATE:-0}" != "1" && "$MIGRATE" != "0" ]]; then
  step "3/4 数据库迁移（aerich upgrade）"
  "$PYTHON" -m aerich upgrade
  ok "迁移完成"
else
  step "3/4 跳过数据库迁移（SKIP_MIGRATE=1 或 MIGRATE=0）"
fi

# ---------- 4. 重启服务 ----------
if [[ "${SKIP_RESTART:-0}" != "1" && -n "$PM2_APP" ]]; then
  step "4/4 PM2 重启 $PM2_APP"
  pm2 restart "$PM2_APP" --update-env
  ok "PM2 已重启"
else
  step "4/4 跳过重启（SKIP_RESTART=1 或 PM2_APP 为空）"
fi

printf '\n\033[1;32m后端热更新完成 ✅\033[0m\n'
printf '提示：改动若涉及前端，请再执行 bash deploy/baota-deploy.sh 同步前端（保持前后端一致）\n'
