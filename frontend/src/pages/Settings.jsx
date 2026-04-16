import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTheme } from '../stores/useThemeStore'
import { useCurrency } from '../stores/useCurrencyStore'
import { useLanguage } from '../stores/useLanguageStore'
import { useSettings } from '../stores/useSettingsStore'
import { useWallet } from '@solana/wallet-adapter-react'
import { Palette, Globe, ShieldCheck, ArrowLeftRight } from 'lucide-react'
import { useReferralQuery, useInvalidateReferralData } from '../hooks/queries/useReferralQuery'

const LANGUAGE_OPTIONS = [
  { id: 'en', name: 'English', native: 'English', flag: '🇺🇸' },
  { id: 'es', name: 'Spanish', native: 'Español', flag: '🇪🇸' },
  { id: 'fr', name: 'French', native: 'Français', flag: '🇫🇷' },
  { id: 'de', name: 'German', native: 'Deutsch', flag: '🇩🇪' },
  { id: 'zh', name: 'Chinese', native: '中文', flag: '🇨🇳' },
  { id: 'ja', name: 'Japanese', native: '日本語', flag: '🇯🇵' },
  { id: 'ko', name: 'Korean', native: '한국어', flag: '🇰🇷' },
  { id: 'pt', name: 'Portuguese', native: 'Português', flag: '🇧🇷' },
  { id: 'ar', name: 'Arabic', native: 'العربية', flag: '🇸🇦' },
]

const CURRENCY_OPTIONS = [
  { id: 'usd', name: 'US Dollar', symbol: '$', code: 'USD', flag: '🇺🇸' },
  { id: 'eur', name: 'Euro', symbol: '€', code: 'EUR', flag: '🇪🇺' },
  { id: 'gbp', name: 'British Pound', symbol: '£', code: 'GBP', flag: '🇬🇧' },
  { id: 'cad', name: 'Canadian Dollar', symbol: 'CA$', code: 'CAD', flag: '🇨🇦' },
  { id: 'jpy', name: 'Japanese Yen', symbol: '¥', code: 'JPY', flag: '🇯🇵' },
]

const THEME_OPTIONS = [
  { id: 'dark-purple', name: 'Cryptonite Dark', description: 'Default dark theme with purple accents', colors: ['#0a0a0f', '#7b61ff', '#00d18c'] },
  { id: 'light', name: 'Cryptonite Light', description: 'Clean light theme with purple accents', colors: ['#f5f5fa', '#7b61ff', '#00b876'] },
]

