import { useState } from 'react'
import { useTokenList } from '../stores/useTokenListStore'
import { useCurrency } from '../stores/useCurrencyStore'
import { useLanguage } from '../stores/useLanguageStore'
import useTokenApi from '../hooks/useTokenApi'
import { useTokenPrice } from '../stores/useTokenPriceStore'

function TokenBadge({ token, size = 28 }) {
  return (
    <div
      className="token-badge"
      style={{
        width: size,
        height: size,
        minWidth: size,
        background: `linear-gradient(135deg, ${token.color}, ${token.color}88)`,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.35,
        color: '#fff',
        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }}
    >
      {token.fiatSymbol.slice(0, 2)}
    </div>
  )
}

function TokenModal({ onSelect, onClose, excludeToken, includeBase = false }) {
  const [search, setSearch] = useState('')
  const { formatPrice } = useCurrency()
  const { t } = useLanguage()
  const { getApiName, getApiImage } = useTokenApi()
  const { getTokenPrice, hasRealPrice } = useTokenPrice()
  const { tokens: TOKENS } = useTokenList()
  const pairTokens = TOKENS.filter(t => !t.isBase)

  const tokenList = includeBase ? TOKENS : pairTokens
  const filteredTokens = tokenList.filter(token => {
    if (excludeToken && token.id === excludeToken.id) return false
    if (!search) return true
    const q = search.toLowerCase()
    const apiName = getApiName(token.id)
    return (
      token.name.toLowerCase().includes(q) ||
      token.symbol.toLowerCase().includes(q) ||
      token.fullName.toLowerCase().includes(q) ||
      token.fiatSymbol.toLowerCase().includes(q) ||
      token.fiatName.toLowerCase().includes(q) ||
      (apiName && apiName.toLowerCase().includes(q))
    )
  })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="token-modal" onClick={e => e.stopPropagation()}>
        <div className="token-modal-header">
          <h3>{t('token_modal_title')}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="token-search-wrapper">
          <input
            type="text"
            className="token-search"
            placeholder={t('token_modal_search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="popular-tokens">
          {pairTokens.slice(0, 5).map(token => (
            <button
              key={token.id}
              className="popular-token-btn"
              onClick={() => onSelect(token)}
              disabled={excludeToken?.id === token.id}
            >
              {getApiImage(token.id) ? (
                <img src={getApiImage(token.id)} alt={token.symbol} style={{ width: 20, height: 20, borderRadius: '50%' }} />
              ) : (
                <TokenBadge token={token} size={20} />
              )}
              {token.symbol}
            </button>
          ))}
        </div>

        <div className="token-list-divider" />

        <div className="token-list">
          {filteredTokens.length === 0 ? (
            <div className="token-list-empty">No tokens found</div>
          ) : (
            filteredTokens.map(token => (
              <div
                key={token.id}
                className="token-list-item"
                onClick={() => onSelect(token)}
              >
                <div className="token-list-info">
                  {getApiImage(token.id) ? (
                    <img src={getApiImage(token.id)} alt={token.symbol} style={{ width: 36, height: 36, borderRadius: '50%' }} />
                  ) : (
                    <TokenBadge token={token} size={36} />
                  )}
                  <div>
                    <div className="token-list-symbol">
                      {token.symbol}
                    </div>
                    <div className="token-list-name">{token.name}: {getApiName(token.id) || token.fullName}</div>
                  </div>
                </div>
                <div className="token-list-price">
                  <div>{hasRealPrice(token.id) ? formatPrice(getTokenPrice(token.id)) : '--'}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export { TokenBadge }
export default TokenModal
