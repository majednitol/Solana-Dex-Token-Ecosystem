#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
API_URL="${API_URL:-http://localhost:8080}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SKIP_TOKENS=false
SKIP_ATAS=false
SKIP_POOLS=false
SKIP_LIQUIDITY=false
VERIFY_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --skip-tokens)    SKIP_TOKENS=true ;;
    --skip-atas)      SKIP_ATAS=true ;;
    --skip-pools)     SKIP_POOLS=true ;;
    --skip-liquidity) SKIP_LIQUIDITY=true ;;
    --verify-only)    VERIFY_ONLY=true ;;
    --help)
      echo "Usage: setup-all.sh [OPTIONS]"
      echo ""
      echo "Runs the full Cryptonite Swap setup flow in order:"
      echo "  Step 1: init-tokens.js          — mint tokens + register in on-chain registry"
      echo "  Step 2: create-treasury-atas.js — create token wallets for the treasury"
      echo "  Step 3: init-pools.ts           — create Orca liquidity pools"
      echo "  Step 4: init-liquidity.js       — add initial liquidity to pools"
      echo ""
      echo "Options:"
      echo "  --skip-tokens      Skip step 1 (token minting)"
      echo "  --skip-atas        Skip step 2 (treasury token accounts)"
      echo "  --skip-pools       Skip step 3 (pool creation)"
      echo "  --skip-liquidity   Skip step 4 (liquidity)"
      echo "  --verify-only      Only run verification checks (no scripts)"
      echo "  --help             Show this help"
      echo ""
      echo "Environment:"
      echo "  API_URL            Backend URL (default: http://localhost:8080)"
      echo "  ANCHOR_WALLET      Path to wallet keypair JSON"
      echo "  SOLANA_RPC_URL     Solana RPC endpoint (default: mainnet)"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $arg${NC}"
      exit 1
      ;;
  esac
done

banner() {
  echo ""
  echo -e "${CYAN}============================================================${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${CYAN}============================================================${NC}"
}

pass() {
  echo -e "  ${GREEN}PASS${NC} $1"
}

fail() {
  echo -e "  ${RED}FAIL${NC} $1"
  exit 1
}

warn() {
  echo -e "  ${YELLOW}WARN${NC} $1"
}

skip() {
  echo -e "  ${YELLOW}SKIP${NC} $1"
}

node_check() {
  local input="$1"
  local check_fn="$2"
  echo "$input" | node -e "
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      try{
        const o=JSON.parse(d);
        const check = (${check_fn})(o);
        process.stdout.write(check ? 'true' : 'false');
      }catch(e){
        process.stdout.write('false');
      }
    });
  " 2>/dev/null || echo "false"
}

node_extract() {
  local input="$1"
  local extract_fn="$2"
  echo "$input" | node -e "
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      try{
        const o=JSON.parse(d);
        const val = (${extract_fn})(o);
        process.stdout.write(String(val));
      }catch(e){
        process.stdout.write('error');
      }
    });
  " 2>/dev/null || echo "error"
}

verify_endpoint() {
  local url="$1"
  local jq_check="$2"
  local description="$3"

  local response
  response=$(curl -sf "$url" 2>/dev/null) || {
    fail "$description — endpoint $url returned error or unreachable"
  }

  local result
  result=$(node_check "$response" "$jq_check")

  if [ "$result" = "true" ]; then
    pass "$description"
  else
    fail "$description — check failed (response: $(echo "$response" | head -c 200))"
  fi
}

verify_endpoint_soft() {
  local url="$1"
  local jq_check="$2"
  local pass_msg="$3"
  local warn_msg="$4"

  local response
  response=$(curl -sf "$url" 2>/dev/null) || {
    warn "$warn_msg (endpoint error)"
    return 1
  }

  local result
  result=$(node_check "$response" "$jq_check")

  if [ "$result" = "true" ]; then
    pass "$pass_msg"
    return 0
  else
    warn "$warn_msg"
    return 1
  fi
}

banner "Cryptonite Swap — Full Setup Flow"
echo -e "  API:     ${API_URL}"
echo -e "  Contract: ${CONTRACT_DIR}"
echo -e "  Date:    $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo ""
echo "Checking API is reachable..."
curl -sf "${API_URL}/health" >/dev/null 2>&1 || fail "Backend API not reachable at ${API_URL}/health — start it first"
pass "Backend API is running"


