import { NavLink } from 'react-router-dom'
import { useCurrency } from '../stores/useCurrencyStore'
import { useLanguage } from '../stores/useLanguageStore'
import { useGlobalMarketQuery } from '../hooks/queries/useGlobalMarketQuery'
import WalletButton from './WalletButton'

function TopStatsBar() {
  const { data } = useGlobalMarketQuery()
  const { currencyKey, setCurrencyKey, formatLargeNumber, currencies } = useCurrency()
  const { t, language, setLanguage } = useLanguage()

  const tokenCount = data?.tokenCount ?? null
  const marketCap = data?.marketCap ?? null
  const volume24h = data?.volume24h ?? null
  const marketCapChange24h = data?.marketCapChange24h ?? null

  return (
    <div className="top-stats-bar">
      <div className="stats-left">
        <span className="stat-item">
          <span className="label">{t('stats_cryptos')}</span>
          <span className="value">{tokenCount !== null ? tokenCount.toLocaleString() : '—'}</span>
        </span>
        <span className="stat-item">
          <span className="label">{t('stats_market_cap')}</span>
          <span className="value">{marketCap !== null ? formatLargeNumber(marketCap) : '—'}</span>
          <span className={marketCapChange24h === null ? '' : marketCapChange24h >= 0 ? 'positive' : 'negative'}>
            {marketCapChange24h !== null ? `${marketCapChange24h.toFixed(2)}%` : '—'}
          </span>
        </span>
        <span className="stat-item">
          <span className="label">{t('stats_24h_vol')}</span>
          <span className="value">{volume24h !== null ? formatLargeNumber(volume24h) : '—'}</span>
        </span>
        <span className="stat-item">
          <span className="label">{t('stats_fee')}</span>
          <span className="stat-badge">0.3%</span>
        </span>
      </div>
      <div className="stats-right">
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="en">Eng</option>
          <option value="es">Esp</option>
          <option value="fr">Fra</option>
          <option value="de">Deu</option>
          <option value="zh">中文</option>
          <option value="ja">日本</option>
          <option value="ko">한국</option>
          <option value="pt">Por</option>
          <option value="ar">عرب</option>
        </select>
        <select value={currencyKey} onChange={(e) => setCurrencyKey(e.target.value)}>
          {Object.entries(currencies).map(([key, cur]) => (
            <option key={key} value={key}>{cur.code}</option>
          ))}
        </select>
        <NavLink to="/api" className="nav-btn" style={({ isActive }) => isActive ? { background: 'var(--accent-purple)', color: '#fff' } : {}}>{t('nav_api')}</NavLink>
        <WalletButton />
      </div>
    </div>
  )
}

export default TopStatsBar
