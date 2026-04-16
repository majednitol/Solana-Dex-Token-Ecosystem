#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
API_ENV="$CONTRACT_DIR/../api/.env"

if [ -f "$API_ENV" ]; then
  while IFS='=' read -r key value; do
    key=$(echo "$key" | xargs 2>/dev/null || true)
    [[ -z "$key" || "$key" == \#* ]] && continue
    case "$key" in
      WALLET_KEY|TRADE_BOT_PRIVATE_KEY|SOLANA_RPC_URL|SOLANA_NETWORK)
        export "$key=$value"
        ;;
    esac
  done < "$API_ENV"
fi

WALLET_KEY="${WALLET_KEY:-${TRADE_BOT_PRIVATE_KEY:-}}"
if [ -z "$WALLET_KEY" ]; then
  echo "ERROR: WALLET_KEY not found. Set it in api/.env or as an environment variable."
  exit 1
fi
export WALLET_KEY

NETWORK="${SOLANA_NETWORK:-mainnet}"
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"

KEYPAIR_FILE="$CONTRACT_DIR/.anchor/wallet-keypair.json"
mkdir -p "$(dirname "$KEYPAIR_FILE")"

node -e "
const bs58 = require('bs58');
const key = process.env.WALLET_KEY.trim();
let bytes;
try { bytes = JSON.parse(key); } catch (_) {}
if (!bytes) {
  try { bytes = Array.from(bs58.decode(key)); } catch (_) {}
}
if (!bytes) {
  const nums = key.replace(/[\[\]\s]/g, '').split(',').map(Number);
  bytes = nums;
}
require('fs').writeFileSync('$KEYPAIR_FILE', JSON.stringify(bytes));
"

PUBKEY=$(node -e "
const { Keypair } = require('@solana/web3.js');
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(require('fs').readFileSync('$KEYPAIR_FILE', 'utf8'))));
console.log(kp.publicKey.toBase58());
")

echo "============================================"
echo "  Anchor Deploy"
echo "============================================"
echo "  Network:  $NETWORK"
echo "  RPC:      $RPC_URL"
echo "  Wallet:   $PUBKEY"
echo "============================================"

CLUSTER_FLAG=""
if [ "$NETWORK" = "mainnet" ] || [ "$NETWORK" = "mainnet-beta" ]; then
  CLUSTER_FLAG="--provider.cluster mainnet"
elif [ "$NETWORK" = "devnet" ]; then
  CLUSTER_FLAG="--provider.cluster devnet"
elif [ "$NETWORK" = "localnet" ]; then
  CLUSTER_FLAG="--provider.cluster localnet"
fi

cd "$CONTRACT_DIR"

EXTRA_ARGS="${@:-}"

anchor deploy \
  --provider.wallet "$KEYPAIR_FILE" \
  $CLUSTER_FLAG \
  $EXTRA_ARGS \
  -- --url "$RPC_URL"

echo ""
echo "Deploy complete!"