banner "Step 1/4: Token Minting (init-tokens.js)"
echo "  Creates on-chain registry, mints Token-2022 tokens, registers them."
echo "  Idempotent: skips already-minted tokens (reads minted.tokens.json)."
echo ""

if [ "$SKIP_TOKENS" = true ]; then
  skip "Token minting (--skip-tokens)"
elif [ "$VERIFY_ONLY" = true ]; then
  skip "Token minting (--verify-only)"
else
  echo "  Running: node scripts/init-tokens.js"
  (cd "$CONTRACT_DIR" && node scripts/init-tokens.js) || fail "init-tokens.js failed"
  echo ""
  echo "  Syncing api/.env..."
  (cd "$CONTRACT_DIR" && node scripts/sync-env.js) || warn "sync-env.js failed after token minting"
  echo ""
  echo "  Refreshing token cache..."
  curl -sf "${API_URL}/tokens/refresh" >/dev/null 2>&1 || true
  sleep 2
fi

echo ""
echo "  Verifying..."
TOKENS_RESPONSE=$(curl -sf "${API_URL}/tokens" 2>/dev/null || echo '{"ok":false}')
verify_endpoint "${API_URL}/tokens" \
  "(o) => o.ok && o.tokens && o.tokens.length > 0" \
  "GET /tokens — tokens registered (count > 0)"

TOKEN_COUNT=$(node_extract "$TOKENS_RESPONSE" "(o) => o.tokens ? o.tokens.length : 0")
echo -e "  ${GREEN}Token count: ${TOKEN_COUNT}${NC}"

FIRST_TOKEN_A=$(node_extract "$TOKENS_RESPONSE" "(o) => o.tokens && o.tokens.length >= 2 ? o.tokens[0].key : ''")
FIRST_TOKEN_B=$(node_extract "$TOKENS_RESPONSE" "(o) => o.tokens && o.tokens.length >= 2 ? o.tokens[1].key : ''")


banner "Step 2/4: Treasury Token Accounts"
echo "  Creates Associated Token Accounts (ATAs) for each token under the treasury."
echo "  Each digital currency gets its own wallet address under the vault."
echo "  ATAs are created via the Admin Panel (Setup tab, Step 3)."
echo ""

if [ "$SKIP_ATAS" = true ]; then
  skip "Treasury ATAs (--skip-atas)"
elif [ "$VERIFY_ONLY" = true ]; then
  skip "Treasury ATAs (--verify-only)"
else
  echo "  Treasury ATAs are created via the Admin Panel."
  echo "  Use the Setup tab → Step 3 to build and sign ATA creation transactions."
  skip "Automated ATA creation — use Admin Panel instead"
fi

echo ""
echo "  Verifying..."
ATA_RESPONSE=$(curl -sf "${API_URL}/treasury/balances" 2>/dev/null || echo '{"ok":false,"balances":[]}')
ATA_COUNT=$(node_extract "$ATA_RESPONSE" "(o) => o.balances ? o.balances.length : 0")
if [ "$ATA_COUNT" != "0" ] && [ "$ATA_COUNT" != "error" ]; then
  pass "Treasury has ${ATA_COUNT} token wallet accounts"
else
  warn "Treasury has no token accounts — ATAs may not be created yet"
fi


banner "Step 3/4: Orca Liquidity Pools (init-pools.ts)"
echo "  Creates Orca Whirlpool concentrated liquidity pools."
echo "  Requires: ts-node or npx ts-node. Tokens must exist first."
echo ""

if [ "$SKIP_POOLS" = true ]; then
  skip "Pool creation (--skip-pools)"
elif [ "$VERIFY_ONLY" = true ]; then
  skip "Pool creation (--verify-only)"
else
  if command -v npx &>/dev/null && [ -f "$SCRIPT_DIR/init-pools.ts" ]; then
    echo "  Running: npx ts-node scripts/init-pools.ts"
    (cd "$CONTRACT_DIR" && npx ts-node scripts/init-pools.ts) || {
      warn "init-pools.ts failed — pools may need manual creation"
    }
  else
    skip "init-pools.ts not found or ts-node unavailable — create pools manually"
  fi
  echo ""
  echo "  Syncing api/.env..."
  (cd "$CONTRACT_DIR" && node scripts/sync-env.js) || warn "sync-env.js failed after pool creation"
fi

