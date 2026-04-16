import { useState, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useCurrency } from '../stores/useCurrencyStore'

const TIMEFRAMES = [
  { label: '24H', days: 1 },
  { label: '7D', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '1Y', days: 365 },
]

function generateFlatChart(basePrice, days) {
  const points = Math.min(50, days * 4)
  const data = []
  const now = Date.now()
  const interval = (days * 24 * 60 * 60 * 1000) / points
  for (let i = 0; i < points; i++) {
    const timestamp = now - (points - i) * interval
    const d = new Date(timestamp)
    let displayDate
    if (days <= 1) {
      displayDate = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    } else if (days <= 7) {
      displayDate = d.toLocaleDateString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    } else if (days <= 90) {
      displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } else {
      displayDate = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    }
    data.push({ date: timestamp, displayDate, price: basePrice })
  }
  return data
}

function CoinDetailModal({ coin, onClose }) {
  const [activeTimeframe, setActiveTimeframe] = useState('7D')
  const [chartData, setChartData] = useState([])
  const [chartLoading, setChartLoading] = useState(true)
  const { formatPrice, formatLargeNumber } = useCurrency()

  useEffect(() => {
    if (!coin) return
    let cancelled = false
    setChartLoading(true)

    const tf = TIMEFRAMES.find(t => t.label === activeTimeframe)
    const days = tf?.days || 7

    if (coin.isCustomToken) {
      const intervalMap = { 1: '1h', 7: '4h', 30: '1d', 90: '1d', 365: '1d' }
      const interval = intervalMap[days] || '1d'
      const from = Date.now() - days * 24 * 3600 * 1000
      fetch(`/api/chart/candles?tokenId=${encodeURIComponent(coin.id)}&interval=${interval}&from=${from}`)
        .then(r => r.json())
        .then(data => {
          if (cancelled) return
          if (data.ok && data.candles && data.candles.length > 0) {
            const formatted = data.candles.map(c => {
              const d = new Date(c.time)
              let displayDate
              if (days <= 1) displayDate = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
              else if (days <= 7) displayDate = d.toLocaleDateString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
              else if (days <= 90) displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              else displayDate = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
              return { date: c.time, displayDate, price: c.close }
            })
            setChartData(formatted)
            setChartLoading(false)
          } else {
            setChartData(generateFlatChart(coin.current_price, days))
            setChartLoading(false)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setChartData(generateFlatChart(coin.current_price, days))
            setChartLoading(false)
          }
        })
      return () => { cancelled = true }
    }

    fetch(
      `/api/coingecko/api/v3/coins/${coin.id}/market_chart?vs_currency=usd&days=${days}`
    )
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        const prices = data.prices || []
        const interval = Math.max(1, Math.floor(prices.length / 200))
        const sampled = prices.filter((_, i) => i % interval === 0 || i === prices.length - 1)
        const formatted = sampled.map(([timestamp, price]) => {
          const d = new Date(timestamp)
          let displayDate
          if (days <= 1) {
            displayDate = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          } else if (days <= 7) {
            displayDate = d.toLocaleDateString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
          } else if (days <= 90) {
            displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          } else {
            displayDate = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
          }
          return { date: timestamp, displayDate, price }
        })
        setChartData(formatted)
        setChartLoading(false)
      })
      .catch(() => {
        if (!cancelled) setChartLoading(false)
      })

    return () => { cancelled = true }
  }, [coin?.id, activeTimeframe])

  if (!coin) return null

  const startPrice = chartData[0]?.price || coin.current_price
  const endPrice = chartData[chartData.length - 1]?.price || coin.current_price
  const priceChange = endPrice - startPrice
  const priceChangePercent = startPrice ? ((priceChange / startPrice) * 100) : 0
  const isPositive = priceChange >= 0
  const chartColor = isPositive ? '#00d68f' : '#ff4d6a'

  const prices = chartData.map(d => d.price)
  let high = 0, low = 0
  if (prices.length > 0) {
    high = prices[0]; low = prices[0]
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > high) high = prices[i]
      if (prices[i] < low) low = prices[i]
    }
  }

  const change24h = coin.price_change_percentage_24h ?? 0
  const change7d = coin.price_change_percentage_7d_in_currency ?? 0

  const circSupply = coin.circulating_supply || 0
  const maxSupply = coin.max_supply || 0
  const supplyPercent = maxSupply > 0 ? ((circSupply / maxSupply) * 100).toFixed(1) : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="coin-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="coin-detail-header">
          <div className="coin-detail-title-row">
            {coin.image ? (
              <img src={coin.image} alt={coin.name} className="coin-detail-img" />
            ) : (
              <div
                className="coin-detail-icon-badge"
                style={{ background: `linear-gradient(135deg, ${coin.tokenColor || '#a855f7'}, ${coin.tokenColor || '#a855f7'}88)` }}
              >
                {coin.tokenSymbolShort || coin.symbol?.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="coin-detail-name-group">
              <h2>{coin.name}</h2>
              <span className="coin-detail-symbol">{coin.symbol.toUpperCase()}</span>
              <span className="coin-detail-rank">Rank #{coin.market_cap_rank}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="coin-detail-price-row">
          <div className="coin-detail-current-price">{formatPrice(coin.current_price)}</div>
          <div className={`coin-detail-change ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '▲' : '▼'} {formatPrice(Math.abs(priceChange))} ({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)
          </div>
        </div>

        <div className="coin-detail-timeframes">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.label}
              className={`timeframe-btn ${activeTimeframe === tf.label ? 'active' : ''}`}
              onClick={() => setActiveTimeframe(tf.label)}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="coin-detail-chart">
          {chartLoading ? (
            <div className="coin-detail-chart-loading">
              <div className="dash-loading-spinner" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`coinGrad-${coin.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="displayDate"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#8b8d97', fontSize: 11 }}
                  interval="preserveStartEnd"
                  minTickGap={60}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#8b8d97', fontSize: 11 }}
                  tickFormatter={(v) => formatPrice(v)}
                  width={85}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                  }}
                  formatter={(value) => [formatPrice(value), 'Price']}
                  labelFormatter={(label) => label}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke={chartColor}
                  strokeWidth={2}
                  fill={`url(#coinGrad-${coin.id})`}
                  dot={false}
                  activeDot={{ r: 4, fill: chartColor, stroke: '#fff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="coin-detail-stats-grid">
          <div className="coin-detail-stat-card">
            <span className="coin-stat-label">Market Cap</span>
            <span className="coin-stat-value">{coin.market_cap > 0 && coin.hasRealPrice !== false ? formatLargeNumber(coin.market_cap) : '--'}</span>
          </div>
          <div className="coin-detail-stat-card">
            <span className="coin-stat-label">24h Volume</span>
            <span className="coin-stat-value">{formatLargeNumber(coin.total_volume)}</span>
          </div>
          <div className="coin-detail-stat-card">
            <span className="coin-stat-label">24h Change</span>
            <span className={`coin-stat-value ${change24h >= 0 ? 'positive' : 'negative'}`}>
              {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
            </span>
          </div>
          <div className="coin-detail-stat-card">
            <span className="coin-stat-label">7d Change</span>
            <span className={`coin-stat-value ${change7d >= 0 ? 'positive' : 'negative'}`}>
              {change7d >= 0 ? '+' : ''}{change7d.toFixed(2)}%
            </span>
          </div>
          <div className="coin-detail-stat-card">
            <span className="coin-stat-label">{activeTimeframe} High</span>
            <span className="coin-stat-value">{formatPrice(high)}</span>
          </div>
          <div className="coin-detail-stat-card">
            <span className="coin-stat-label">{activeTimeframe} Low</span>
            <span className="coin-stat-value">{formatPrice(low)}</span>
          </div>
          <div className="coin-detail-stat-card">
            <span className="coin-stat-label">Circulating Supply</span>
            <span className="coin-stat-value">
              {circSupply > 0 ? `${(circSupply / 1e6).toFixed(2)}M ${coin.symbol.toUpperCase()}` : 'N/A'}
            </span>
          </div>
          <div className="coin-detail-stat-card">
            <span className="coin-stat-label">Max Supply</span>
            <span className="coin-stat-value">
              {maxSupply > 0 ? `${(maxSupply / 1e6).toFixed(2)}M` : '∞ Unlimited'}
            </span>
          </div>
        </div>

        {supplyPercent && (
          <div className="coin-detail-supply-bar">
            <div className="supply-bar-header">
              <span className="coin-stat-label">Supply Progress</span>
              <span className="coin-stat-value">{supplyPercent}%</span>
            </div>
            <div className="supply-bar-track">
              <div className="supply-bar-fill" style={{ width: `${supplyPercent}%` }} />
            </div>
          </div>
        )}

        {!coin.isCustomToken && (
          <div className="coin-detail-footer">
            <a
              href={`https://www.coingecko.com/en/coins/${coin.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="coin-detail-link"
            >
              View on CoinGecko →
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

export default CoinDetailModal
