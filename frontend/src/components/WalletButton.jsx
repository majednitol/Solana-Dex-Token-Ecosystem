import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { useLanguage } from '../stores/useLanguageStore'

function WalletSelectModal({ onClose, wallets, onSelect, t }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="wallet-select-modal" onClick={e => e.stopPropagation()}>
        <div className="wallet-select-header">
          <h3>{t('wallet_connect')}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="wallet-select-list">
          {wallets.map(w => (
            <button
              key={w.adapter.name}
              className="wallet-select-item"
              onClick={() => onSelect(w)}
            >
              <img src={w.adapter.icon} alt={w.adapter.name} className="wallet-select-icon" />
              <span className="wallet-select-name">{w.adapter.name}</span>
              {w.readyState === 'Installed' && (
                <span className="wallet-select-detected">{t('wallet_detected')}</span>
              )}
            </button>
          ))}
          {wallets.length === 0 && (
            <div className="wallet-select-empty">
              <p>{t('wallet_none_found')}</p>
              <p>{t('wallet_install_prompt')} <a href="https://phantom.app" target="_blank" rel="noopener noreferrer">Phantom</a> or <a href="https://solflare.com" target="_blank" rel="noopener noreferrer">Solflare</a></p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function WalletButton() {
  const { connected, publicKey, disconnect, wallet, wallets, select, connect } = useWallet()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const dropdownRef = useRef(null)
  const { t } = useLanguage()

  const solanaWallets = wallets.filter(w =>
    w.adapter.name === 'Phantom' || w.adapter.name === 'Solflare'
  )

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const shortenAddress = (addr) => {
    if (!addr) return ''
    const str = addr.toBase58()
    return str.slice(0, 4) + '...' + str.slice(-4)
  }

  const handleCopyAddress = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey.toBase58())
      setDropdownOpen(false)
    }
  }

  const handleDisconnect = () => {
    disconnect()
    setDropdownOpen(false)
  }

  const handleSelectWallet = async (w) => {
    try {
      select(w.adapter.name)
      setShowModal(false)
      await w.adapter.connect()
    } catch (err) {
      console.error('Wallet connection error:', err)
    }
  }

  if (!connected) {
    return (
      <>
        <button className="wallet-connect-btn" onClick={() => setShowModal(true)}>
          {t('wallet_connect')}
        </button>
        {showModal && (
          <WalletSelectModal
            onClose={() => setShowModal(false)}
            wallets={solanaWallets}
            onSelect={handleSelectWallet}
            t={t}
          />
        )}
      </>
    )
  }

  return (
    <div className="wallet-connected-wrapper" ref={dropdownRef}>
      <button
        className="wallet-connected-btn"
        onClick={() => setDropdownOpen(!dropdownOpen)}
      >
        {wallet?.adapter?.icon && (
          <img src={wallet.adapter.icon} alt="" className="wallet-icon" />
        )}
        <span>{shortenAddress(publicKey)}</span>
        <span className="wallet-chevron">▾</span>
      </button>

      {dropdownOpen && (
        <div className="wallet-dropdown">
          <div className="wallet-dropdown-header">
            <span className="wallet-dropdown-label">{t('wallet_connected_with')} {wallet?.adapter?.name}</span>
            <span className="wallet-dropdown-address">{publicKey?.toBase58()}</span>
          </div>
          <div className="wallet-dropdown-divider" />
          <button className="wallet-dropdown-item" onClick={handleCopyAddress}>
            <span className="wallet-dropdown-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span>
            {t('wallet_copy_address')}
          </button>
          <button className="wallet-dropdown-item" onClick={() => { setDropdownOpen(false); setShowModal(true) }}>
            <span className="wallet-dropdown-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></span>
            {t('wallet_change')}
          </button>
          <button className="wallet-dropdown-item wallet-disconnect" onClick={handleDisconnect}>
            <span className="wallet-dropdown-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></span>
            {t('wallet_disconnect')}
          </button>
        </div>
      )}

      {showModal && (
        <WalletSelectModal
          onClose={() => setShowModal(false)}
          wallets={solanaWallets}
          onSelect={handleSelectWallet}
          t={t}
        />
      )}
    </div>
  )
}

export default WalletButton