echo ""
echo "  Verifying..."
POOL_NETWORK="${SOLANA_NETWORK:-mainnet}"
POOL_CONFIG="$SCRIPT_DIR/orca-pools.${POOL_NETWORK}.json"
if [ -f "$POOL_CONFIG" ]; then
  POOL_FILE_COUNT=$(node_extract "$(cat "$POOL_CONFIG")" "(o) => o.results ? o.results.filter(r => r.ok).length : 0")
  if [ "$POOL_FILE_COUNT" != "0" ] && [ "$POOL_FILE_COUNT" != "error" ]; then
    pass "Pool config: ${POOL_FILE_COUNT} pools created (from orca-pools.${POOL_NETWORK}.json)"
  else
    warn "Pool config exists but no successful pools recorded"
  fi
else
  warn "No pool config file (orca-pools.${POOL_NETWORK}.json) — run init-pools.ts first"
fi

if [ -n "$FIRST_TOKEN_A" ] && [ -n "$FIRST_TOKEN_B" ] && [ "$FIRST_TOKEN_A" != "error" ] && [ "$FIRST_TOKEN_B" != "error" ]; then
  verify_endpoint_soft "${API_URL}/pools?tokenA=${FIRST_TOKEN_A}&tokenB=${FIRST_TOKEN_B}" \
    "(o) => o.ok === true" \
    "GET /pools?tokenA=${FIRST_TOKEN_A}&tokenB=${FIRST_TOKEN_B} — pool lookup working" \
    "GET /pools — pool lookup returned no result for ${FIRST_TOKEN_A}/${FIRST_TOKEN_B} (may not be a pair)" || true
fi


banner "Step 4/4: Initial Liquidity (init-liquidity.js)"
echo "  Adds initial liquidity to Orca pools. Requires pools to exist."
echo "  Note: This step processes 8 pools and may take 3-5 minutes."
echo ""

if [ "$SKIP_LIQUIDITY" = true ]; then
  skip "Liquidity (--skip-liquidity)"
elif [ "$VERIFY_ONLY" = true ]; then
  skip "Liquidity (--verify-only)"
else
  if [ -f "$SCRIPT_DIR/init-liquidity.js" ]; then
    echo "  Running: node scripts/init-liquidity.js (this may take several minutes)..."
    (cd "$CONTRACT_DIR" && timeout 600 node scripts/init-liquidity.js) || {
      EXIT_CODE=$?
      if [ "$EXIT_CODE" = "124" ]; then
        warn "init-liquidity.js timed out after 10 minutes — some pools may still need liquidity"
      else
        warn "init-liquidity.js exited with code ${EXIT_CODE} — liquidity may need manual setup"
      fi
    }
  else
    skip "init-liquidity.js not found"
  fi
fi

echo ""
echo "  Verifying..."
verify_endpoint "${API_URL}/treasury/balances" \
  "(o) => o.ok && Array.isArray(o.balances)" \
  "GET /treasury/balances — balances endpoint responding"

BALANCES_RESPONSE=$(curl -sf "${API_URL}/treasury/balances" 2>/dev/null || echo '{"ok":false,"balances":[]}')
BALANCE_TOTAL=$(node_extract "$BALANCES_RESPONSE" "(o) => o.balances ? o.balances.length : 0")
BALANCE_NONZERO=$(node_extract "$BALANCES_RESPONSE" "(o) => o.balances ? o.balances.filter(b=>b.balance>0).length : 0")
BALANCE_COUNT="Total: ${BALANCE_TOTAL} Non-zero: ${BALANCE_NONZERO}"
echo -e "  ${GREEN}Balances — ${BALANCE_COUNT}${NC}"


banner "Setup Complete"
echo ""
echo -e "  ${GREEN}All steps finished.${NC}"
echo ""
echo "  Summary:"
echo "    Tokens:     ${TOKEN_COUNT} registered"
echo "    Token Wallets: ${ATA_COUNT} treasury ATAs"
echo "    Balances:   ${BALANCE_COUNT}"
echo ""
echo "  Verification endpoints:"
echo "    GET  ${API_URL}/health"
echo "    GET  ${API_URL}/tokens"
echo "    GET  ${API_URL}/treasury/multisig"
echo "    GET  ${API_URL}/treasury/balances"
echo "    GET  ${API_URL}/treasury/proposals"
echo "    GET  ${API_URL}/pools?tokenA=ASDC&tokenB=EDC"
echo "    GET  ${API_URL}/balances/treasury"
echo ""
echo "  Quick verify (run anytime):"
echo "    bash scripts/setup-all.sh --verify-only"
echo ""
