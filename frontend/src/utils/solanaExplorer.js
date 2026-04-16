const SOLANA_NETWORK = (import.meta.env.VITE_SOLANA_NETWORK || 'mainnet').toLowerCase()

function getClusterParam() {
  return SOLANA_NETWORK === 'mainnet' ? '' : `?cluster=${SOLANA_NETWORK}`
}

export function explorerTxUrl(signature) {
  const cluster = getClusterParam()
  return `https://explorer.solana.com/tx/${signature}${cluster}`
}

export function explorerAddressUrl(address) {
  const cluster = getClusterParam()
  return `https://explorer.solana.com/address/${address}${cluster}`
}
