#!/bin/zsh
set -eu

SCRIPT_DIR="${0:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
cd "$ROOT_DIR"

PORT="${PORT:-5178}"
BIND_HOST="${BIND_HOST:-127.0.0.1}"
BROWSER_HOST="$BIND_HOST"
if [[ "$BIND_HOST" == "0.0.0.0" || "$BIND_HOST" == "::" ]]; then
  BROWSER_HOST="127.0.0.1"
fi
URL="http://${BROWSER_HOST}:${PORT}"
HEALTH_URL="${URL}/api/health"
RUNTIME_DIR="${ROOT_DIR}/.runtime"
RUNTIME_SUFFIX=""
if [[ "$PORT" != "5178" ]]; then
  RUNTIME_SUFFIX="-${PORT}"
fi
PID_FILE="${RUNTIME_DIR}/server${RUNTIME_SUFFIX}.pid"
LOG_FILE="${RUNTIME_DIR}/server${RUNTIME_SUFFIX}.log"

mkdir -p "$RUNTIME_DIR"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" ]]; then
  echo "未找到 Node.js，请先安装 Node.js 20 或更高版本。"
  exit 1
fi

NODE_MAJOR="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js 版本过低：$($NODE_BIN -v)，需要 20 或更高版本。"
  exit 1
fi

APP_VERSION="$($NODE_BIN -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"

open_app() {
  echo "本地角色扮演 Agent：${URL}"
  if [[ "${NO_OPEN:-0}" != "1" ]] && command -v open >/dev/null 2>&1; then
    open "$URL"
  fi
}

HEALTH="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null || true)"
if [[ "$HEALTH" == *'"app":"local-roleplay-agent"'* ]]; then
  if [[ "$HEALTH" == *'"version":"'"$APP_VERSION"'"'* ]]; then
    echo "v${APP_VERSION} 已经在运行。"
    open_app
    exit 0
  fi

  echo "检测到旧版本实例，正在平滑重启..."
  OLD_PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$OLD_PIDS" ]]; then
    for old_pid in ${(f)OLD_PIDS}; do
      kill "$old_pid" 2>/dev/null || true
    done
    sleep 1
  fi
elif [[ -n "$HEALTH" ]]; then
  echo "端口 ${PORT} 已被其他服务占用，请设置其他端口后重试，例如：PORT=5180 $0"
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting v${APP_VERSION}" >> "$LOG_FILE"
PORT="$PORT" BIND_HOST="$BIND_HOST" nohup "$NODE_BIN" server/index.js >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

for _ in {1..40}; do
  HEALTH="$(curl -fsS --max-time 1 "$HEALTH_URL" 2>/dev/null || true)"
  if [[ "$HEALTH" == *'"ok":true'* && "$HEALTH" == *'"version":"'"$APP_VERSION"'"'* ]]; then
    echo "启动成功，PID ${SERVER_PID}，日志：${LOG_FILE}"
    open_app
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

echo "启动失败，最近日志："
tail -n 30 "$LOG_FILE" 2>/dev/null || true
rm -f "$PID_FILE"
exit 1
