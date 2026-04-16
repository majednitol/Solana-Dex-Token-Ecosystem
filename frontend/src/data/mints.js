let _mintsCache = null
let _mintsPromise = null

const DEFAULT_DECIMALS = 5

async function fetchMints() {
  const res = await fetch('/api/tokens')
  if (!res.ok) throw new Error(`Failed to fetch tokens: ${res.status}`)
  const data = await res.json()
  if (!data.ok || !Array.isArray(data.tokens)) throw new Error('Invalid tokens response')
  const mints = {}
  for (const t of data.tokens) {
    const key = (t.key || t.symbol).toLowerCase()
    mints[key] = {
      mint: t.mint,
      decimals: t.decimals ?? DEFAULT_DECIMALS,
    }
  }
  return mints
}

async function loadMintsWithRetry(retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      _mintsCache = await fetchMints()
      return _mintsCache
    } catch (err) {
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delay))
      } else {
        console.error('Failed to load token mints after retries:', err)
      }
    }
  }
  return null
}

export async function initMints() {
  if (_mintsCache) return _mintsCache
  if (_mintsPromise) return _mintsPromise
  _mintsPromise = loadMintsWithRetry()
  const result = await _mintsPromise
  if (!result) _mintsPromise = null
  return result
}

export function getMint(tokenId) {
  if (!_mintsCache) return null
  const entry = _mintsCache[tokenId?.toLowerCase()]
  return entry?.mint || null
}

export function getDecimals(tokenId) {
  if (!_mintsCache) return DEFAULT_DECIMALS
  const entry = _mintsCache[tokenId?.toLowerCase()]
  return entry?.decimals ?? DEFAULT_DECIMALS
}

export function toRawAmount(amount, decimals = DEFAULT_DECIMALS) {
  return Math.round(parseFloat(amount) * Math.pow(10, decimals))
}

export function fromRawAmount(raw, decimals = DEFAULT_DECIMALS) {
  return parseInt(raw, 10) / Math.pow(10, decimals)
}

export function getMintsCache() {
  return _mintsCache
}
