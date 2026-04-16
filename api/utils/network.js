'use strict';

const SOLANA_NETWORK = (process.env.SOLANA_NETWORK || 'mainnet').trim().toLowerCase();

if (SOLANA_NETWORK !== 'devnet' && SOLANA_NETWORK !== 'mainnet') {
  throw new Error(
    `Invalid SOLANA_NETWORK="${SOLANA_NETWORK}". Must be "devnet" or "mainnet".`
  );
}

function isMainnet() {
  return SOLANA_NETWORK === 'mainnet';
}

function isDevnet() {
  return SOLANA_NETWORK === 'devnet';
}

function getNetworkLabel() {
  return SOLANA_NETWORK;
}

function getOrcaWhirlpoolsConfig() {
  return isMainnet() ? 'solanaMainnet' : 'solanaDevnet';
}

function getRpcUrl() {
  const url = process.env.SOLANA_RPC_URL;
  if (!url || !url.trim()) {
    if (isMainnet()) {
      throw new Error(
        'SOLANA_RPC_URL is required when SOLANA_NETWORK=mainnet. ' +
        'Use a paid RPC provider (Helius, QuickNode, etc.).'
      );
    }
    return 'https://api.devnet.solana.com';
  }
  return url.trim();
}

async function wrapRpcUrl(rpcUrl) {
  const kit = await import('@solana/kit');
  return isMainnet() ? kit.mainnet(rpcUrl) : kit.devnet(rpcUrl);
}

function createNetworkRpc(rpcUrl) {
  return import('@solana/kit').then(async (kit) => {
    const wrapped = isMainnet() ? kit.mainnet(rpcUrl) : kit.devnet(rpcUrl);
    return kit.createSolanaRpc(wrapped);
  });
}

module.exports = {
  SOLANA_NETWORK,
  isMainnet,
  isDevnet,
  getNetworkLabel,
  getOrcaWhirlpoolsConfig,
  getRpcUrl,
  wrapRpcUrl,
  createNetworkRpc,
};
