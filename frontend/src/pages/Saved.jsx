import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWatchlist } from '../stores/useWatchlistStore'
import { useCurrency } from '../stores/useCurrencyStore'
import { useLanguage } from '../stores/useLanguageStore'
import { useTokenList } from '../stores/useTokenListStore'
import SparklineChart from '../components/SparklineChart'
import useTokenApi from '../hooks/useTokenApi'
import { useTokenPrice } from '../stores/useTokenPriceStore'
import { useTokenStats } from '../hooks/useChartData'
import { useTokenSupplyQuery } from '../hooks/queries/useTokenSupplyQuery'
import { Star } from 'lucide-react'

function Saved() {
  const { savedTokens, toggleToken } = useWatchlist()
  const { formatPrice, formatLargeNumber } = useCurrency()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { getApiName, getApiImage } = useTokenApi()
  const { getTokenPrice, hasRealPrice } = useTokenPrice()
  const { tokens: TOKENS } = useTokenList()
  const [realSparklines, setRealSparklines] = useState({})
  const { stats: tokenStats } = useTokenStats(savedTokens)
  const { data: supplyData } = useTokenSupplyQuery()
  const tokenSupplies = useMemo(() => {
    if (!supplyData?.ok || !Array.isArray(supplyData.tokens)) return {}
    const map = {}
    supplyData.tokens.forEach(t => { map[t.symbol.toUpperCase()] = { supply: t.supply, decimals: t.decimals } })
    return map
  }, [supplyData])

  useEffect(() => {
    savedTokens.forEach(tokenId => {
      fetch(`/api/chart/sparkline?tokenId=${encodeURIComponent(tokenId)}&hours=720`)
        .then(r => r.json())
        .then(data => {
          if (data.ok && data.prices && data.prices.length > 0) {
            setRealSparklines(prev => ({ ...prev, [tokenId]: data.prices }))
          }
        })
        .catch(() => {})
    })
  }, [savedTokens])

  const tokens = TOKENS.filter(t => savedTokens.includes(t.id))

  if (tokens.length === 0) {
    return (
      <div className="page-container">
        <h1 className="saved-page-title">{t('saved_title')}</h1>
        <div className="saved-empty">
          <div className="saved-empty-icon"><Star size={48} /></div>
          <h2>{t('saved_empty')}</h2>
          <p>{t('saved_empty_desc')}</p>
          <button className="saved-explore-btn" onClick={() => navigate('/exchange')}>
            {t('saved_go_exchange')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <h1 className="saved-page-title">{t('saved_title')}</h1>
      <div className="saved-grid">
        {tokens.map(token => {
          const hasReal = realSparklines[token.id] && realSparklines[token.id].length > 0
          const sparkData = hasReal ? realSparklines[token.id] : []
          const s = tokenStats[token.id] || {}
          const change = s.hasData ? s.change7d : 0
          const isPositive = change >= 0

          return (
            <div key={token.id} className="saved-card">
              <div className="saved-card-header">
                <div className="saved-card-token-info">
                  {getApiImage(token.id) ? (
                    <img src={getApiImage(token.id)} alt={token.symbol} className="saved-card-badge" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                  ) : (
                    <div
                      className="saved-card-badge"
                      style={{ background: `linear-gradient(135deg, ${token.color}88, ${token.color}44)` }}
                    >
                      {token.symbol.slice(0, 2)}
                    </div>
                  )}
                  <div>
                    <div className="saved-card-name">{getApiName(token.id) || token.fullName}</div>
                    <div className="saved-card-symbol">{token.symbol}</div>
                  </div>
                </div>
                <div className="saved-card-actions">
                  <button
                    className="saved-card-remove"
                    onClick={(e) => { e.stopPropagation(); toggleToken(token.id) }}
                    title={t('saved_remove')}

                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="saved-card-price-row">
                <span className="saved-card-price">{hasRealPrice(token.id) ? formatPrice(getTokenPrice(token.id)) : '--'}</span>
                <span className={`saved-card-change ${isPositive ? 'positive' : 'negative'}`}>
                  {s.hasData ? (
                    <>{isPositive ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</>
                  ) : (
                    '--'
                  )}
                </span>
              </div>

              <div className="saved-card-chart">
                {sparkData.length > 0 ? (
                  <SparklineChart
                    data={sparkData}
                    color={isPositive ? '#00d18c' : '#ef4444'}
                    width={280}
                    height={80}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80px', color: 'var(--text-muted)', fontSize: '12px' }}>
                    No trade data yet
                  </div>
                )}
              </div>

              <div className="saved-card-details">
                <div className="saved-card-detail">
                  <span className="saved-card-label">{t('coin_detail_market_cap')}</span>
                  <span className="saved-card-value">{(() => {
                    if (!hasRealPrice(token.id)) return '--'
                    const supplyInfo = tokenSupplies[token.symbol.toUpperCase()] || {}
                    const rawSupply = parseFloat(supplyInfo.supply || '0')
                    const decimals = parseInt(supplyInfo.decimals || '5', 10)
                    const humanSupply = rawSupply / Math.pow(10, decimals)
                    const marketCap = getTokenPrice(token.id) * humanSupply
                    return marketCap > 0 ? formatLargeNumber(marketCap) : '--'
                  })()}</span>
                </div>
                <div className="saved-card-detail">
                  <span className="saved-card-label">{t('coin_detail_volume')}</span>
                  <span className="saved-card-value">{s.volume24h > 0 ? formatLargeNumber(s.volume24h) : '--'}</span>
                </div>
                <div className="saved-card-detail">
                  <span className="saved-card-label">{t('saved_fiat_pair')}</span>
                  <span className="saved-card-value">{token.fiatSymbol}</span>
                </div>
              </div>

              <button
                className="saved-card-trade-btn"
                onClick={() => navigate('/exchange', { state: { swapTokenId: token.id } })}
              >
                {t('saved_trade')} {token.symbol}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Saved
