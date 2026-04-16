#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

if [ -f api/.env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    export "$line"
  done < api/.env
fi

export API_PORT=${API_PORT:-8080}
export REDIS_URL=${REDIS_URL:-redis://127.0.0.1:6379}

echo "[start-production] API_PORT=$API_PORT"
echo "[start-production] Project dir: $PROJECT_DIR"

MISSING=""
[ -z "$NEON_DATABASE_URL" ] && MISSING="$MISSING NEON_DATABASE_URL"
[ -z "${WALLET_KEY:-}" ] && [ -z "${TRADE_BOT_PRIVATE_KEY:-}" ] && MISSING="$MISSING WALLET_KEY"
[ -z "$SOLANA_RPC_URL" ] && MISSING="$MISSING SOLANA_RPC_URL"
if [ -n "$MISSING" ]; then
  echo "[start-production] ERROR: Missing required env vars:$MISSING"
  echo "[start-production] Set them in api/.env or export before running."
  exit 1
fi

echo "[start-production] Starting local Redis..."
redis-server --daemonize yes --port 6379 --save "" --appendonly no --maxmemory 64mb --maxmemory-policy allkeys-lru 2>&1 || echo "[start-production] Redis start failed (may already be running)"
sleep 1
redis-cli ping && echo "[start-production] Redis is ready" || echo "[start-production] WARNING: Redis not responding"

CHILD_PIDS=""
CLEANING_UP=0

cleanup() {
  [ "$CLEANING_UP" -eq 1 ] && return
  CLEANING_UP=1
  echo "[start-production] Shutting down..."
  for pid in $CHILD_PIDS; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "[start-production] All processes stopped."
}
trap cleanup EXIT SIGTERM SIGINT

echo "[start-production] Starting workers..."
node worker/feeCollector.js &
CHILD_PIDS="$CHILD_PIDS $!"
node worker/priceWatcher.js &
CHILD_PIDS="$CHILD_PIDS $!"

echo "[start-production] Starting API server on port $API_PORT..."
set +e
node api/index.js &
API_PID=$!
CHILD_PIDS="$CHILD_PIDS $API_PID"

wait $API_PID
EXIT_CODE=$?
echo "[start-production] API process exited with code $EXIT_CODE"
exit $EXIT_CODE
