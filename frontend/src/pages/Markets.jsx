import { useState, useEffect, useMemo, memo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import SparklineChart from '../components/SparklineChart'
import { useTokenList } from '../stores/useTokenListStore'
import { useCurrency } from '../stores/useCurrencyStore'
import { useLanguage } from '../stores/useLanguageStore'
import useTokenApi from '../hooks/useTokenApi'
import { useTokenPrice } from '../stores/useTokenPriceStore'
import { useTokenStats, hoursMap } from '../hooks/useChartData'
import { useTokenSupplyQuery } from '../hooks/queries/useTokenSupplyQuery'

const ICON_STYLE_SM = { width: 28, height: 28, minWidth: 28, minHeight: 28, borderRadius: '50%', objectFit: 'cover' }
const ICON_STYLE_MD = { width: 36, height: 36, minWidth: 36, minHeight: 36, borderRadius: '50%', objectFit: 'cover' }
const NO_DATA_STYLE = { color: 'var(--text-muted)', fontSize: '11px' }
const NO_CHART_STYLE = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80px', color: 'var(--text-muted)', fontSize: '11px' }
const BAR_CONTAINER_STYLE = { display: 'flex', alignItems: 'flex-end', gap: '4px', height: '80px' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const EMPTY_STATS = {}
const EMPTY_SUPPLY = {}
const EMPTY_SPARK = []

const MarketRow = memo(function MarketRow({ token, index, stats, price, hasPrice, sparkData, supplyInfo, formatPrice, formatLargeNumber, getApiImage, getApiName, onNavigate }) {
  const { t } = useLanguage()
  const tToken = (key, fallback) => { const v = t(key); return v !== key ? v : fallback; }
  const vol = stats.volume24h || 0
  const change24h = stats.change24h || 0
  const change7d = stats.change7d || 0
  const hasTradeData = !!stats.hasData
  const rawSupply = parseFloat(supplyInfo.supply || '0')
  const decimals = parseInt(supplyInfo.decimals || '5', 10)
  const humanSupply = rawSupply / Math.pow(10, decimals)
  const marketCap = price * humanSupply
  const sparkColor = change7d >= 0 ? '#00d68f' : '#ff4d6a'
  const image = getApiImage(token.id)

  return (
    <tr className="token-row-clickable" onClick={() => onNavigate(token.id)}>
      <td className="coin-rank">{index + 1}</td>
      <td>
        <div className="coin-info">
          {image ? (
            <img className="coin-icon-badge" src={image} alt={token.symbol} style={ICON_STYLE_SM} />
          ) : (
            <div className="coin-icon-badge" style={{ background: `linear-gradient(135deg, ${token.color}, ${token.color}88)` }}>
              {token.symbol.slice(0, 2)}
            </div>
          )}
          <span className="coin-name">
            {tToken(`token_${token.id}_fullname`, getApiName(token.id) || token.fullName)}
            <span className="coin-symbol">{token.symbol}</span>
          </span>
        </div>
      </td>
      <td>{hasPrice ? formatPrice(price) : '--'}</td>
      <td className={change24h >= 0 ? 'price-positive' : 'price-negative'}>
        {hasTradeData ? `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%` : '--'}
      </td>
      <td className={change7d >= 0 ? 'price-positive' : 'price-negative'}>
        {hasTradeData ? `${change7d >= 0 ? '+' : ''}${change7d.toFixed(2)}%` : '--'}
      </td>
      <td>{marketCap > 0 && hasPrice ? formatLargeNumber(marketCap) : '--'}</td>
      <td>{vol > 0 ? formatLargeNumber(vol) : '--'}</td>
      <td className="sparkline-cell">
        {sparkData.length > 0 ? (
          <SparklineChart data={sparkData} color={sparkColor} />
        ) : (
          <span style={NO_DATA_STYLE}>--</span>
        )}
      </td>
    </tr>
  )
})

const StakingBarChart = memo(function StakingBarChart({ data, color }) {
  const max = Math.max(...data)

  if (max === 0) {
    return (
      <div style={NO_CHART_STYLE}>
        No trade data yet
      </div>
    )
  }

  return (
    <div style={BAR_CONTAINER_STYLE}>
      {data.map((val, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div
            style={{
              width: '100%',
              height: `${(val / max) * 60}px`,
              background: i === data.length - 1 ? color : `${color}40`,
              borderRadius: '3px 3px 0 0',
              minHeight: '4px',
            }}
          />
          <span style={{ fontSize: '8px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {MONTHS[i] || ''}
          </span>
        </div>
      ))}
    </div>
  )
})

function Markets() {
  const navigate = useNavigate()
  const [activePeriod, setActivePeriod] = useState('All')
  const { formatPrice, formatLargeNumber } = useCurrency()
  const { t } = useLanguage()
  const tToken = (key, fallback) => { const v = t(key); return v !== key ? v : fallback; }
  const { getApiName, getApiImage } = useTokenApi()
  const { getTokenPrice, hasRealPrice } = useTokenPrice()
  const { tokens: TOKENS } = useTokenList()
  const allTokens = TOKENS.filter(t => !t.isBase)
  const allTokenIds = allTokens.map(t => t.id)
  const [realSparklines, setRealSparklines] = useState({})
  const [realVolumeBars, setRealVolumeBars] = useState({})
  const { stats: tokenStats } = useTokenStats(allTokenIds)
  const { data: supplyData } = useTokenSupplyQuery()
  const tokenSupplies = useMemo(() => {
    if (!supplyData?.ok || !Array.isArray(supplyData.tokens)) return {}
    const map = {}
    supplyData.tokens.forEach(t => { map[t.symbol.toUpperCase()] = { supply: t.supply, decimals: t.decimals } })
    return map
  }, [supplyData])

  const periodVolumeConfig = {
    Week: { days: 7, sliceCount: 7, interval: '1d' },
    Month: { days: 30, sliceCount: 30, interval: '1d' },
    Year: { days: 365, sliceCount: 12, interval: '1w' },
    All: { days: 365, sliceCount: 12, interval: '1w' },
  }

  const tokenIdsKey = allTokenIds.join(',')

  useEffect(() => {
    if (!allTokens.length) return
    const periodToHours = { All: hoursMap['ALL'], Week: hoursMap['1W'], Month: hoursMap['1M'], Year: hoursMap['1Y'] }
    const hours = periodToHours[activePeriod] || hoursMap['1W']
    const volConfig = periodVolumeConfig[activePeriod] || periodVolumeConfig.Month

    allTokens.forEach(token => {
      fetch(`/api/chart/sparkline?tokenId=${encodeURIComponent(token.id)}&hours=${hours}`)
        .then(r => r.json())
        .then(data => {
          if (data.ok && data.prices && data.prices.length > 0) {
            setRealSparklines(prev => ({ ...prev, [token.id]: data.prices }))
          }
        })
        .catch(() => {})

      const now = Date.now()
      const from = now - volConfig.days * 24 * 60 * 60 * 1000
      fetch(`/api/chart/candles?tokenId=${encodeURIComponent(token.id)}&interval=${volConfig.interval}&from=${from}`)
        .then(r => r.json())
        .then(data => {
          if (data.ok && data.candles && data.candles.length > 0) {
            const volumes = data.candles.slice(-volConfig.sliceCount).map(c => c.volume || 0)
            setRealVolumeBars(prev => ({ ...prev, [token.id]: volumes }))
          }
        })
        .catch(() => {})
    })
  }, [activePeriod, tokenIdsKey])

  const topPerformers = useMemo(() => {
    return [...allTokens]
      .map(t => {
        const s = tokenStats[t.id] || {}
        return { ...t, change24h: s.change24h || 0, volume24h: s.volume24h || 0, hasData: !!s.hasData }
      })
      .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
      .slice(0, 3)
      .map(t => ({
        ...t,
        volumeData: realVolumeBars[t.id] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      }))
  }, [tokenStats, realVolumeBars])

  const handleNavigateToSwap = useCallback((tokenId) => {
    navigate('/exchange', { state: { swapTokenId: tokenId } })
  }, [navigate])

  return (
    <div className="page-container">
      <div className="staking-section">
        <div className="section-header">
          <div>
            <div className="section-subtitle">{t('markets_desc')}</div>
            <h2 className="section-title">{t('markets_title')}</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="period-filters">
              {['All', 'Week', 'Month', 'Year'].map(p => (
                <button
                  key={p}
                  className={`period-btn ${activePeriod === p ? 'active' : ''}`}
                  onClick={() => setActivePeriod(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="staking-cards">
          {topPerformers.map((token) => (
            <div className="staking-card" key={token.symbol} onClick={() => handleNavigateToSwap(token.id)} style={{ cursor: 'pointer' }}>
              <div className="staking-card-header">
                {getApiImage(token.id) ? (
                  <img className="token-icon" src={getApiImage(token.id)} alt={token.symbol} style={ICON_STYLE_MD} />
                ) : (
                  <div
                    className="token-icon"
                    style={{ background: `linear-gradient(135deg, ${token.color}, ${token.color}88)` }}
                  >
                    {token.symbol.slice(0, 2)}
                  </div>
                )}
                <div>
                  <div className="token-name">{tToken(`token_${token.id}_fullname`, getApiName(token.id) || token.fullName)} ({token.symbol})</div>
                  <div className="proof-type">24h Volume: {token.volume24h > 0 ? formatLargeNumber(token.volume24h) : '--'}</div>
                </div>
              </div>
              <div className="apy-value" style={{ color: token.hasData ? (token.change24h >= 0 ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-muted)' }}>
                {token.hasData ? `${token.change24h >= 0 ? '+' : ''}${token.change24h.toFixed(2)}%` : '--'}
              </div>
              <div className="reward-info">
                <span>Price</span>
                <span className="reward-badge positive">
                  {hasRealPrice(token.id) ? formatPrice(getTokenPrice(token.id)) : '--'}
                </span>
              </div>
              <div className="staking-chart">
                <StakingBarChart data={token.volumeData} color={token.color} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="markets-section">
        <div className="markets-header">
          <div>
            <div className="section-subtitle">{t('markets_staking_desc')}</div>
            <h2 className="markets-title">{t('dash_markets_title')}</h2>
          </div>
        </div>

        <table className="crypto-table">
          <thead>
            <tr>
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
            {allTokens.map((token, index) => (
              <MarketRow
                key={token.id}
                token={token}
                index={index}
                stats={tokenStats[token.id] || EMPTY_STATS}
                price={getTokenPrice(token.id)}
                hasPrice={hasRealPrice(token.id)}
                sparkData={realSparklines[token.id] || EMPTY_SPARK}
                supplyInfo={tokenSupplies[token.symbol.toUpperCase()] || EMPTY_SUPPLY}
                formatPrice={formatPrice}
                formatLargeNumber={formatLargeNumber}
                getApiImage={getApiImage}
                getApiName={getApiName}
                onNavigate={handleNavigateToSwap}
              />
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}

export default Markets
