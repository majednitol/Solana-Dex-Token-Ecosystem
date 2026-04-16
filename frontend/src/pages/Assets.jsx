import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useTokenList } from '../stores/useTokenListStore'
import { useCurrency } from '../stores/useCurrencyStore'
import { useLanguage } from '../stores/useLanguageStore'
import { useTokenPrice } from '../stores/useTokenPriceStore'
import STATIC_TOKENS from '../data/tokens'
import useTokenApi from '../hooks/useTokenApi'
import { useTokenStats } from '../hooks/useChartData'
import { useSSERefresh } from '../hooks/useSSEEvent'

const STATIC_NTC_PRICE = 1

function Assets() {
  const { connected, publicKey } = useWallet()
  const { connection } = useConnection()
  const navigate = useNavigate()
  const { formatPrice, currency } = useCurrency()
  const { getTokenPrice, hasRealPrice } = useTokenPrice()
  const ntcPrice = getTokenPrice('ntc') || STATIC_NTC_PRICE
  const { t } = useLanguage()
  const { tokens: TOKENS } = useTokenList()
  const ntcToken = TOKENS.find(t => t.isBase)
  const pairTokens = TOKENS.filter(t => !t.isBase)
  const [solBalance, setSolBalance] = useState(null)
  const [apiBalances, setApiBalances] = useState({})
  const [balancesLoading, setBalancesLoading] = useState(false)
  const { getApiName: getApiNameById, getApiImage: getApiImageById } = useTokenApi()
  const allTokenIds = TOKENS.map(t => t.id)
  const { stats: tokenStats } = useTokenStats(allTokenIds)

  const refreshBalances = useCallback(() => {
    if (!connected || !publicKey) return
    connection.getBalance(publicKey)
      .then(bal => setSolBalance(bal / LAMPORTS_PER_SOL))
      .catch(() => {})
    const walletAddr = publicKey.toBase58()
    fetch(`/api/balances/owner?owner=${walletAddr}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.balances) {
          const mapped = {}
          Object.values(data.balances).forEach(b => {
            mapped[b.key.toLowerCase()] = {
              balance: b.uiAmount || 0,
              name: b.name || '',
              image: b.image || '',
              symbol: b.symbol || b.key,
            }
          })
          setApiBalances(mapped)
        }
      })
      .catch(() => {})
  }, [connected, publicKey, connection])

  useEffect(() => {
    if (connected && publicKey) {
      connection.getBalance(publicKey)
        .then(bal => setSolBalance(bal / LAMPORTS_PER_SOL))
        .catch(() => setSolBalance(null))
    } else {
      setSolBalance(null)
    }
  }, [connected, publicKey, connection])

  useEffect(() => {
    if (!connected || !publicKey) {
      setApiBalances({})
      return
    }
    const walletAddr = publicKey.toBase58()
    setBalancesLoading(true)
    fetch(`/api/balances/owner?owner=${walletAddr}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.balances) {
          const mapped = {}
          Object.values(data.balances).forEach(b => {
            mapped[b.key.toLowerCase()] = {
              balance: b.uiAmount || 0,
              name: b.name || '',
              image: b.image || '',
              symbol: b.symbol || b.key,
            }
          })
          setApiBalances(mapped)
        }
      })
      .catch(e => console.error('Failed to fetch balances:', e))
      .finally(() => setBalancesLoading(false))
  }, [connected, publicKey])

  useSSERefresh('balances:update', refreshBalances, 2000)

  const getApiName = (token) => {
    return getApiNameById(token.id) || token.fullName
  }

  const getApiImage = (token) => {
    return getApiImageById(token.id) || null
  }

  const renderTokenIcon = (token, faded) => {
    const image = getApiImage(token)
    if (image) {
      return (
        <img
          src={image}
          alt={token.symbol}
          className="coin-icon-img"
          style={{ width: 32, height: 32, borderRadius: '50%', opacity: faded ? 0.4 : 1 }}
        />
      )
    }
    return (
      <div
        className="coin-icon-badge"
        style={{
          background: faded
            ? `linear-gradient(135deg, ${token.color}66, ${token.color}33)`
            : `linear-gradient(135deg, ${token.color}, ${token.color}88)`
        }}
      >
        {token.symbol.slice(0, 2)}
      </div>
    )
  }

  const allTokensWithHoldings = [ntcToken, ...pairTokens].map(token => {
    const apiData = apiBalances[token.id] || {}
    const balance = apiData.balance || 0
    const price = getTokenPrice(token.id) || 0
    const value = balance * price
    return { ...token, balance, value }
  })

  const totalValue = allTokensWithHoldings.reduce((sum, t) => sum + t.value, 0)
  const tokensHeld = allTokensWithHoldings.filter(t => t.balance > 0)
  const tokensEmpty = allTokensWithHoldings.filter(t => t.balance === 0)

  const getTokenPerf = (t, period) => {
    const st = tokenStats[t.id] || {}
    const priceChange = period === 'day' ? (st.change24h || 0)
      : period === 'week' ? (st.change7d || 0)
      : period === 'month' ? (st.change7d || 0) * 4.3
      : 0
    return priceChange
  }
  const dailyChange = tokensHeld.length > 0
    ? tokensHeld.reduce((sum, t) => sum + getTokenPerf(t, 'day') * t.value, 0) / (totalValue || 1)
    : 0
  const weeklyChange = tokensHeld.length > 0
    ? tokensHeld.reduce((sum, t) => sum + getTokenPerf(t, 'week') * t.value, 0) / (totalValue || 1)
    : 0
  const monthlyChange = tokensHeld.length > 0
    ? tokensHeld.reduce((sum, t) => sum + getTokenPerf(t, 'month') * t.value, 0) / (totalValue || 1)
    : 0
  const topPerformer = tokensHeld.length > 0
    ? tokensHeld.reduce((best, t) => {
        const perf = getTokenPerf(t, 'day')
        const bestPerf = getTokenPerf(best, 'day')
        return perf > bestPerf ? t : best
      })
    : null
  const topPerformerChange = topPerformer
    ? getTokenPerf(topPerformer, 'day')
    : 0

  const formatPct = (v) => {
    const abs = Math.abs(v)
    if (abs === 0) return '0.0'
    if (abs >= 1) return abs.toFixed(1)
    if (abs >= 0.01) return abs.toFixed(2)
    if (abs >= 0.001) return abs.toFixed(3)
    return abs.toFixed(4)
  }

  const formatBalance = (b) => {
    if (b >= 1e12) return `${(b / 1e12).toFixed(2)}T`
    if (b >= 1e9) return `${(b / 1e9).toFixed(2)}B`
    if (b >= 1e6) return `${(b / 1e6).toFixed(2)}M`
    if (b >= 1e3) return b.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    if (b >= 1) return b.toFixed(2)
    return b.toFixed(6)
  }

  const formatValue = (v) => {
    if (v >= 1e12) return `${currency.symbol}${(v * currency.rate / 1e12).toFixed(2)}T`
    if (v >= 1e9) return `${currency.symbol}${(v * currency.rate / 1e9).toFixed(2)}B`
    if (v >= 1e6) return `${currency.symbol}${(v * currency.rate / 1e6).toFixed(2)}M`
    return formatPrice(v)
  }

  return (
    <div className="page-container">
      <div className="assets-header-section">
        <div>
          <div className="section-subtitle">Your portfolio overview</div>
          <h2 className="section-title">Digital Currency Holdings</h2>
        </div>
        <div className="assets-total-value">
          <div className="assets-total-label">Estimated Total Value</div>
          <div className="assets-total-amount">{formatValue(totalValue)}</div>
          <div className="assets-total-ntc">{formatBalance(totalValue / ntcPrice)} NTC</div>
        </div>
      </div>

      <div className="assets-stats-grid">
        <div className="assets-stat-card">
          <div className="assets-stat-label">Daily Performance</div>
          <div className={`assets-stat-value ${dailyChange >= 0 ? 'positive' : 'negative'}`}>
            {dailyChange >= 0 ? '▲' : '▼'} {formatPct(dailyChange)}%
          </div>
          <div className="assets-stat-sub">{formatValue(totalValue * Math.abs(dailyChange) / 100)}</div>
        </div>
        <div className="assets-stat-card">
          <div className="assets-stat-label">Weekly Performance</div>
          <div className={`assets-stat-value ${weeklyChange >= 0 ? 'positive' : 'negative'}`}>
            {weeklyChange >= 0 ? '▲' : '▼'} {formatPct(weeklyChange)}%
          </div>
          <div className="assets-stat-sub">{formatValue(totalValue * Math.abs(weeklyChange) / 100)}</div>
        </div>
        <div className="assets-stat-card">
          <div className="assets-stat-label">Monthly Performance</div>
          <div className={`assets-stat-value ${monthlyChange >= 0 ? 'positive' : 'negative'}`}>
            {monthlyChange >= 0 ? '▲' : '▼'} {formatPct(monthlyChange)}%
          </div>
          <div className="assets-stat-sub">{formatValue(totalValue * Math.abs(monthlyChange) / 100)}</div>
        </div>
        <div className="assets-stat-card">
          <div className="assets-stat-label">Top Performer</div>
          {topPerformer ? (
            <>
              <div className="assets-stat-value positive">
                ▲ {formatPct(topPerformerChange)}%
              </div>
              <div className="assets-stat-performer">
                {renderTokenIcon(topPerformer, false)}
                <span>{topPerformer.symbol}</span>
              </div>
            </>
          ) : (
            <div className="assets-stat-value" style={{ opacity: 0.4 }}>—</div>
          )}
        </div>
      </div>

      <div className="assets-table-wrapper">
        <table className="assets-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>{t('assets_balance')}</th>
              <th>Price</th>
              <th>{t('assets_value')}</th>
              <th>NTC Value</th>
              <th>Portfolio %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tokensHeld.map(token => (
              <tr key={token.id}>
                <td>
                  <div className="assets-token-info">
                    {renderTokenIcon(token, false)}
                    <div>
                      <div className="assets-token-name">{getApiName(token)}</div>
                      <div className="assets-token-symbol">{token.symbol}{token.isBase ? ' (Base)' : ''}</div>
                    </div>
                  </div>
                </td>
                <td className="assets-balance">{formatBalance(token.balance)}</td>
                <td>{hasRealPrice(token.id) ? formatPrice(getTokenPrice(token.id)) : '--'}</td>
                <td className="assets-value">{hasRealPrice(token.id) ? formatValue(token.value) : '--'}</td>
                <td className="assets-ntc-value">{hasRealPrice(token.id) ? `${formatBalance(token.value / ntcPrice)} NTC` : '--'}</td>
                <td>
                  <div className="assets-percent-wrapper">
                    <div className="assets-percent-bar">
                      <div
                        className="assets-percent-fill"
                        style={{
                          width: `${totalValue > 0 ? (token.value / totalValue * 100) : 0}%`,
                          background: token.color,
                        }}
                      />
                    </div>
                    <span className="assets-percent-text">
                      {totalValue > 0 ? (token.value / totalValue * 100).toFixed(1) : '0.0'}%
                    </span>
                  </div>
                </td>
                <td>
                  <button
                    className="assets-swap-btn"
                    onClick={() => navigate('/exchange', { state: { swapTokenId: token.id } })}
                  >
                    {t('assets_swap')}
                  </button>
                </td>
              </tr>
            ))}
            {tokensEmpty.map(token => (
              <tr key={token.id} className="assets-empty-row">
                <td>
                  <div className="assets-token-info">
                    {renderTokenIcon(token, true)}
                    <div>
                      <div className="assets-token-name" style={{ opacity: 0.5 }}>{getApiName(token)}</div>
                      <div className="assets-token-symbol">{token.symbol}</div>
                    </div>
                  </div>
                </td>
                <td className="assets-balance" style={{ opacity: 0.4 }}>0.00</td>
                <td style={{ opacity: 0.4 }}>{hasRealPrice(token.id) ? formatPrice(getTokenPrice(token.id)) : '--'}</td>
                <td className="assets-value" style={{ opacity: 0.4 }}>{currency.symbol}0.00</td>
                <td className="assets-ntc-value" style={{ opacity: 0.4 }}>0.00 NTC</td>
                <td style={{ opacity: 0.4 }}>—</td>
                <td>
                  <button
                    className="assets-swap-btn faded"
                    onClick={() => navigate('/exchange', { state: { swapTokenId: token.id } })}
                  >
                    {t('assets_buy')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Assets
