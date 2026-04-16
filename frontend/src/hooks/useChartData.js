import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

const API_BASE = '/api'

export const intervalMap = {
  '30m': '5m',
  '1H': '5m',
  '1D': '1h',
  '1W': '1d',
  '1M': '1d',
  'ALL': '1d',
  '24H': '1h',
  '7D': '1d',
  '3M': '1d',
  '1Y': '1d',
}

export const hoursMap = {
  '30m': 0.5,
  '1H': 1,
  '1D': 24,
  '1W': 168,
  '1M': 720,
  'ALL': 8760,
  '24H': 24,
  '7D': 168,
  '3M': 2160,
  '1Y': 8760,
}

export function useCandles(tokenId, timeframe = '1D', pairTokenId) {
  const [candles, setCandles] = useState([])
  const [loading, setLoading] = useState(false)
  const [hasData, setHasData] = useState(false)

  const fetchCandles = useCallback(async () => {
    if (!tokenId) return
    setLoading(true)
    try {
      const interval = intervalMap[timeframe] || '1h'
      const hours = hoursMap[timeframe] || 24
      const from = Date.now() - hours * 3600 * 1000
      let url = `${API_BASE}/chart/candles?tokenId=${encodeURIComponent(tokenId)}&interval=${interval}&from=${from}`
      if (pairTokenId) url += `&pairTokenId=${encodeURIComponent(pairTokenId)}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.ok && data.candles && data.candles.length > 0) {
        setCandles(data.candles)
        setHasData(true)
      } else {
        setCandles([])
        setHasData(false)
      }
    } catch {
      setCandles([])
      setHasData(false)
    } finally {
      setLoading(false)
    }
  }, [tokenId, timeframe, pairTokenId])

  useEffect(() => {
    fetchCandles()
  }, [fetchCandles])

  return { candles, loading, hasData, refetch: fetchCandles }
}

export function useSparkline(tokenId, hours = 168, pairTokenId) {
  const [sparkData, setSparkData] = useState({ prices: [], min: 0, max: 0, start: 0, end: 0, trend: 'flat' })
  const [hasData, setHasData] = useState(false)

  useEffect(() => {
    if (!tokenId) return
    let cancelled = false
    let url = `${API_BASE}/chart/sparkline?tokenId=${encodeURIComponent(tokenId)}&hours=${hours}`
    if (pairTokenId) url += `&pairTokenId=${encodeURIComponent(pairTokenId)}`
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.ok && data.prices && data.prices.length > 0) {
          setSparkData({
            prices: data.prices,
            min: data.min ?? 0,
            max: data.max ?? 0,
            start: data.start ?? 0,
            end: data.end ?? 0,
            trend: data.trend ?? 'flat',
          })
          setHasData(true)
        } else {
          setSparkData({ prices: [], min: 0, max: 0, start: 0, end: 0, trend: 'flat' })
          setHasData(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSparkData({ prices: [], min: 0, max: 0, start: 0, end: 0, trend: 'flat' })
          setHasData(false)
        }
      })
    return () => { cancelled = true }
  }, [tokenId, hours, pairTokenId])

  return { prices: sparkData.prices, sparkData, hasData }
}

const _streamListeners = new Set()
let _sharedES = null
let _sharedESClosed = false

function _ensureStream() {
  if (_sharedES || _sharedESClosed) return
  function connect() {
    if (_sharedESClosed) return
    try {
      _sharedES = new EventSource(`${API_BASE}/chart/stream`)
      _sharedES.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.connected) return
          for (const fn of _streamListeners) {
            try { fn(data) } catch {}
          }
        } catch {}
      }
      _sharedES.onerror = () => {
        if (_sharedES) _sharedES.close()
        _sharedES = null
        if (!_sharedESClosed) setTimeout(connect, 3000)
      }
    } catch {}
  }
  connect()
}

export function useTradeStream(onTrade) {
  const onTradeRef = useRef(onTrade)
  onTradeRef.current = onTrade

  useEffect(() => {
    const handler = (data) => {
      if (onTradeRef.current) onTradeRef.current(data)
    }
    _streamListeners.add(handler)
    _ensureStream()
    return () => {
      _streamListeners.delete(handler)
      if (_streamListeners.size === 0 && _sharedES) {
        _sharedESClosed = true
        _sharedES.close()
        _sharedES = null
        _sharedESClosed = false
      }
    }
  }, [])
}

export function useRecentTrades(tokenId, limit = 50, pairTokenId, wallet) {
  const [trades, setTrades] = useState([])
  const [revision, setRevision] = useState(0)

  const refetch = useCallback(() => setRevision(r => r + 1), [])

  useEffect(() => {
    if (!tokenId) return
    let cancelled = false
    let url = `${API_BASE}/chart/trades?tokenId=${encodeURIComponent(tokenId)}&limit=${limit}`
    if (pairTokenId) url += `&pairTokenId=${encodeURIComponent(pairTokenId)}`
    if (wallet) url += `&wallet=${encodeURIComponent(wallet)}`
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.ok && data.trades) setTrades(data.trades)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [tokenId, limit, revision, pairTokenId, wallet])

  useTradeStream(useCallback((trade) => {
    if (!tokenId) return
    const tid = tokenId.toLowerCase()
    if (trade.tokenA?.toLowerCase() === tid || trade.tokenB?.toLowerCase() === tid) {
      refetch()
    }
  }, [tokenId, refetch]))

  return { trades, setTrades, refetch }
}

export function useTokenStats(tokenIds) {
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const idsKey = Array.isArray(tokenIds) ? tokenIds.join(',') : ''

  useEffect(() => {
    if (!tokenIds || tokenIds.length === 0) return
    let cancelled = false
    setLoading(true)
    fetch(`${API_BASE}/chart/stats?tokenIds=${tokenIds.map(encodeURIComponent).join(',')}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.ok && data.stats) setStats(data.stats)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [idsKey, revision])

  const debounceRef = useRef(null)
  useTradeStream(useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setRevision(r => r + 1), 2000)
  }, []))
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  return { stats, loading }
}
