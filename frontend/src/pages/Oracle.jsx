import { useState, useEffect, useCallback } from 'react'
import { useLanguage } from '../stores/useLanguageStore'
import { useTokenListQuery } from '../hooks/queries/useTokenListQuery'

const API = '/api/oracle'

function formatPrice(val) {
  if (!val && val !== 0) return '--'
  const n = Number(val)
  if (n === 0) return '0.00000'
  if (n < 0.001) return n.toFixed(8)
  if (n < 1) return n.toFixed(5)
  return n.toFixed(5)
}

function formatAge(seconds) {
  if (!seconds && seconds !== 0) return '--'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

function formatDeviation(val) {
  if (val === null || val === undefined) return '--'
  const n = Number(val)
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function Oracle() {
  const { t } = useLanguage()
  const { tokens: queryTokens } = useTokenListQuery()
  const [tokens, setTokens] = useState([])
  const [selectedToken, setSelectedToken] = useState('NTC')
  const [latestPrice, setLatestPrice] = useState(null)
  const [priceFeed, setPriceFeed] = useState(null)
  const [priceStatus, setPriceStatus] = useState(null)
  const [averagePrice, setAveragePrice] = useState(null)
  const [vwapData, setVwapData] = useState(null)
  const [historyData, setHistoryData] = useState(null)
  const [treasuryValue, setTreasuryValue] = useState(null)
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchAll = useCallback(async (token) => {
    try {
      setError(null)
      const errors = []

      async function safeFetch(url) {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!json.success) throw new Error(json.message || 'API error')
        return json.data
      }

      const [latestRes, feedRes, statusRes, avgRes, vwapRes, treasuryRes] = await Promise.allSettled([
        safeFetch(`${API}/price/latest?token=${token}`),
        safeFetch(`${API}/price/feed?token=${token}`),
        safeFetch(`${API}/price/status?token=${token}`),
        safeFetch(`${API}/price/average?token=${token}`),
        safeFetch(`${API}/price/vwap?token=${token}`),
        safeFetch(`${API}/treasury/value`),
      ])

      if (latestRes.status === 'fulfilled') setLatestPrice(latestRes.value)
      else errors.push(`Latest: ${latestRes.reason?.message}`)

      if (feedRes.status === 'fulfilled') setPriceFeed(feedRes.value)
      else errors.push(`Feed: ${feedRes.reason?.message}`)

      if (statusRes.status === 'fulfilled') setPriceStatus(statusRes.value)
      else errors.push(`Status: ${statusRes.reason?.message}`)

      if (avgRes.status === 'fulfilled') setAveragePrice(avgRes.value)
      else errors.push(`Average: ${avgRes.reason?.message}`)

      if (vwapRes.status === 'fulfilled') setVwapData(vwapRes.value)
      else errors.push(`VWAP: ${vwapRes.reason?.message}`)

      if (treasuryRes.status === 'fulfilled') setTreasuryValue(treasuryRes.value)
      else errors.push(`Treasury: ${treasuryRes.reason?.message}`)

      if (errors.length > 0) setError(errors.join('; '))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchHistory = useCallback(async (token) => {
    setHistoryLoading(true)
    try {
      const res = await fetch(`${API}/price/history?token=${token}&limit=50`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.success) setHistoryData(json.data)
      else setHistoryData(null)
    } catch (e) {
      console.warn('[Oracle] History fetch failed:', e.message)
      setHistoryData(null)
    }
    setHistoryLoading(false)
  }, [])

  useEffect(() => {
    const syms = [...new Set(queryTokens.map(t => t.symbol).filter(s => s && s !== 'NC'))]
    if (syms.length > 0) setTokens(syms)
  }, [queryTokens])

  useEffect(() => {
    setLoading(true)
    fetchAll(selectedToken)
    fetchHistory(selectedToken)
  }, [selectedToken, fetchAll, fetchHistory])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => { fetchAll(selectedToken) }, 30000)
    return () => clearInterval(interval)
  }, [autoRefresh, selectedToken, fetchAll])

  const statusColor = priceStatus?.isValid ? 'var(--accent-green)' : 'var(--accent-red)'
  const statusLabel = priceStatus?.isValid ? 'Valid' : priceStatus?.isStale ? 'Stale' : priceStatus?.isDeviated ? 'Deviated' : 'Invalid'

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Price Oracle</h1>
        <p>Real-time on-chain price feeds, VWAP analytics, and treasury valuation</p>
      </div>

      <div className="oracle-controls">
        <div className="oracle-token-selector">
          {tokens.map(tok => (
            <button
              key={tok}
              className={`oracle-token-btn ${selectedToken === tok ? 'active' : ''}`}
              onClick={() => setSelectedToken(tok)}
            >
              {tok}
            </button>
          ))}
        </div>
        <div className="oracle-actions">
          <label className="oracle-auto-refresh">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh (30s)</span>
          </label>
          <button className="oracle-refresh-btn" onClick={() => { fetchAll(selectedToken); fetchHistory(selectedToken) }}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="oracle-error">
          <span>Error: {error}</span>
        </div>
      )}

      {loading && (
        <div className="oracle-loading">Loading oracle data...</div>
      )}

      {!loading && (
        <>
          <div className="oracle-grid-top">
            <div className="oracle-card oracle-card-price">
              <div className="oracle-card-header">
                <span className="oracle-card-title">Latest Price</span>
                <span className="oracle-card-endpoint">GET /price/latest</span>
              </div>
              <div className="oracle-price-main">
                <span className="oracle-big-price">{formatPrice(latestPrice?.price)}</span>
                <span className="oracle-pair-label">{latestPrice?.token_symbol || selectedToken} / {latestPrice?.pair_symbol || '--'}</span>
              </div>
              <div className="oracle-meta-row">
                <span>Source: <strong>{latestPrice?.source || '--'}</strong></span>
                <span>Pool: <strong>{latestPrice?.pool_address ? latestPrice.pool_address.slice(0, 8) + '...' + latestPrice.pool_address.slice(-4) : latestPrice?.source === 'swap' ? 'Via swap trade' : '--'}</strong></span>
              </div>
            </div>

            <div className="oracle-card oracle-card-status">
              <div className="oracle-card-header">
                <span className="oracle-card-title">Price Status</span>
                <span className="oracle-card-endpoint">GET /price/status</span>
              </div>
              <div className="oracle-status-indicator">
                <div className="oracle-status-dot" style={{ background: statusColor }} />
                <span className="oracle-status-label" style={{ color: statusColor }}>{statusLabel}</span>
              </div>
              <div className="oracle-status-details">
                <div className="oracle-status-row">
                  <span>Last Update</span>
                  <span>{priceStatus?.ageSeconds !== undefined ? formatAge(priceStatus.ageSeconds) : '--'}</span>
                </div>
                <div className="oracle-status-row">
                  <span>Deviation</span>
                  <span style={{ color: Math.abs(priceStatus?.deviation || 0) > 10 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                    {formatDeviation(priceStatus?.deviation)}
                  </span>
                </div>
                <div className="oracle-status-row">
                  <span>Data Points</span>
                  <span>{priceStatus?.dataPoints ?? '--'}</span>
                </div>
              </div>
            </div>

            <div className="oracle-card oracle-card-feed">
              <div className="oracle-card-header">
                <span className="oracle-card-title">Price Feed</span>
                <span className="oracle-card-endpoint">GET /price/feed</span>
              </div>
              <div className="oracle-feed-body">
                <div className="oracle-feed-row"><span>Round ID</span><span>{priceFeed?.roundId ?? '--'}</span></div>
                <div className="oracle-feed-row"><span>Answer</span><span>{formatPrice(priceFeed?.answer)}</span></div>
                <div className="oracle-feed-row"><span>Updated At</span><span>{priceFeed?.updatedAt ? new Date(priceFeed.updatedAt).toLocaleTimeString() : '--'}</span></div>
                <div className="oracle-feed-row"><span>Decimals</span><span>{priceFeed?.decimals ?? '--'}</span></div>
                <div className="oracle-feed-row"><span>Description</span><span className="oracle-feed-desc">{priceFeed?.description || '--'}</span></div>
              </div>
            </div>
          </div>

          <div className="oracle-grid-mid">
            <div className="oracle-card oracle-card-avg">
              <div className="oracle-card-header">
                <span className="oracle-card-title">365-Day Average</span>
                <span className="oracle-card-endpoint">GET /price/average</span>
              </div>
              <div className="oracle-avg-body">
                <div className="oracle-avg-main">
                  <span className="oracle-big-price">{formatPrice(averagePrice?.averagePrice)}</span>
                  <span className="oracle-avg-period">{averagePrice?.period || '365d'}</span>
                </div>
                <div className="oracle-avg-stats">
                  <div className="oracle-avg-stat">
                    <span className="oracle-avg-stat-label">Data Points</span>
                    <span className="oracle-avg-stat-value">{averagePrice?.dataPoints ?? '--'}</span>
                  </div>
                  <div className="oracle-avg-stat">
                    <span className="oracle-avg-stat-label">Included</span>
                    <span className="oracle-avg-stat-value">{averagePrice?.included ?? '--'}</span>
                  </div>
                  <div className="oracle-avg-stat">
                    <span className="oracle-avg-stat-label">Filtered</span>
                    <span className="oracle-avg-stat-value">{averagePrice?.filtered ?? '--'}</span>
                  </div>
                  <div className="oracle-avg-stat">
                    <span className="oracle-avg-stat-label">Median</span>
                    <span className="oracle-avg-stat-value">{formatPrice(averagePrice?.median)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="oracle-card oracle-card-vwap">
              <div className="oracle-card-header">
                <span className="oracle-card-title">VWAP</span>
                <span className="oracle-card-endpoint">GET /price/vwap</span>
              </div>
              <div className="oracle-avg-body">
                <div className="oracle-avg-main">
                  <span className="oracle-big-price">{formatPrice(vwapData?.vwap)}</span>
                  <span className="oracle-avg-period">{vwapData?.days ? `${vwapData.days}d window` : '--'}</span>
                </div>
                <div className="oracle-avg-stats">
                  <div className="oracle-avg-stat">
                    <span className="oracle-avg-stat-label">Data Points</span>
                    <span className="oracle-avg-stat-value">{vwapData?.dataPoints ?? '--'}</span>
                  </div>
                  <div className="oracle-avg-stat">
                    <span className="oracle-avg-stat-label">Included</span>
                    <span className="oracle-avg-stat-value">{vwapData?.included ?? '--'}</span>
                  </div>
                  <div className="oracle-avg-stat">
                    <span className="oracle-avg-stat-label">Filtered (Spikes)</span>
                    <span className="oracle-avg-stat-value">{vwapData?.filtered ?? '--'}</span>
                  </div>
                  <div className="oracle-avg-stat">
                    <span className="oracle-avg-stat-label">Median</span>
                    <span className="oracle-avg-stat-value">{formatPrice(vwapData?.median)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="oracle-grid-bottom">
            <div className="oracle-card oracle-card-treasury">
              <div className="oracle-card-header">
                <span className="oracle-card-title">Treasury Valuation</span>
                <span className="oracle-card-endpoint">GET /treasury/value</span>
              </div>
              {treasuryValue?.ok !== false ? (
                <div className="oracle-treasury-body">
                  <div className="oracle-treasury-total">
                    <span className="oracle-treasury-total-label">Total Value (365d Avg)</span>
                    <span className="oracle-treasury-total-value">{treasuryValue?.totalValue != null ? formatPrice(treasuryValue.totalValue) : '--'}</span>
                  </div>
                  {treasuryValue?.holdings && treasuryValue.holdings.length > 0 && (
                    <div className="oracle-treasury-holdings">
                      <div className="oracle-treasury-hdr">
                        <span>Token</span><span>Balance</span><span>Avg Price</span><span>Value</span>
                      </div>
                      {treasuryValue.holdings.map((h, i) => (
                        <div key={i} className="oracle-treasury-row">
                          <span className="oracle-treasury-symbol">{h.symbol}</span>
                          <span>{h.balance != null ? Number(h.balance).toFixed(2) : '--'}</span>
                          <span>{formatPrice(h.avgPrice365d)}</span>
                          <span>{h.value != null ? Number(h.value).toFixed(2) : '--'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="oracle-treasury-empty">Treasury data unavailable</div>
              )}
            </div>
          </div>

          <div className="oracle-card oracle-card-history">
            <div className="oracle-card-header">
              <span className="oracle-card-title">Price History</span>
              <span className="oracle-card-endpoint">GET /price/history</span>
            </div>
            {historyLoading ? (
              <div className="oracle-loading">Loading history...</div>
            ) : historyData?.prices && historyData.prices.length > 0 ? (
              <div className="oracle-history-table-wrap">
                <table className="oracle-history-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Price</th>
                      <th>Pair</th>
                      <th>Source</th>
                      <th>Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.prices.slice(0, 50).map((row, i) => (
                      <tr key={i}>
                        <td>{new Date(row.created_at).toLocaleString()}</td>
                        <td className="oracle-history-price">{formatPrice(row.price)}</td>
                        <td>{row.pair_symbol || '--'}</td>
                        <td>
                          <span className={`oracle-source-badge oracle-source-${row.source}`}>{row.source}</span>
                        </td>
                        <td>{row.volume != null ? Number(row.volume).toFixed(2) : '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="oracle-history-empty">No price history available for {selectedToken}</div>
            )}
          </div>

          <div className="oracle-endpoints-ref">
            <h3>API Reference</h3>
            <div className="oracle-endpoint-list">
              {[
                { method: 'GET', path: '/api/oracle/price/latest?token=NTC', desc: 'Latest price for a token' },
                { method: 'GET', path: '/api/oracle/price/feed?token=NTC', desc: 'Chainlink-style price feed' },
                { method: 'GET', path: '/api/oracle/price/history?token=NTC&limit=50', desc: 'Historical price records' },
                { method: 'GET', path: '/api/oracle/price/average?token=NTC', desc: '365-day average price' },
                { method: 'GET', path: '/api/oracle/price/vwap?token=NTC&days=365', desc: 'Volume-weighted average price' },
                { method: 'GET', path: '/api/oracle/price/status?token=NTC', desc: 'Price validity status' },
                { method: 'GET', path: '/api/oracle/treasury/value', desc: 'Treasury vault valuation' },
                { method: 'GET', path: '/api/oracle/performance', desc: 'System performance metrics' },
              ].map((ep, i) => (
                <div key={i} className="oracle-endpoint-item">
                  <span className="oracle-ep-method">GET</span>
                  <code className="oracle-ep-path">{ep.path}</code>
                  <span className="oracle-ep-desc">{ep.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default Oracle
