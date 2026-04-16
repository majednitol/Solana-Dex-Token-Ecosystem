import { useState, useEffect, useMemo, useRef, memo, useCallback, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import SparklineChart from '../components/SparklineChart'
import CoinDetailModal from '../components/CoinDetailModal'
import { useCurrency } from '../stores/useCurrencyStore'
import { useLanguage } from '../stores/useLanguageStore'
import { useTokenList } from '../stores/useTokenListStore'
import { useWatchlist } from '../stores/useWatchlistStore'
import useTokenApi from '../hooks/useTokenApi'
import { useTokenPrice } from '../stores/useTokenPriceStore'
import { useCandles, useTokenStats, hoursMap } from '../hooks/useChartData'
import { useTokenSupplyQuery } from '../hooks/queries/useTokenSupplyQuery'
import { BarChart3, AreaChart, LineChart, Clock, Star, ArrowUpRight } from 'lucide-react'
import { getRolling6Months, niceYAxisTicks, aggregateToMonthlyBins, formatTickValue } from '../utils/chartUtils'

const STAKING_PROVIDERS = [
  { name: 'Nite Treasury Currency', symbol: 'NTC', color: '#b8f036', icon: 'NT', chartType: 'bar', key: 'ntc', subtitle: 'Proof of Stake' },
  { name: 'Dome Coin', symbol: 'DMC', color: '#a855f7', icon: 'DM', chartType: 'area', key: 'dmc', subtitle: 'Proof of Stake' },
  { name: 'America States Digital Currency', symbol: 'ASDC', color: '#b8f036', icon: 'AS', chartType: 'line', key: 'asdc', subtitle: 'Proof of Stake' },
]

function getPeriodLabel() {
  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const fmt = (d) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${fmt(sixMonthsAgo)} — ${fmt(now)}`
}
const PERIOD_LABELS = {
  All: getPeriodLabel(),
  Week: getPeriodLabel(),
  Month: getPeriodLabel(),
  Year: getPeriodLabel(),
}

const ICON_STYLE_40 = { width: 40, height: 40, borderRadius: '50%' }
const STAR_CELL_STYLE = { cursor: 'pointer' }
const NO_DATA_CENTER_STYLE = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '100px', color: 'var(--text-muted)', fontSize: '12px' }

const DashAssetRow = memo(function DashAssetRow({ asset, isSaved, onToggle, onSelect, formatPrice, formatLargeNumber, formatVolumeWithUnits }) {
  const change24h = asset.price_change_percentage_24h ?? 0
  const change7d = asset.price_change_percentage_7d_in_currency ?? 0
  const sparkData = asset.sparkline_in_7d?.price || []
  const sparkSampled = sparkData.length > 20
    ? sparkData.filter((_, i) => i % Math.max(1, Math.floor(sparkData.length / 20)) === 0)
    : sparkData
  const sparkColor = change7d >= 0 ? '#00d68f' : '#ff4d6a'
  const vol = formatVolumeWithUnits(asset.total_volume, asset.current_price, asset.symbol)

  return (
    <tr className="dash-row-clickable" onClick={() => onSelect(asset)}>
      <td className="dash-star-cell" onClick={(e) => { e.stopPropagation(); onToggle(asset.id) }} style={STAR_CELL_STYLE}>
        <Star size={14} fill={isSaved ? 'currentColor' : 'none'} />
      </td>
      <td className="dash-rank">{asset.market_cap_rank}</td>
      <td>
        <div className="dash-coin-info">
          {asset.image ? (
            <img className="dash-coin-img" src={asset.image} alt={asset.name} width="28" height="28" />
          ) : (
            <div className="dash-coin-icon" style={{ background: `linear-gradient(135deg, ${asset.tokenColor}, ${asset.tokenColor}88)` }}>
              {asset.tokenSymbolShort}
            </div>
          )}
          <span className="dash-coin-name">{asset.name}</span>
          <span className="dash-coin-symbol">{asset.symbol.toUpperCase()}</span>
        </div>
      </td>
      <td className="dash-price">{asset.hasRealPrice ? formatPrice(asset.current_price) : '--'}</td>
      <td className={change24h >= 0 ? 'dash-positive' : 'dash-negative'}>
        {asset.hasTradeData ? `${change24h >= 0 ? '▲' : '▼'} ${Math.abs(change24h).toFixed(2)}%` : '--'}
      </td>
      <td className={change7d >= 0 ? 'dash-positive' : 'dash-negative'}>
        {asset.hasTradeData ? `${change7d >= 0 ? '▲' : '▼'} ${Math.abs(change7d).toFixed(2)}%` : '--'}
      </td>
      <td>{asset.market_cap > 0 && asset.hasRealPrice ? formatLargeNumber(asset.market_cap) : '--'}</td>
      <td>
        <div className="dash-volume-cell">
          <span>{vol.formatted}</span>
          <span className="dash-volume-unit">{vol.units}</span>
        </div>
      </td>
      <td className="dash-sparkline-cell">
        {sparkSampled.length > 0 && (
          <SparklineChart data={sparkSampled} color={sparkColor} width={100} height={36} />
        )}
      </td>
    </tr>
  )
})

function buildTokenAssets(btcData, getApiName, getApiImage, getTokenPrice, tokenStats, realSparklines, TOKENS, hasRealPrice, tokenSupplies) {
  const assets = []

  if (btcData) {
    assets.push({
      id: 'bitcoin',
      name: 'Bitcoin',
      symbol: 'btc',
      current_price: btcData.current_price,
      price_change_percentage_24h: btcData.price_change_percentage_24h,
      price_change_percentage_7d_in_currency: btcData.price_change_percentage_7d_in_currency,
      price_change_percentage_30d_in_currency: btcData.price_change_percentage_30d_in_currency,
      price_change_percentage_1y_in_currency: btcData.price_change_percentage_1y_in_currency,
      market_cap: btcData.market_cap,
      total_volume: btcData.total_volume,
      market_cap_rank: 1,
      image: btcData.image,
      sparkline_in_7d: btcData.sparkline_in_7d,
      circulating_supply: btcData.circulating_supply,
      total_supply: btcData.total_supply,
      max_supply: btcData.max_supply,
      isBtc: true,
      hasTradeData: true,
      hasRealPrice: true,
    })
  }

  TOKENS.forEach((token, idx) => {
    const s = tokenStats[token.id] || {}
    const price = getTokenPrice ? getTokenPrice(token.id) : 0
    const sparkData = realSparklines[token.id] || []
    const apiName = getApiName ? getApiName(token.id) : null
    const apiImage = getApiImage ? getApiImage(token.id) : null
    const supplyInfo = tokenSupplies[token.symbol.toUpperCase()] || {}
    const rawSupply = parseFloat(supplyInfo.supply || '0')
    const decimals = parseInt(supplyInfo.decimals || '5', 10)
    const humanSupply = rawSupply / Math.pow(10, decimals)
    const marketCap = price * humanSupply
    assets.push({
      id: token.id,
      name: apiName || token.fullName,
      symbol: token.symbol.toLowerCase(),
      current_price: price,
      price_change_percentage_24h: s.change24h || 0,
      price_change_percentage_7d_in_currency: s.change7d || 0,
      hasTradeData: !!s.hasData,
      price_change_percentage_30d_in_currency: 0,
      price_change_percentage_1y_in_currency: 0,
      market_cap: marketCap,
      total_volume: s.volume24h || 0,
      market_cap_rank: btcData ? idx + 2 : idx + 1,
      image: apiImage || null,
      tokenColor: token.color,
      tokenSymbolShort: token.symbol.slice(0, 2),
      sparkline_in_7d: { price: sparkData },
      circulating_supply: humanSupply,
      total_supply: humanSupply,
      max_supply: humanSupply,
      isCustomToken: true,
      hasRealPrice: hasRealPrice ? hasRealPrice(token.id) : false,
    })
  })

  return assets
}

function Dashboard() {
  const navigate = useNavigate()
  const [activePeriod, setActivePeriod] = useState('All')
  const [statsTimeFilter, setStatsTimeFilter] = useState('24h')
  const [showTimeDropdown, setShowTimeDropdown] = useState(false)
  const { formatPrice, formatLargeNumber } = useCurrency()
  const { t } = useLanguage()
  const [btcData, setBtcData] = useState(null)
  const btcDataRef = useRef(null)
  const sliderRef = useRef(null)
  const sliderPaused = useRef(false)
  const sliderResumeTimer = useRef(null)

  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 700px)').matches
    if (!isMobile) return
    const interval = setInterval(() => {
      const el = sliderRef.current
      if (!el || sliderPaused.current) return
      const cardWidth = el.firstElementChild?.offsetWidth || 280
      const gap = 12
      const maxScroll = el.scrollWidth - el.clientWidth
      if (el.scrollLeft >= maxScroll - 5) {
        el.scrollTo({ left: 0, behavior: 'smooth' })
      } else {
        el.scrollBy({ left: cardWidth + gap, behavior: 'smooth' })
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [selectedCoin, setSelectedCoin] = useState(null)
  const { toggleToken, isSaved } = useWatchlist()
  const { getApiName, getApiImage } = useTokenApi()
  const { getTokenPrice, hasRealPrice } = useTokenPrice()
  const { tokens: TOKENS } = useTokenList()
  const [chartTypes, setChartTypes] = useState({
    ntc: 'bar',
    dmc: 'area',
    asdc: 'line',
  })

  const allTokenIds = useMemo(() => TOKENS.map(t => t.id), [TOKENS])
  const { stats: tokenStats } = useTokenStats(allTokenIds)
  const [realSparklines, setRealSparklines] = useState({})
  const { data: supplyData } = useTokenSupplyQuery()
  const tokenSupplies = useMemo(() => {
    if (!supplyData?.ok || !Array.isArray(supplyData.tokens)) return {}
    const map = {}
    supplyData.tokens.forEach(t => { map[t.symbol.toUpperCase()] = { supply: t.supply, decimals: t.decimals } })
    return map
  }, [supplyData])

  const dashPeriodToHours = { Day: hoursMap['1D'], Week: hoursMap['1W'], Month: hoursMap['1M'], Year: hoursMap['ALL'] }
  const tokenIdsKey = useMemo(() => TOKENS.map(t => t.id).join(','), [TOKENS])

  useEffect(() => {
    if (!TOKENS.length) return
    const hours = dashPeriodToHours[activePeriod] || hoursMap['1W']
    TOKENS.forEach(token => {
      fetch(`/api/chart/sparkline?tokenId=${encodeURIComponent(token.id)}&hours=${hours}`)
        .then(r => r.json())
        .then(data => {
          if (data.ok && data.prices && data.prices.length > 0) {
            setRealSparklines(prev => ({ ...prev, [token.id]: data.prices }))
          }
        })
        .catch(() => {})
    })
  }, [activePeriod, tokenIdsKey])

  const { candles: ntcCandles, hasData: ntcHasData } = useCandles('ntc', 'ALL')
  const { candles: dmcCandles, hasData: dmcHasData } = useCandles('dmc', 'ALL')
  const { candles: asdcCandles, hasData: asdcHasData } = useCandles('asdc', 'ALL')
  const currentMonth = new Date().getMonth()
  const monthLabels = useMemo(() => getRolling6Months(), [currentMonth])
  const realChartData = useMemo(() => ({
    ntc: ntcHasData ? aggregateToMonthlyBins(ntcCandles, 'avg') : null,
    dmc: dmcHasData ? aggregateToMonthlyBins(dmcCandles, 'avg') : null,
    asdc: asdcHasData ? aggregateToMonthlyBins(asdcCandles, 'avg') : null,
  }), [ntcCandles, ntcHasData, dmcCandles, dmcHasData, asdcCandles, asdcHasData])

  useEffect(() => {
    let isCancelled = false
    let retryDelay = 60000
    let timerId = null

    function scheduleNext() {
      if (isCancelled) return
      timerId = setTimeout(() => { fetchBtc(); }, retryDelay)
    }

    function applyBtc(data, ts) {
      btcDataRef.current = data
      setBtcData(data)
      setLastUpdated(ts instanceof Date ? ts : new Date(ts))
    }

    async function fetchBtc() {
      try {
        if (!btcDataRef.current) setLoading(true)
        const res = await fetch(
          '/api/coingecko/api/v3/coins/markets?vs_currency=usd&ids=bitcoin&sparkline=true&price_change_percentage=24h,7d,30d,1y'
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          if (res.status === 429 || body?.status?.error_code === 429) {
            retryDelay = Math.min(retryDelay * 2, 300000)
            if (!isCancelled && !btcDataRef.current) {
              const cached = loadBtcCache()
              if (cached) applyBtc(cached.data, cached.ts)
            }
            if (!isCancelled) setLoading(false)
            scheduleNext()
            return
          }
          throw new Error(`API returned ${res.status}`)
        }
        const data = await res.json()
        if (!isCancelled && Array.isArray(data) && data.length > 0) {
          applyBtc(data[0], new Date())
          try { localStorage.setItem('btc_cache', JSON.stringify({ data: data[0], ts: Date.now() })) } catch {}
        }
        if (!isCancelled) { setError(null); setLoading(false) }
        retryDelay = 60000
        scheduleNext()
      } catch (err) {
        if (!isCancelled) {
          if (!btcDataRef.current) {
            const cached = loadBtcCache()
            if (cached) applyBtc(cached.data, cached.ts)
            else setError(err.message)
          }
          setLoading(false)
        }
        retryDelay = Math.min(retryDelay * 2, 300000)
        scheduleNext()
      }
    }

    function loadBtcCache() {
      try {
        const raw = localStorage.getItem('btc_cache')
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (Date.now() - parsed.ts > 86400000) return null
        return parsed
      } catch { return null }
    }

    const cached = loadBtcCache()
    if (cached) {
      applyBtc(cached.data, cached.ts)
      setLoading(false)
    }

    fetchBtc()
    return () => { isCancelled = true; if (timerId) clearTimeout(timerId) }
  }, [])

  const allAssets = useMemo(() => buildTokenAssets(btcData, getApiName, getApiImage, getTokenPrice, tokenStats, realSparklines, TOKENS, hasRealPrice, tokenSupplies), [btcData, getApiName, getApiImage, getTokenPrice, tokenStats, realSparklines, TOKENS, hasRealPrice, tokenSupplies])

  const stakingData = useMemo(() => {
    return STAKING_PROVIDERS.map((provider) => {
      const rc = realChartData[provider.key]
      const hasRealData = rc && rc.some(v => v > 0)
      const ts = tokenStats[provider.key] || {}
      const vol = ts.volume24h || 0
      const feeTier = 0.30
      const dailyFees = vol * feeTier / 100
      const periodMult = activePeriod === 'All' ? 180 : activePeriod === 'Week' ? 7 : activePeriod === 'Month' ? 30 : 365
      const periodFees = dailyFees * periodMult
      const priceChange = activePeriod === 'All' ? (ts.change7d || 0) * 26
        : activePeriod === 'Week' ? (ts.change7d || 0)
        : activePeriod === 'Month' ? (ts.change7d || 0) * 4.3
        : (ts.change7d || 0) * 52
      const computedApy = hasRealData && ts.hasData
        ? parseFloat((priceChange !== 0 ? priceChange : (dailyFees > 0 ? feeTier * periodMult / 100 : 0)).toFixed(2))
        : 0
      const computedRewardRate = hasRealData && ts.hasData
        ? parseFloat(periodFees.toFixed(2))
        : 0
      const pd = hasRealData
        ? { apy: computedApy, rewardRate: computedRewardRate, chartData: rc, months: monthLabels }
        : { apy: 0, rewardRate: 0, chartData: [], months: [] }
      return { provider, pd, hasRealData }
    })
  }, [realChartData, tokenStats, activePeriod, monthLabels])

  const handleSelectAsset = useCallback((asset) => {
    if (asset.isCustomToken) {
      navigate('/exchange', { state: { swapTokenId: asset.id } })
    } else {
      setSelectedCoin(asset)
    }
  }, [navigate])

  const formatVolumeWithUnits = useCallback((volume, price, symbol) => {
    if (!volume || !price || price === 0) return { formatted: formatLargeNumber(volume), units: '' }
    const coinAmount = volume / price
    let unitStr = ''
    if (coinAmount >= 1e9) unitStr = `${(coinAmount / 1e9).toFixed(0)}B ${symbol.toUpperCase()}`
    else if (coinAmount >= 1e6) unitStr = `${(coinAmount / 1e6).toFixed(0)}M ${symbol.toUpperCase()}`
    else if (coinAmount >= 1e3) unitStr = `${Math.round(coinAmount).toLocaleString()} ${symbol.toUpperCase()}`
    else unitStr = `${coinAmount.toFixed(2)} ${symbol.toUpperCase()}`
    return { formatted: formatLargeNumber(volume), units: unitStr }
  }, [formatLargeNumber])

  return (
    <div className="page-container">
      <div className="dash-staking-section">
        <div className="dash-staking-header">
          <div>
            <h2 className="dash-title">{t('dash_crypto_staking')}</h2>
          </div>
          <div className="dash-header-right">
            <div className="dash-period-filters">
              {['All', 'Week', 'Month', 'Year'].map(p => (
                <button
                  key={p}
                  className={`dash-period-btn ${activePeriod === p ? 'active' : ''}`}
                  onClick={() => setActivePeriod(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="dash-date-range">{PERIOD_LABELS[activePeriod]}</div>
          </div>
        </div>

        <div className="dash-staking-cards" ref={sliderRef} onTouchStart={() => { sliderPaused.current = true; clearTimeout(sliderResumeTimer.current); sliderResumeTimer.current = setTimeout(() => { sliderPaused.current = false }, 5000) }}>
          {stakingData.map(({ provider, pd }) => {
            const activeChart = chartTypes[provider.key] || provider.chartType
            return (
            <div className="dash-staking-card" key={provider.symbol}>
              <div className="dash-card-top">
                {getApiImage(provider.key) ? (
                  <img className="dash-card-icon" src={getApiImage(provider.key)} alt={provider.symbol} style={ICON_STYLE_40} />
                ) : (
                  <div className="dash-card-icon" style={{ background: `linear-gradient(135deg, ${provider.color}, ${provider.color}88)` }}>
                    {provider.icon}
                  </div>
                )}
                <div className="dash-card-info">
                  <div className="dash-card-name">{getApiName(provider.key) || provider.name} ({provider.symbol})</div>
                </div>
                <button className="dash-card-swap-btn" onClick={() => navigate('/exchange', { state: { swapTokenId: provider.key } })} title="Swap">
                  <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="dash-apy-value">{pd.apy}%</div>
              <div className="dash-reward-row">
                <span className="dash-reward-label">{t('dash_reward_rate')}</span>
                <span className="dash-reward-badge">
                  <span className="dash-reward-icon">◉</span> ${pd.rewardRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <div className="dash-chart-icons">
                  <button className={`dash-chart-icon-btn ${activeChart === 'bar' ? 'active' : ''}`} onClick={() => setChartTypes(prev => ({ ...prev, [provider.key]: 'bar' }))}><BarChart3 size={14} /></button>
                  <button className={`dash-chart-icon-btn ${activeChart === 'area' ? 'active' : ''}`} onClick={() => setChartTypes(prev => ({ ...prev, [provider.key]: 'area' }))}><AreaChart size={14} /></button>
                  <button className={`dash-chart-icon-btn ${activeChart === 'line' ? 'active' : ''}`} onClick={() => setChartTypes(prev => ({ ...prev, [provider.key]: 'line' }))}><LineChart size={14} /></button>
                </div>
              </div>
              <div className="dash-chart-area">
                {pd.chartData.length > 0 ? (
                  <>
                    {activeChart === 'bar' && (
                      <DashBarChart data={pd.chartData} color={provider.color} months={pd.months} />
                    )}
                    {activeChart === 'area' && (
                      <DashAreaChart data={pd.chartData} color={provider.color} months={pd.months} />
                    )}
                    {activeChart === 'line' && (
                      <DashLineChart data={pd.chartData} color={provider.color} months={pd.months} />
                    )}
                  </>
                ) : (
                  <div style={NO_DATA_CENTER_STYLE}>
                    No trade data yet
                  </div>
                )}
              </div>
            </div>
            )
          })}
        </div>
      </div>

      <div className="dash-assets-section">
        <div className="dash-assets-header">
          <div>
            <div className="dash-subtitle">
              Live market data
              {lastUpdated && (
                <span className="dash-live-indicator"> · Updated {lastUpdated.toLocaleTimeString()}</span>
              )}
            </div>
            <h2 className="dash-title">{t('dash_markets_title')}</h2>
          </div>
          <div className="dash-assets-filters">
            <div className="dash-time-dropdown" onClick={() => setShowTimeDropdown(v => !v)}>
              <Clock size={14} /> {statsTimeFilter.toUpperCase()} <span className="dash-dropdown-arrow">▾</span>
              {showTimeDropdown && (
                <div className="dash-time-dropdown-menu">
                  {['24h', '7d', '30d', '1y'].map(period => (
                    <div
                      key={period}
                      className={`dash-time-dropdown-item ${statsTimeFilter === period ? 'active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setStatsTimeFilter(period); setShowTimeDropdown(false) }}
                    >
                      {period === '24h' ? '24H' : period === '7d' ? '1W' : period === '30d' ? '1M' : '1Y'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {loading && !btcData && (
          <div className="dash-loading">
            <div className="dash-loading-spinner" />
            <span>{t('dash_loading')}</span>
          </div>
        )}

        {error && !btcData && allAssets.length === 0 && (
          <div className="dash-error">
            <span>Unable to load market data. Please try again later.</span>
            <button className="dash-retry-btn" onClick={() => window.location.reload()}>Retry</button>
          </div>
        )}

        {allAssets.length > 0 && (
          <table className="dash-crypto-table">
            <thead>
              <tr>
                <th></th>
                <th>{t('dash_rank')}</th>
                <th>{t('dash_name')}</th>
                <th>{t('dash_price')}</th>
                <th>{t('dash_24h')}</th>
                <th>{t('dash_7d')}</th>
                <th>{t('dash_market_cap')}</th>
                <th>{t('dash_volume')}</th>
                <th>{t('dash_last_7d')}</th>
              </tr>
            </thead>
            <tbody>
              {allAssets.map((asset) => (
                <DashAssetRow
                  key={asset.id}
                  asset={asset}
                  isSaved={isSaved(asset.id)}
                  onToggle={toggleToken}
                  onSelect={handleSelectAsset}
                  formatPrice={formatPrice}
                  formatLargeNumber={formatLargeNumber}
                  formatVolumeWithUnits={formatVolumeWithUnits}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedCoin && (
        <CoinDetailModal
          coin={selectedCoin}
          onClose={() => setSelectedCoin(null)}
        />
      )}
    </div>
  )
}

/* Cubic Bezier smooth path for SVG curves */
function smoothPath(points) {
  if (points.length < 2) return ''
  let d = `M${points[0].x},${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(i + 2, points.length - 1)]
    const tension = 0.3
    const cp1x = p1.x + (p2.x - p0.x) * tension
    const cp1y = p1.y + (p2.y - p0.y) * tension
    const cp2x = p2.x - (p3.x - p1.x) * tension
    const cp2y = p2.y - (p3.y - p1.y) * tension
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
  }
  return d
}

/* Bar Chart — rounded vertical bars with grey background bars, dynamic Y-axis from 0 */
const DashBarChart = memo(function DashBarChart({ data, color, months }) {
  const [hovIdx, setHovIdx] = useState(null)
  if (!data || data.length === 0) return <div className="dash-chart-container" />
  const dataMax = Math.max(...data)
  const ticks = niceYAxisTicks(dataMax, 4)
  const yMax = ticks[ticks.length - 1]

  return (
    <div className="dash-chart-container" onMouseLeave={() => setHovIdx(null)}>
      <div className="dash-chart-y-axis">
        {[...ticks].reverse().map((v, i) => (
          <span key={i}>{formatTickValue(v)}</span>
        ))}
      </div>
      <div className="dash-chart-main">
        <div className="dash-bars-wrap">
          {data.map((val, i) => {
            const pct = yMax > 0 ? Math.max((val / yMax) * 100, 2) : 2
            return (
              <div key={i} className="dash-bar-col" onMouseEnter={() => setHovIdx(i)} style={{ cursor: 'crosshair' }}>
                <div className="dash-bar-track">
                  <div className="dash-bar-bg" />
                  <div className="dash-bar-divider" style={{ bottom: `${pct}%`, background: color }} />
                  <div
                    className="dash-bar"
                    style={{
                      height: `${pct}%`,
                      background: `linear-gradient(180deg, ${color}, ${color}cc)`,
                      opacity: hovIdx !== null && hovIdx !== i ? 0.45 : 1,
                    }}
                  />
                </div>
              </div>
            )
          })}
          {hovIdx !== null && (
            <div className="dash-chart-tooltip" style={{ left: `${((hovIdx + 0.5) / data.length) * 100}%`, bottom: `${Math.max((data[hovIdx] / yMax) * 100, 2) + 8}%` }}>
              <div className="dash-tooltip-value">{formatTickValue(data[hovIdx])}</div>
              <div className="dash-tooltip-label">{months[hovIdx] || ''}</div>
            </div>
          )}
        </div>
        <div className="dash-chart-x-labels">
          {months.map((m, i) => <span key={i}>{m}</span>)}
        </div>
      </div>
    </div>
  )
})

/* Area Chart — smooth filled area with hatched grey envelope and colored overlay, dynamic Y-axis from 0 */
const DashAreaChart = memo(function DashAreaChart({ data, color, months }) {
  const [hovIdx, setHovIdx] = useState(null)
  const chartId = useId().replace(/:/g, '')
  if (!data || data.length < 2) return <div className="dash-chart-container" />
  const dataMax = Math.max(...data)
  const ticks = niceYAxisTicks(dataMax, 4)
  const yMax = ticks[ticks.length - 1]
  const w = 240
  const h = 120
  const padL = 4
  const padR = 4
  const padT = 8
  const padB = 4

  const toY = (v) => padT + (1 - v / yMax) * (h - padT - padB)

  const points = data.map((v, i) => ({
    x: padL + (i / (data.length - 1)) * (w - padL - padR),
    y: toY(v),
  }))
  const curvePath = smoothPath(points)
  const areaPath = curvePath + ` L${points[points.length - 1].x},${h - padB} L${points[0].x},${h - padB} Z`

  const envelopeScale = 1.8
  const envelopePoints = data.map((v, i) => ({
    x: padL + (i / (data.length - 1)) * (w - padL - padR),
    y: toY(Math.min(v * envelopeScale, yMax)),
  }))
  const envelopeCurve = smoothPath(envelopePoints)
  const envelopeArea = envelopeCurve + ` L${envelopePoints[envelopePoints.length - 1].x},${h - padB} L${envelopePoints[0].x},${h - padB} Z`

  const slotWidth = w / data.length

  return (
    <div className="dash-chart-container" onMouseLeave={() => setHovIdx(null)}>
      <div className="dash-chart-y-axis">
        {[...ticks].reverse().map((v, i) => (
          <span key={i}>{formatTickValue(v)}</span>
        ))}
      </div>
      <div className="dash-chart-main">
        <div className="dash-svg-wrap">
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="dash-chart-svg">
            <defs>
              <pattern id={`${chartId}-grey-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" stroke="#3E3C44" strokeWidth="1.2" strokeOpacity="1" />
              </pattern>
              <mask id={`${chartId}-env-mask`}>
                <path d={envelopeArea} fill="white" />
              </mask>
              <linearGradient id={`${chartId}-grad`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.6" />
                <stop offset="100%" stopColor={color} stopOpacity="0.08" />
              </linearGradient>
              <pattern id={`${chartId}-color-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" stroke={color} strokeWidth="1" strokeOpacity="0.25" />
              </pattern>
              <mask id={`${chartId}-area-mask`}>
                <path d={areaPath} fill="white" />
              </mask>
            </defs>
            <rect x="0" y="0" width={w} height={h} fill={`url(#${chartId}-grey-hatch)`} mask={`url(#${chartId}-env-mask)`} />
            <path d={envelopeCurve} fill="none" stroke="#3E3C44" strokeWidth="0.8" strokeOpacity="0.6" />
            <path d={areaPath} fill={`url(#${chartId}-grad)`} />
            <rect x="0" y="0" width={w} height={h} fill={`url(#${chartId}-color-hatch)`} mask={`url(#${chartId}-area-mask)`} />
            <path d={curvePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {hovIdx !== null && points[hovIdx] && (
              <>
                <line x1={points[hovIdx].x} y1={padT} x2={points[hovIdx].x} y2={h - padB} stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="3,2" />
                <circle cx={points[hovIdx].x} cy={points[hovIdx].y} r="4" fill={color} stroke="#fff" strokeWidth="1.5" />
              </>
            )}
            {data.map((_, i) => (
              <rect key={`h${i}`} x={i * slotWidth} y={0} width={slotWidth} height={h} fill="transparent"
                onMouseEnter={() => setHovIdx(i)} style={{ cursor: 'crosshair' }} />
            ))}
          </svg>
        </div>
        <div className="dash-chart-x-labels">
          {months.map((m, i) => <span key={i}>{m}</span>)}
        </div>
        {hovIdx !== null && (
          <div className="dash-chart-tooltip" style={{ left: `${((hovIdx + 0.5) / data.length) * 100}%`, top: 0 }}>
            <div className="dash-tooltip-value">{formatTickValue(data[hovIdx])}</div>
            <div className="dash-tooltip-label">{months[hovIdx] || ''}</div>
          </div>
        )}
      </div>
    </div>
  )
})

/* Line Chart — smooth line with wide grey hatched envelope band, matching Sphere UI */
const DashLineChart = memo(function DashLineChart({ data, color, months }) {
  const [hovIdx, setHovIdx] = useState(null)
  const lineId = useId().replace(/:/g, '')
  if (!data || data.length < 2) return <div className="dash-chart-container" />
  const dataMax = Math.max(...data)
  const ticks = niceYAxisTicks(dataMax, 4)
  const yMax = ticks[ticks.length - 1]
  const w = 240
  const h = 120
  const padL = 4
  const padR = 4
  const padT = 8
  const padB = 4
  const chartH = h - padT - padB

  const toPoint = (arr) => arr.map((v, i) => ({
    x: padL + (i / (arr.length - 1)) * (w - padL - padR),
    y: padT + (1 - v / yMax) * chartH,
  }))

  const points = toPoint(data)
  const curvePath = smoothPath(points)

  const greyPx = chartH * 0.28
  const greyUpperPts = points.map(p => ({ x: p.x, y: Math.max(p.y - greyPx, padT) }))
  const greyLowerPts = points.map(p => ({ x: p.x, y: Math.min(p.y + greyPx, h - padB) }))
  const greyBandPath = smoothPath(greyUpperPts) +
    ` L${greyLowerPts[greyLowerPts.length - 1].x},${greyLowerPts[greyLowerPts.length - 1].y}` +
    smoothPath([...greyLowerPts].reverse()).replace(/^M/, ' L') + ' Z'

  const slotWidth = w / data.length

  return (
    <div className="dash-chart-container" onMouseLeave={() => setHovIdx(null)}>
      <div className="dash-chart-y-axis">
        {[...ticks].reverse().map((v, i) => (
          <span key={i}>{formatTickValue(v)}</span>
        ))}
      </div>
      <div className="dash-chart-main">
        <div className="dash-svg-wrap">
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="dash-chart-svg">
            <defs>
              <pattern id={`${lineId}-grey-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" stroke="#3E3C44" strokeWidth="1.2" strokeOpacity="1" />
              </pattern>
            </defs>
            <path d={greyBandPath} fill={`url(#${lineId}-grey-hatch)`} />
            <path d={curvePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {hovIdx !== null && points[hovIdx] && (
              <>
                <line x1={points[hovIdx].x} y1={padT} x2={points[hovIdx].x} y2={h - padB} stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="3,2" />
                <circle cx={points[hovIdx].x} cy={points[hovIdx].y} r="4" fill={color} stroke="#fff" strokeWidth="1.5" />
              </>
            )}
            {data.map((_, i) => (
              <rect key={`h${i}`} x={i * slotWidth} y={0} width={slotWidth} height={h} fill="transparent"
                onMouseEnter={() => setHovIdx(i)} style={{ cursor: 'crosshair' }} />
            ))}
          </svg>
        </div>
        <div className="dash-chart-x-labels">
          {months.map((m, i) => <span key={i}>{m}</span>)}
        </div>
        {hovIdx !== null && (
          <div className="dash-chart-tooltip" style={{ left: `${((hovIdx + 0.5) / data.length) * 100}%`, top: 0 }}>
            <div className="dash-tooltip-value">{formatTickValue(data[hovIdx])}</div>
            <div className="dash-tooltip-label">{months[hovIdx] || ''}</div>
          </div>
        )}
      </div>
    </div>
  )
})

export default Dashboard
