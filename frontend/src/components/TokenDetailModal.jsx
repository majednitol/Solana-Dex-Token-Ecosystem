import { useState, useMemo, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts'
import { useCurrency } from '../stores/useCurrencyStore'
import { intervalMap as sharedIntervalMap } from '../hooks/useChartData'

function generateFlatLine(basePrice, days = 30) {
  const data = []
  const now = new Date()
  for (let i = days; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    data.push({
      date: date.toISOString().split('T')[0],
      price: basePrice,
      displayDate: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    })
  }
  return data
}

const timeframes = [
  { label: '24H', days: 1 },
  { label: '7D', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '1Y', days: 365 },
  { label: 'ALL', days: null },
]

function TokenDetailModal({ token, marketData = {}, onClose }) {
  const [activeTimeframe, setActiveTimeframe] = useState('1M')
  const { formatPrice, formatLargeNumber, convert } = useCurrency()
  const [realChartData, setRealChartData] = useState(null)

  const safePrice = marketData.price || 1
  const fullHistory = useMemo(() => generateFlatLine(safePrice), [safePrice])

  useEffect(() => {
    if (!token?.id) return
    let cancelled = false
    const tf = timeframes.find(t => t.label === activeTimeframe)
    const isAll = activeTimeframe === 'ALL' || tf?.days === null
    const days = tf?.days || (isAll ? 3650 : 365)
    const interval = sharedIntervalMap[activeTimeframe] || '1d'
    const from = Date.now() - days * 24 * 3600 * 1000
    fetch(`/api/chart/candles?tokenId=${encodeURIComponent(token.id)}&interval=${interval}&from=${from}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.ok && data.candles && data.candles.length > 0) {
          setRealChartData(data.candles.map(c => {
            const d = new Date(c.time)
            return {
              date: d.toISOString().split('T')[0],
              price: c.close,
              displayDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            }
          }))
        } else {
          setRealChartData(null)
        }
      })
      .catch(() => { if (!cancelled) setRealChartData(null) })
    return () => { cancelled = true }
  }, [token?.id, activeTimeframe])

  const chartData = useMemo(() => {
    if (realChartData && realChartData.length > 0) return realChartData
    const tf = timeframes.find(t => t.label === activeTimeframe)
    if (!tf?.days) return fullHistory
    return fullHistory.slice(-tf.days)
  }, [fullHistory, activeTimeframe, realChartData])

  const startPrice = chartData[0]?.price || 0
  const endPrice = chartData[chartData.length - 1]?.price || 0
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="token-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="token-detail-header">
          <div className="token-detail-title">
            <div
              className="token-detail-icon"
              style={{ background: `linear-gradient(135deg, ${token.color}, ${token.color}88)` }}
            >
              {token.symbol.slice(0, 2)}
            </div>
            <div>
              <h2>{token.fullName}</h2>
              <span className="token-detail-symbol">{token.symbol}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="token-detail-price-section">
          <div className="token-detail-current-price">{formatPrice(endPrice)}</div>
          <div className={`token-detail-change ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '▲' : '▼'} {formatPrice(Math.abs(priceChange))} ({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)
          </div>
        </div>

        <div className="token-detail-timeframes">
          {timeframes.map(tf => (
            <button
              key={tf.label}
              className={`timeframe-btn ${activeTimeframe === tf.label ? 'active' : ''}`}
              onClick={() => setActiveTimeframe(tf.label)}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="token-detail-chart">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`gradient-${token.id}`} x1="0" y1="0" x2="0" y2="1">
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
                minTickGap={50}
              />
              <YAxis
                domain={['auto', 'auto']}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#8b8d97', fontSize: 11 }}
                tickFormatter={(v) => formatPrice(v)}
                width={80}
              />
              <Tooltip
                contentStyle={{
                  background: '#1a1b2e',
                  border: '1px solid #2a2b3d',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
                }}
                formatter={(value) => [formatPrice(value), 'Price']}
                labelFormatter={(label) => label}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={chartColor}
                strokeWidth={2}
                fill={`url(#gradient-${token.id})`}
                dot={false}
                activeDot={{ r: 4, fill: chartColor, stroke: '#fff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="token-detail-stats">
          <div className="stat-row">
            <span className="stat-label">Market Cap</span>
            <span className="stat-value">{marketData.marketCap > 0 && marketData.hasRealPrice !== false ? formatLargeNumber(marketData.marketCap) : '--'}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">24h Volume</span>
            <span className="stat-value">{formatLargeNumber(marketData.volume24h)}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">24h Change</span>
            <span className={`stat-value ${(marketData.change24h || 0) >= 0 ? 'positive' : 'negative'}`}>
              {(marketData.change24h || 0) >= 0 ? '+' : ''}{(marketData.change24h || 0).toFixed(2)}%
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">7d Change</span>
            <span className={`stat-value ${(marketData.change7d || 0) >= 0 ? 'positive' : 'negative'}`}>
              {(marketData.change7d || 0) >= 0 ? '+' : ''}{(marketData.change7d || 0).toFixed(2)}%
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">{activeTimeframe} High</span>
            <span className="stat-value">{formatPrice(high)}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">{activeTimeframe} Low</span>
            <span className="stat-value">{formatPrice(low)}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Base Pair</span>
            <span className="stat-value">NTC (Nite Coin)</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TokenDetailModal