function Settings() {
  const { theme: activeTheme, setTheme: setActiveTheme } = useTheme()
  const { currencyKey, setCurrencyKey, currency } = useCurrency()
  const { t, language, setLanguage } = useLanguage()

  const { expertMode, setExpertMode, showConfirmation, setShowConfirmation } = useSettings()
  const [referralCopied, setReferralCopied] = useState(false)
  const { publicKey, connected, signMessage } = useWallet()

  const [applyCodeInput, setApplyCodeInput] = useState('')
  const [applyCodeLoading, setApplyCodeLoading] = useState(false)
  const [applyCodeResult, setApplyCodeResult] = useState(null)
  const [applyCodeError, setApplyCodeError] = useState(null)

  const walletAddr = publicKey?.toBase58() || ''
  const { data: referralData, isLoading: referralLoading } = useReferralQuery(walletAddr, connected && !!walletAddr)
  const invalidateReferralData = useInvalidateReferralData()
  const referralCode = referralData?.code || ''
  const referralStats = referralData?.stats || null
  const referralConfig = referralData?.config || null

  const copyReferral = useCallback(() => {
    if (!referralCode) return
    navigator.clipboard.writeText(referralCode).then(() => {
      setReferralCopied(true)
      setTimeout(() => setReferralCopied(false), 2000)
    })
  }, [referralCode])

  const handleApplyCode = async () => {
    if (!applyCodeInput || !walletAddr || !signMessage) return
    setApplyCodeLoading(true)
    setApplyCodeError(null)
    setApplyCodeResult(null)
    try {
      const code = applyCodeInput.trim().toUpperCase()
      const message = new TextEncoder().encode(`Apply referral code: ${code}`)
      const signatureBytes = await signMessage(message)
      const signatureBase64 = btoa(String.fromCharCode(...signatureBytes))
      const res = await fetch('/api/referral/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, wallet: walletAddr, signature: signatureBase64 }),
      })
      const data = await res.json()
      if (!data.ok) {
        setApplyCodeError(data.error || 'Failed to apply code')
      } else {
        setApplyCodeResult('Referral code applied! Both you and your referrer will earn bonus NTC on your first swap.')
        setApplyCodeInput('')
        invalidateReferralData()
      }
    } catch (e) {
      if (!e?.message?.includes('User rejected')) {
        setApplyCodeError(e.message || 'Failed to apply code')
      }
    } finally {
      setApplyCodeLoading(false)
    }
  }

  const handleLanguageChange = (langId) => {
    setLanguage(langId)
  }

  const handleCurrencyChange = (currId) => {
    setCurrencyKey(currId)
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t('settings_title')}</h1>
        <p>{t('settings_desc')}</p>
      </div>

      <div className="settings-flat-grid">
        <div className="info-card settings-card">
          <h3 className="settings-card-title"><Palette size={18} style={{ marginRight: 6 }} /> {t('settings_theme')}</h3>
          <p className="settings-card-desc">{t('settings_theme_desc')}</p>
          <div className="theme-options">
            {THEME_OPTIONS.map(theme => (
              <div
                key={theme.id}
                className={`theme-option ${activeTheme === theme.id ? 'active' : ''}`}
                onClick={() => setActiveTheme(theme.id)}
              >
                <div className="theme-preview">
                  {theme.colors.map((color, i) => (
                    <div key={i} className="theme-color-dot" style={{ background: color }} />
                  ))}
                </div>
                <div className="theme-info">
                  <span className="theme-name">{theme.name}</span>
                  <span className="theme-desc">{theme.description}</span>
                </div>
                {activeTheme === theme.id && <span className="theme-active-badge">{t('settings_active')}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="info-card settings-card">
          <h3 className="settings-card-title"><Globe size={18} style={{ marginRight: 6 }} /> {t('settings_language')}</h3>
          <p className="settings-card-desc">{t('settings_language_desc')}</p>
          <div className="settings-language-grid">
            {LANGUAGE_OPTIONS.map(lang => (
              <button
                key={lang.id}
                className={`settings-language-btn ${language === lang.id ? 'active' : ''}`}
                onClick={() => handleLanguageChange(lang.id)}
              >
                <span className="settings-language-flag">{lang.flag}</span>
                <div className="settings-language-text">
                  <span className="settings-language-name">{lang.name}</span>
                  <span className="settings-language-native">{lang.native}</span>
                </div>
                {language === lang.id && <span className="settings-active-badge">{t('settings_active_badge')}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="info-card settings-card settings-card-full">
          <div>
            <h3 className="settings-card-title"><ShieldCheck size={18} style={{ marginRight: 6 }} /> {t('settings_advanced')}</h3>
            <p className="settings-card-desc">{t('settings_advanced_desc')}</p>
            <div className="settings-toggle-row">
              <div className="settings-toggle-info">
                <span className="settings-toggle-label">{t('settings_expert')}</span>
                <span className="settings-toggle-desc">{t('settings_expert_desc')}</span>
              </div>
              <button
                className={`settings-toggle ${expertMode ? 'on' : ''}`}
                onClick={() => setExpertMode(!expertMode)}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>
            <div className="settings-toggle-row">
              <div className="settings-toggle-info">
                <span className="settings-toggle-label">{t('settings_tx_confirm')}</span>
                <span className="settings-toggle-desc">{t('settings_tx_confirm_desc')}</span>
              </div>
              <button
                className={`settings-toggle ${showConfirmation ? 'on' : ''}`}
                onClick={() => setShowConfirmation(!showConfirmation)}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>
          </div>
          <div className="settings-referral-section">
            <h3 className="settings-card-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 6 }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Referral Program</h3>
            <p className="settings-card-desc">
              Share your referral code — when a friend applies it and completes their first swap,
              you earn {referralConfig?.referrerReward ?? 0.25} NTC and they earn {referralConfig?.refereeReward ?? 0.5} NTC!
            </p>

            {!connected ? (
              <div className="settings-referral-box">
                <div style={{ opacity: 0.5, fontSize: 13, padding: '16px 0', textAlign: 'center' }}>
                  Connect your wallet to access your referral code
                </div>
              </div>
            ) : referralLoading ? (
              <div className="settings-referral-box">
                <div style={{ opacity: 0.5, fontSize: 13, padding: '16px 0', textAlign: 'center' }}>
                  Loading referral data...
                </div>
              </div>
            ) : (
              <div className="settings-referral-box">
                <div className="settings-referral-code">
                  <span className="settings-referral-label">Your Referral Code</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="settings-referral-value">{referralCode || '...'}</span>
                    <button className="settings-referral-copy" onClick={copyReferral}>
                      {referralCopied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                {referralStats && (
                  <div className="settings-referral-stats">
                    <div className="settings-referral-stat">
                      <span className="settings-referral-stat-value">{referralStats.totalReferrals}</span>
                      <span className="settings-referral-stat-label">Referrals</span>
                    </div>
                    <div className="settings-referral-stat">
                      <span className="settings-referral-stat-value">{referralStats.completedSwaps}</span>
                      <span className="settings-referral-stat-label">Swaps Done</span>
                    </div>
                    <div className="settings-referral-stat">
                      <span className="settings-referral-stat-value">{referralStats.totalRewardsEarned.toFixed(2)}</span>
                      <span className="settings-referral-stat-label">NTC Earned</span>
                    </div>
                  </div>
                )}

                {referralStats?.usedCode ? (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, fontSize: 12 }}>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>Referred by code: {referralStats.usedCode.code}</span>
                    {referralStats.usedCode.firstSwapDone ? (
                      <span style={{ marginLeft: 10, opacity: 0.7 }}>
                        {referralStats.usedCode.rewarded ? '✓ Reward claimed' : 'Reward pending'}
                      </span>
                    ) : (
                      <span style={{ marginLeft: 10, opacity: 0.7 }}>Complete your first swap to earn {referralStats.usedCode.rewardAmount} NTC</span>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, opacity: 0.8 }}>Have a referral code?</div>
                    {applyCodeError && (
                      <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#ef4444', padding: '8px 12px', borderRadius: 8, marginBottom: 8, fontSize: 12 }}>
                        {applyCodeError}
                      </div>
                    )}
                    {applyCodeResult && (
                      <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#22c55e', padding: '8px 12px', borderRadius: 8, marginBottom: 8, fontSize: 12 }}>
                        {applyCodeResult}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        className="settings-referral-input"
                        placeholder="Enter referral code"
                        value={applyCodeInput}
                        onChange={e => setApplyCodeInput(e.target.value.toUpperCase())}
                        style={{ flex: 1 }}
                        maxLength={16}
                      />
                      <button
                        className="settings-referral-copy"
                        onClick={handleApplyCode}
                        disabled={!applyCodeInput || applyCodeLoading}
                        style={{ minWidth: 80 }}
                      >
                        {applyCodeLoading ? '...' : 'Apply'}
                      </button>
                    </div>
                  </div>
                )}

                {referralStats?.referrals?.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.8 }}>Your Referrals</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {referralStats.referrals.slice(0, 10).map((r, i) => (
                        <div key={i} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '8px 12px', background: 'rgba(168,85,247,0.05)', borderRadius: 8, fontSize: 12,
                        }}>
                          <span style={{ fontFamily: 'monospace' }}>{r.refereeWallet.slice(0, 6)}...{r.refereeWallet.slice(-4)}</span>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <span style={{ color: r.firstSwapDone ? '#22c55e' : '#eab308' }}>
                              {r.firstSwapDone ? '✓ Swapped' : 'Pending swap'}
                            </span>
                            <span style={{ opacity: 0.5 }}>{r.referrerReward} NTC</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="info-card settings-card settings-card-full">
          <h3 className="settings-card-title"><ArrowLeftRight size={18} style={{ marginRight: 6 }} /> {t('settings_currency')}</h3>
          <p className="settings-card-desc">{t('settings_currency_desc')}</p>
          <div className="settings-currency-grid">
            {CURRENCY_OPTIONS.map(cur => (
              <button
                key={cur.id}
                className={`settings-currency-btn ${currencyKey === cur.id ? 'active' : ''}`}
                onClick={() => handleCurrencyChange(cur.id)}
              >
                <span className="settings-currency-flag">{cur.flag}</span>
                <span className="settings-currency-symbol">{cur.symbol}</span>
                <div className="settings-currency-text">
                  <span className="settings-currency-code">{cur.code}</span>
                  <span className="settings-currency-name">{cur.name}</span>
                </div>
                {currencyKey === cur.id && <span className="settings-active-badge">{t('settings_active_badge')}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Settings
