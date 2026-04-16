#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

pass()  { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS + 1)); }
fail()  { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL + 1)); }
warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; WARN=$((WARN + 1)); }

source_env() {
  set -a
  . "$1" 2>/dev/null || true
  set +a
}

echo ""
echo "=========================================="
echo " Mainnet Readiness Checklist"
echo "=========================================="
echo ""

API_ENV="api/.env"
FE_ENV="frontend/.env"

if [ ! -f "$API_ENV" ]; then
  fail "api/.env not found"
else
  pass "api/.env exists"
fi

if [ ! -f "$FE_ENV" ]; then
  fail "frontend/.env not found"
else
  pass "frontend/.env exists"
fi

echo ""
echo "--- Backend (api/.env) ---"

if [ -f "$API_ENV" ]; then
  source_env "$API_ENV"
fi

if [ "${SOLANA_NETWORK:-}" = "mainnet" ]; then
  pass "SOLANA_NETWORK=mainnet"
else
  fail "SOLANA_NETWORK is '${SOLANA_NETWORK:-not set}' (expected 'mainnet')"
fi

if [ -z "${SOLANA_RPC_URL:-}" ]; then
  fail "SOLANA_RPC_URL is not set"
elif echo "$SOLANA_RPC_URL" | grep -qi "devnet"; then
  fail "SOLANA_RPC_URL contains 'devnet': $SOLANA_RPC_URL"
elif echo "$SOLANA_RPC_URL" | grep -qi "api.devnet.solana.com"; then
  fail "SOLANA_RPC_URL is the public devnet endpoint"
else
  pass "SOLANA_RPC_URL looks like a mainnet endpoint"
fi

if [ "${NOWPAYMENTS_SANDBOX:-true}" = "false" ]; then
  pass "NOWPAYMENTS_SANDBOX=false (production mode)"
else
  fail "NOWPAYMENTS_SANDBOX is '${NOWPAYMENTS_SANDBOX:-not set}' (expected 'false')"
fi

WALLET_CHECK="${WALLET_KEY:-${TRADE_BOT_PRIVATE_KEY:-}}"
if [ -z "$WALLET_CHECK" ]; then
  warn "WALLET_KEY is not set (needed for signing transactions)"
elif echo "$WALLET_CHECK" | grep -qi "your_"; then
  fail "WALLET_KEY looks like a placeholder"
else
  pass "WALLET_KEY is set"
fi

if [ -z "${NEON_DATABASE_URL:-}" ]; then
  fail "NEON_DATABASE_URL is not set"
else
  pass "NEON_DATABASE_URL is set"
fi

echo ""
echo "--- Frontend (frontend/.env) ---"

if [ -f "$FE_ENV" ]; then
  unset VITE_SOLANA_NETWORK VITE_SOLANA_RPC_URL VITE_MOONPAY_API_KEY VITE_NOWPAYMENTS_SANDBOX 2>/dev/null || true
  source_env "$FE_ENV"
fi

if [ "${VITE_SOLANA_NETWORK:-}" = "mainnet" ]; then
  pass "VITE_SOLANA_NETWORK=mainnet"
else
  fail "VITE_SOLANA_NETWORK is '${VITE_SOLANA_NETWORK:-not set}' (expected 'mainnet')"
fi

if [ -n "${VITE_SOLANA_RPC_URL:-}" ]; then
  if echo "$VITE_SOLANA_RPC_URL" | grep -qi "devnet"; then
    fail "VITE_SOLANA_RPC_URL contains 'devnet'"
  else
    pass "VITE_SOLANA_RPC_URL is set to a non-devnet endpoint"
  fi
else
  warn "VITE_SOLANA_RPC_URL not set (will use default clusterApiUrl for mainnet)"
fi

if [ "${VITE_MOONPAY_API_KEY:-}" = "pk_test_key" ]; then
  fail "VITE_MOONPAY_API_KEY is still 'pk_test_key' (needs production key)"
elif [ -z "${VITE_MOONPAY_API_KEY:-}" ]; then
  fail "VITE_MOONPAY_API_KEY is not set"
else
  pass "VITE_MOONPAY_API_KEY is set to a non-test key"
fi

if [ "${VITE_NOWPAYMENTS_SANDBOX:-true}" = "false" ]; then
  pass "VITE_NOWPAYMENTS_SANDBOX=false (production EVM chains)"
else
  fail "VITE_NOWPAYMENTS_SANDBOX is '${VITE_NOWPAYMENTS_SANDBOX:-not set}' (expected 'false')"
fi

if [ "${VITE_MOONPAY_ENV:-}" = "production" ]; then
  pass "VITE_MOONPAY_ENV=production"
elif [ -z "${VITE_MOONPAY_ENV:-}" ]; then
  warn "VITE_MOONPAY_ENV not set (code defaults to 'production')"
else
  fail "VITE_MOONPAY_ENV is '${VITE_MOONPAY_ENV}' (expected 'production')"
fi

echo ""
echo "--- Anchor.toml ---"

ANCHOR_TOML="contract/Anchor.toml"
if [ -f "$ANCHOR_TOML" ]; then
  if grep -q "\[programs.mainnet\]" "$ANCHOR_TOML"; then
    if grep -q "MAINNET_.*_PROGRAM_ID" "$ANCHOR_TOML"; then
      fail "Anchor.toml [programs.mainnet] still has placeholder program IDs"
    else
      pass "Anchor.toml [programs.mainnet] has real program IDs"
    fi
  else
    fail "Anchor.toml missing [programs.mainnet] section"
  fi
else
  warn "contract/Anchor.toml not found"
fi

echo ""
echo "=========================================="
echo -e " Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}, ${YELLOW}${WARN} warnings${NC}"
echo "=========================================="
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}NOT READY for mainnet. Fix the failures above.${NC}"
  exit 1
else
  echo -e "${GREEN}All checks passed! Ready for mainnet.${NC}"
  exit 0
fi
