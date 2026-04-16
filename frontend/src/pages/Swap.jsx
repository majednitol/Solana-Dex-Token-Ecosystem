
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useLocation } from 'react-router-dom'
import { LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js'
import TokenModal from '../components/TokenModal'
import { TokenBadge } from '../components/TokenModal'
import { useTokenList } from '../stores/useTokenListStore'
import { useCurrency } from '../stores/useCurrencyStore'
import { useWatchlist } from '../stores/useWatchlistStore'
import { useLanguage } from '../stores/useLanguageStore'
import { useTokenPrice } from '../stores/useTokenPriceStore'
import useTokenApi from '../hooks/useTokenApi'
import useMoonPay from '../hooks/useMoonPay'
import useCryptoWallet, { getCurrencyType } from '../hooks/useCryptoWallet'
import { getMint, initMints, toRawAmount, fromRawAmount } from '../data/mints'
import { decodeSolanaError } from '../utils/decodeSolanaError'
import { explorerTxUrl } from '../utils/solanaExplorer'
import { useCandles, useTradeStream, useRecentTrades } from '../hooks/useChartData'
import { useSSERefresh } from '../hooks/useSSEEvent'
import { useAdminPoolsQuery } from '../hooks/queries/useAdminPoolsQuery'
import { useSwapLimitsQuery, useInvalidateSwapLimits } from '../hooks/queries/useSwapLimitsQuery'
import { usePoolReservesQuery } from '../hooks/queries/usePoolReservesQuery'
import { useSwapQuoteQuery } from '../hooks/queries/useSwapQuoteQuery'
import { useReferralStatsQuery, useInvalidateReferralData } from '../hooks/queries/useReferralQuery'
import { useSettings } from '../stores/useSettingsStore'
import { Droplets, Settings as SettingsIcon, Coins, Star, Search, ArrowDown } from 'lucide-react'

function getInitialTokens(state, TOKENS) {
  const ntcToken = TOKENS.find(t => t.isBase)
  if (state?.swapTokenId) {
    const token = TOKENS.find(t => t.id === state.swapTokenId)
    if (token) {
      if (token.isBase) {
        return { sell: ntcToken, buy: null }
      }
      return { sell: token, buy: ntcToken }
    }
  }
  return { sell: ntcToken, buy: null }
}

function Swap() {
  const location = useLocation()
  const { connected, publicKey, signTransaction, sendTransaction, signMessage } = useWallet()
  const { connection } = useConnection()
  const { formatPrice: fmtPrice, currency, currencyKey, setCurrencyKey, currencies } = useCurrency()
  const { toggleToken, isSaved } = useWatchlist()
  const { t } = useLanguage()
  const { getTokenPrice, hasRealPrice } = useTokenPrice()
  const { getApiName, getApiImage } = useTokenApi()
  const { openSellWidget: openMoonPaySellWidget, loading: moonpayLoading, hasApiKey: hasMoonPayKey, error: moonpayError, onchainStep } = useMoonPay()
  const cryptoWallet = useCryptoWallet()
  const { tokens: TOKENS } = useTokenList()
  const tToken = (key, fallback) => { const v = t(key); return v !== key ? v : fallback; }
  const ntcToken = TOKENS.find(t => t.isBase)
  const [solBalance, setSolBalance] = useState(null)
  const queryToken = new URLSearchParams(location.search).get('token')
  const stateForInit = location.state || (queryToken ? { swapTokenId: TOKENS.find(t => t.symbol?.toLowerCase() === queryToken.toLowerCase())?.id } : null)
  const initial = getInitialTokens(stateForInit, TOKENS)
  const [sellToken, setSellToken] = useState(initial.sell)
  const [buyToken, setBuyToken] = useState(initial.buy)
  const [sellAmount, setSellAmount] = useState('')
  const [buyAmount, setBuyAmount] = useState('')
  const [slippage, setSlippage] = useState('0.5')
  const [showSlippage, setShowSlippage] = useState(false)
  const [modalOpen, setModalOpen] = useState(null)
  const [activeTab, setActiveTab] = useState('Swap')
  const [txSearch, setTxSearch] = useState('')
  const [txTab, setTxTab] = useState('all')
  const [exchChartType, setExchChartType] = useState('candle')
  const [exchTimeframe, setExchTimeframe] = useState('1D')
  const [exchDataMode, setExchDataMode] = useState('price')
  const [hoveredCandle, setHoveredCandle] = useState(null)
  const [aboutExpanded, setAboutExpanded] = useState(false)

  const tradeRef = useRef(null)
  const [referralCode, setReferralCode] = useState('')
  const [referralStatus, setReferralStatus] = useState(null)
  const [referralLoading, setReferralLoading] = useState(false)

  const walletAddress = connected && publicKey ? publicKey.toBase58() : null
  const { data: referralStatsData } = useReferralStatsQuery(walletAddress, connected && !!publicKey)
  const referralApplied = !!(referralStatsData?.usedCode)
  const invalidateReferralData = useInvalidateReferralData()

  const applyReferralCode = async () => {
    if (!referralCode.trim() || !publicKey || !signMessage) return
    setReferralLoading(true)
    setReferralStatus(null)
    try {
      const code = referralCode.trim().toUpperCase()
      const message = new TextEncoder().encode(`Apply referral code: ${code}`)
      const signatureBytes = await signMessage(message)
      const signatureBase64 = btoa(String.fromCharCode(...signatureBytes))
      const res = await fetch('/api/referral/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, wallet: publicKey.toBase58(), signature: signatureBase64 }),
      })
      const data = await res.json()
      if (data.ok) {
        setReferralStatus({ type: 'success', message: 'Referral code applied! Bonus NTC on your first swap.' })
        invalidateReferralData()
        setReferralCode('')
      } else {
        setReferralStatus({ type: 'error', message: data.error || 'Failed to apply code' })
      }
    } catch (err) {
      if (!err?.message?.includes('User rejected')) {
        setReferralStatus({ type: 'error', message: 'Failed to sign or apply code' })
      }
    } finally {
      setReferralLoading(false)
    }
  }

  const displayTokenForChart = sellToken || ntcToken
  const pairTokenForChart = sellToken && buyToken
    ? (sellToken.id === displayTokenForChart?.id ? buyToken?.id : sellToken?.id)
    : undefined
  const txWalletFilter = txTab === 'mine' && walletAddress ? walletAddress : undefined
  const { trades: realTrades } = useRecentTrades(displayTokenForChart?.id, 20, pairTokenForChart, txWalletFilter)
  const { candles: realCandles, hasData: hasChartData, refetch: refetchCandles } = useCandles(
    displayTokenForChart?.id, exchTimeframe, pairTokenForChart
  )

  useTradeStream((trade) => {
    if (trade.tokenB?.toLowerCase() === displayTokenForChart?.symbol?.toLowerCase() ||
        trade.tokenA?.toLowerCase() === displayTokenForChart?.symbol?.toLowerCase()) {
      refetchCandles()
    }
  })

  useEffect(() => { setHoveredCandle(null) }, [sellToken, buyToken, exchChartType, exchTimeframe, exchDataMode])

  const [buyTabToken, setBuyTabToken] = useState(ntcToken)
  const [buyTabAmount, setBuyTabAmount] = useState('')
  const [buyTabModalOpen, setBuyTabModalOpen] = useState(false)
  const [sellTabToken, setSellTabToken] = useState(ntcToken)
  const [sellTabAmount, setSellTabAmount] = useState('')
  const [sellTabModalOpen, setSellTabModalOpen] = useState(false)
  const [buyTabPayment, setBuyTabPayment] = useState('nowpay')
  const [cryptoCurrencies, setCryptoCurrencies] = useState([])
  const [selectedCryptoCurrency, setSelectedCryptoCurrency] = useState(typeof window !== 'undefined' && window.ethereum ? 'eth' : 'btc')
  const [cryptoEstimate, setCryptoEstimate] = useState(null)
  const [buyEstimateLoading, setBuyEstimateLoading] = useState(false)
  const [cryptoPayment, setCryptoPayment] = useState(null)
  const [cryptoLoading, setCryptoLoading] = useState(false)
  const [cryptoError, setCryptoError] = useState('')
  const [cryptoStep, setCryptoStep] = useState('form')
  const [paymentStatus, setPaymentStatus] = useState(null)
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false)
  const [currencySearch, setCurrencySearch] = useState('')
  const cryptoPollRef = useRef(null)
  const [quoteData, setQuoteData] = useState(null)
  const [debouncedQuoteParams, setDebouncedQuoteParams] = useState(null)
  const quoteTimerRef = useRef(null)
  const [swapLoading, setSwapLoading] = useState(false)
  const [swapResult, setSwapResult] = useState(null)
  const [swapError, setSwapError] = useState(null)
  const [showSwapConfirm, setShowSwapConfirm] = useState(false)
  const { expertMode, showConfirmation } = useSettings()


  useEffect(() => {
    fetch('/api/buy/currencies')
      .then(r => r.json())
      .then(d => { if (d.ok && d.currencies) setCryptoCurrencies(d.currencies) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (buyTabPayment === 'nowpay' && buyTabAmount && parseFloat(buyTabAmount) > 0) {
      setBuyEstimateLoading(true)
      setCryptoEstimate(null)
      const controller = new AbortController()
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(
            `/api/buy/estimate?dollarAmount=${parseFloat(buyTabAmount).toFixed(2)}&payCurrency=${selectedCryptoCurrency}&tokenSymbol=${buyTabToken?.symbol || 'NTC'}`,
            { signal: controller.signal }
          )
          const d = await res.json()
          if (d.ok) setCryptoEstimate(d)
          else setCryptoEstimate(null)
          setBuyEstimateLoading(false)
        } catch (e) {
          if (e.name !== 'AbortError') {
            setCryptoEstimate(null)
            setBuyEstimateLoading(false)
          }
        }
      }, 500)
      return () => { clearTimeout(timer); controller.abort() }
    } else {
      setCryptoEstimate(null)
      setBuyEstimateLoading(false)
    }
  }, [buyTabAmount, selectedCryptoCurrency, buyTabPayment, buyTabToken])

  useEffect(() => {
    return () => { if (cryptoPollRef.current) clearInterval(cryptoPollRef.current) }
  }, [])

  const pollCryptoStatus = useCallback((purchaseId) => {
    if (cryptoPollRef.current) clearInterval(cryptoPollRef.current)
    cryptoPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/buy/payment-status/${purchaseId}`)
        const d = await res.json()
        if (d.ok && d.purchase) {
          setPaymentStatus(d.purchase)
          const st = d.purchase.status
          const hasTxSig = !!d.purchase.ntc_tx_signature
          if ((st === 'completed' && hasTxSig) || st === 'failed' || st === 'send_failed') {
            clearInterval(cryptoPollRef.current)
            cryptoPollRef.current = null
          }
        }
      } catch {}
    }, 5000)
  }, [])

  const handleCryptoPayment = async () => {
    if (!connected || !publicKey || !buyTabAmount || parseFloat(buyTabAmount) <= 0) return
    setCryptoLoading(true)
    setCryptoError('')
    try {
      const res = await fetch('/api/buy/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          dollarAmount: parseFloat(parseFloat(buyTabAmount).toFixed(2)),
          payCurrency: selectedCryptoCurrency,
          tokenSymbol: buyTabToken?.symbol || 'NTC',
        }),
      })
      const d = await res.json()
      if (d.ok) {
        setCryptoPayment(d)
        setCryptoEstimate(prev => ({ ...(prev || {}), ntcAmount: d.ntcAmount }))
        setCryptoStep('paying')
        pollCryptoStatus(d.purchaseId)
      } else {
        setCryptoError(d.error || 'Failed to create payment')
      }
    } catch {
      setCryptoError('Failed to create payment')
    }
    setCryptoLoading(false)
  }

  const handleCryptoReset = () => {
    setCryptoStep('form')
    setCryptoPayment(null)
    setPaymentStatus(null)
    setCryptoEstimate(null)
    setCryptoError('')
    setShowCurrencyPicker(false)
    setCurrencySearch('')
    cryptoWallet.resetState()
    if (cryptoPollRef.current) { clearInterval(cryptoPollRef.current); cryptoPollRef.current = null }
  }

  const filteredCryptoCurrencies = useMemo(() => {
    if (!currencySearch) return cryptoCurrencies
    const s = currencySearch.toLowerCase()
    return cryptoCurrencies.filter(c => c.toLowerCase().includes(s))
  }, [cryptoCurrencies, currencySearch])

  const { data: adminPoolsData } = useAdminPoolsQuery()

  const nonNtc = useMemo(() => {
    if (sellToken && sellToken.id !== 'ntc') return sellToken
    if (buyToken && buyToken.id !== 'ntc') return buyToken
    return null
  }, [sellToken, buyToken])

  const resolvedPairSymbol = useMemo(() => {
    if (nonNtc?.symbol) return nonNtc.symbol
    const dbPools = Array.isArray(adminPoolsData) ? adminPoolsData : []
    if (dbPools.length > 0) {
      const first = dbPools.find(p => p.pool_address) || dbPools[0]
      return first.token_b_symbol || ''
    }
    return ''
  }, [nonNtc, adminPoolsData])

  const poolPairTokenId = useMemo(() => {
    if (nonNtc?.id) return nonNtc.id
    if (resolvedPairSymbol) {
      const matched = TOKENS.find(t => t.symbol === resolvedPairSymbol)
      return matched?.id || null
    }
    return null
  }, [nonNtc, resolvedPairSymbol, TOKENS])

  const { data: poolReservesData, isLoading: poolLoading } = usePoolReservesQuery(
    ntcToken?.symbol, resolvedPairSymbol, !!ntcToken && !!resolvedPairSymbol
  )
  const poolReserves = poolReservesData?.reserves || null
  const poolPairSymbol = poolReservesData?.pairSymbol || resolvedPairSymbol || ''

  const { data: swapLimits } = useSwapLimitsQuery(connected && publicKey ? publicKey.toBase58() : null, connected && !!publicKey)
  const invalidateSwapLimits = useInvalidateSwapLimits()

  const sellIsNtc = sellToken?.id === 'ntc'
  const buyIsNtc = buyToken?.id === 'ntc'

  const quoteEnabled = !!(debouncedQuoteParams?.mintIn && debouncedQuoteParams?.mintOut && debouncedQuoteParams?.rawAmount)
  const { data: swapQuoteData, isFetching: quoteLoading } = useSwapQuoteQuery(
    debouncedQuoteParams?.mintIn,
    debouncedQuoteParams?.mintOut,
    debouncedQuoteParams?.rawAmount,
    walletAddress,
    quoteEnabled
  )

  useEffect(() => {
    if (swapQuoteData) {
      const outAmount = fromRawAmount(swapQuoteData.quote.tokenMinOutNet)
      setBuyAmount(outAmount.toFixed(5))
      setQuoteData(swapQuoteData)
    } else if (quoteEnabled && !quoteLoading) {
      setBuyAmount('')
      setQuoteData(null)
    }
  }, [swapQuoteData, quoteEnabled, quoteLoading])

  const triggerQuote = useCallback(async (fromToken, toToken, amount) => {
    if (!fromToken || !toToken || !amount || parseFloat(amount) <= 0) {
      setDebouncedQuoteParams(null)
      setBuyAmount('')
      setQuoteData(null)
      return
    }
    await initMints()
    const mintIn = getMint(fromToken.id)
    const mintOut = getMint(toToken.id)
    if (!mintIn || !mintOut) {
      setDebouncedQuoteParams(null)
      setBuyAmount('')
      setQuoteData(null)
      return
    }
    const rawAmount = toRawAmount(amount)
    setDebouncedQuoteParams({ mintIn, mintOut, rawAmount })
  }, [])

  useEffect(() => {
    if (location.state?.swapTokenId) {
      const token = TOKENS.find(t => t.id === location.state.swapTokenId)
      if (token) {
        if (token.isBase) {
          setSellToken(ntcToken)
          setBuyToken(null)
        } else {
          setSellToken(token)
          setBuyToken(ntcToken)
        }
        setSellAmount('')
        setBuyAmount('')
        setQuoteData(null)
      }
    }
  }, [location.state])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [sellToken?.id])

  const scrollToTrade = () => {
    tradeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const refreshSolBalance = useCallback(() => {
    if (connected && publicKey) {
      connection.getBalance(publicKey)
        .then(bal => setSolBalance(bal / LAMPORTS_PER_SOL))
        .catch(() => {})
    }
  }, [connected, publicKey, connection])

  useEffect(() => {
    if (connected && publicKey) {
      connection.getBalance(publicKey)
        .then(bal => setSolBalance(bal / LAMPORTS_PER_SOL))
        .catch(() => setSolBalance(null))
    } else {
      setSolBalance(null)
      setTxTab('all')
    }
  }, [connected, publicKey, connection])

  useSSERefresh('balances:update', refreshSolBalance, 2000)

  const handleSellAmountChange = (val) => {
    setSellAmount(val)
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current)
    if (!val || parseFloat(val) <= 0) {
      setBuyAmount('')
      setQuoteData(null)
      return
    }
    quoteTimerRef.current = setTimeout(() => {
      triggerQuote(sellToken, buyToken, val)
    }, 400)
  }

  const handleBuyAmountChange = (val) => {
    setBuyAmount(val)
    setQuoteData(null)
  }

  const handleSwapTokens = () => {
    if (!buyToken) return
    const tempToken = sellToken
    const tempAmount = sellAmount
    setSellToken(buyToken)
    setBuyToken(tempToken)
    setSellAmount(buyAmount)
    setBuyAmount('')
    setQuoteData(null)
    if (buyAmount && parseFloat(buyAmount) > 0) {
      triggerQuote(buyToken, tempToken, buyAmount)
    }
  }

  const handleSwap = async () => {
    if (!connected || !publicKey || !sellToken || !buyToken || !sellAmount) return
    await initMints()
    const mintIn = getMint(sellToken.id)
    const mintOut = getMint(buyToken.id)
    if (!mintIn || !mintOut) return

    setSwapLoading(true)
    setSwapError(null)
    setSwapResult(null)

    try {
      const rawAmount = toRawAmount(sellAmount)
      const res = await fetch('/api/swap/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mintIn,
          mintOut,
          amountIn: rawAmount,
          slippageBps: Math.round(parseFloat(slippage) * 100),
          userPubkey: publicKey.toBase58(),
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to build transaction')

      const txBytes = Uint8Array.from(atob(data.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)

      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))

      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: signedBase64,
          blockhash: data.blockhash,
          lastValidBlockHeight: data.lastValidBlockHeight,
          updateChannels: ['prices:update', 'balances:update', 'pools:update'],
          updateDetail: 'swap',
          tradeMeta: {
            eventType: 'swap',
            tokenA: sellToken?.symbol || '',
            tokenB: buyToken?.symbol || '',
            tokenAMint: mintIn,
            tokenBMint: mintOut,
            amountIn: parseFloat(sellAmount) || 0,
            amountOut: parseFloat(buyAmount) || fromRawAmount(data.summary?.quote?.tokenEstOutNet || 0),
            price: (() => {
              const sA = parseFloat(sellAmount)
              const bA = parseFloat(buyAmount) || fromRawAmount(data.summary?.quote?.tokenEstOutNet || 0)
              if (sA > 0 && bA > 0) return bA / sA
              return getTokenPrice(buyToken.id) || 0
            })(),
            poolAddress: data.summary?.pool || '',
            wallet: publicKey.toBase58(),
          },
        }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')
      const signature = sendData.signature

      setSwapResult({
        signature,
        summary: data.summary,
        referralBonus: sendData.referralBonus || null,
      })

      if (sendData.referralBonus && sendData.referralBonus.refereePaid) {
        invalidateReferralData()
      }

      setSellAmount('')
      setBuyAmount('')
      setQuoteData(null)

      invalidateSwapLimits()

      if (publicKey) {
        connection.getBalance(publicKey)
          .then(bal => setSolBalance(bal / LAMPORTS_PER_SOL))
          .catch(() => {})
      }
    } catch (err) {
      const friendly = decodeSolanaError(err)
      if (friendly) {
        setSwapError(friendly)
      }
    } finally {
      setSwapLoading(false)
    }
  }

  const handleSwapClick = () => {
    if (!connected || !publicKey || !sellToken || !buyToken || !sellAmount) return
    if (expertMode || !showConfirmation) {
      handleSwap()
    } else {
      setShowSwapConfirm(true)
    }
  }

  const confirmSwap = () => {
    setShowSwapConfirm(false)
    handleSwap()
  }

  const handleSelectToken = (token) => {
    let newSell = sellToken
    let newBuy = buyToken
    if (modalOpen === 'sell') {
      newSell = token
      newBuy = ntcToken
      setSellToken(token)
      setBuyToken(ntcToken)
    } else {
      newBuy = token
      if (!sellIsNtc) {
        newSell = ntcToken
        setSellToken(ntcToken)
      }
      setBuyToken(token)
    }
    setModalOpen(null)
    setBuyAmount('')
    setQuoteData(null)
    if (sellAmount && parseFloat(sellAmount) > 0) {
      triggerQuote(newSell, newBuy, sellAmount)
    }
  }

  const handleOpenModal = (side) => {
    if (side === 'sell' && sellIsNtc) {
      setModalOpen('sell')
    } else if (side === 'sell' && !sellIsNtc) {
      setModalOpen('sell')
    } else if (side === 'buy' && buyIsNtc) {
      return
    } else {
      setModalOpen('buy')
    }
  }

  const sellPriceVal = getTokenPrice(sellToken?.id)
  const buyPriceVal = getTokenPrice(buyToken?.id)
  const sellUsdRaw = sellAmount && sellPriceVal ? parseFloat(sellAmount) * sellPriceVal : 0
  const buyUsdRaw = buyAmount && buyPriceVal ? parseFloat(buyAmount) * buyPriceVal : 0
  const sellDisplayValue = sellUsdRaw ? fmtPrice(sellUsdRaw) : `${currency.symbol}0.00`
  const buyDisplayValue = buyUsdRaw ? fmtPrice(buyUsdRaw) : `${currency.symbol}0.00`
  const rate = sellAmount && buyAmount && parseFloat(sellAmount) > 0
    ? (parseFloat(buyAmount) / parseFloat(sellAmount)).toFixed(5)
    : (sellPriceVal && buyPriceVal ? (sellPriceVal / buyPriceVal).toFixed(6) : null)
  const priceImpact = quoteData?.quote?.tradeFeeRateMin
    ? (quoteData.quote.tradeFeeRateMin / 10000).toFixed(2)
    : (sellAmount ? (parseFloat(sellAmount) > 100 ? '0.15' : '< 0.01') : '-')
  const quoteFee = quoteData?.quote?.raw?.tradeFee
    ? fromRawAmount(quoteData.quote.raw.tradeFee)
    : null
  const swapFeePct = quoteData?.poolFeeBps ? (quoteData.poolFeeBps / 100) : 0.3
  const transferFeePct = quoteData?.feeBps ? (quoteData.feeBps / 100) : 0.05

  const displayToken = sellToken || ntcToken
  const prevDisplayTokenId = useRef(displayToken?.id)
  if (displayToken?.id !== prevDisplayTokenId.current) {
    prevDisplayTokenId.current = displayToken?.id
    setAboutExpanded(false)
  }
  const chartPrice = displayToken && hasRealPrice(displayToken.id) ? fmtPrice(getTokenPrice(displayToken.id)) : '--'

  const formattedTrades = useMemo(() => {
    if (!realTrades || realTrades.length === 0) return []
    return realTrades.map((trade, idx) => {
      const elapsed = Date.now() - trade.createdAt
      let timeStr
      if (elapsed < 60000) timeStr = 'Just now'
      else if (elapsed < 3600000) timeStr = `${Math.floor(elapsed / 60000)} min ago`
      else if (elapsed < 86400000) timeStr = `${Math.floor(elapsed / 3600000)}h ago`
      else timeStr = `${Math.floor(elapsed / 86400000)}d ago`
      return {
        id: idx + 1,
        type: trade.eventType === 'swap' ? 'Swap' : trade.eventType,
        from: trade.tokenA,
        to: trade.tokenB,
        amountFrom: parseFloat(trade.amountIn).toLocaleString(undefined, { maximumFractionDigits: 5 }),
        amountTo: parseFloat(trade.amountOut).toLocaleString(undefined, { maximumFractionDigits: 5 }),
        price: trade.price > 0 ? `$${parseFloat(trade.price).toFixed(4)}` : '--',
        time: timeStr,
        status: 'Completed',
      }
    })
  }, [realTrades])

  const filteredTx = txSearch
    ? formattedTrades.filter(tx =>
        tx.from.toLowerCase().includes(txSearch.toLowerCase()) ||
        tx.to.toLowerCase().includes(txSearch.toLowerCase())
      )
    : formattedTrades

  if (!displayToken) return <div className="page-container exch-page"><div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>Loading tokens...</div></div>

  return (
    <div className="page-container exch-page">
      <div className="exch-breadcrumb">
        {t('exch_breadcrumb')} / {tToken(`token_${displayToken.id}_fullname`, getApiName(displayToken.id) || displayToken.fullName)} ({displayToken.symbol})
      </div>
      <div className="exch-header">
        <div className="exch-token-title">
          {getApiImage(displayToken.id) ? (
            <img src={getApiImage(displayToken.id)} alt={displayToken.symbol} style={{ width: 40, height: 40, borderRadius: '50%' }} />
          ) : (
            <TokenBadge token={displayToken} size={40} />
          )}
          <h1>{tToken(`token_${displayToken.id}_fullname`, getApiName(displayToken.id) || displayToken.fullName)} ({displayToken.symbol})</h1>
        </div>
        <div className="exch-header-actions">
          <button
            className={`exch-action-btn ${isSaved(displayToken.id) ? 'exch-action-btn-active' : ''}`}
            onClick={() => toggleToken(displayToken.id)}
          >
            <Star size={14} fill={isSaved(displayToken.id) ? 'currentColor' : 'none'} /> {isSaved(displayToken.id) ? t('exch_saved') : t('exch_watchlist')}
          </button>
        </div>
      </div>

      <div className="exch-layout" ref={tradeRef}>
        <div className="exch-left">
          <div className="exch-chart-card">
            <div className="exch-chart-header">
              <div className="exch-chart-header-left">
                <div className="exch-chart-price">
                  {hoveredCandle ? fmtPrice(hoveredCandle.price) : chartPrice}
                </div>
                <div className="exch-chart-change">
                  {hoveredCandle ? (
                    <>
                      <span className={`exch-change-badge ${hoveredCandle.price >= getTokenPrice(displayToken.id) ? 'positive' : 'negative'}`}>
                        {hoveredCandle.price >= getTokenPrice(displayToken.id) ? '▲' : '▼'} {fmtPrice(Math.abs(hoveredCandle.price - getTokenPrice(displayToken.id)))}
                      </span>
                      <span className="exch-hover-date">{hoveredCandle.date}</span>
                    </>
                  ) : hasRealPrice(displayToken.id) ? (
                    <span className="exch-change-badge positive">▲ 0.00%</span>
                  ) : (
                    <span className="exch-change-badge" style={{ opacity: 0.5 }}>--</span>
                  )}
                </div>
                <div className="exch-ntc-equivalent">
                  {hasRealPrice(displayToken.id)
                    ? `${((hoveredCandle ? hoveredCandle.price : getTokenPrice(displayToken.id)) / (getTokenPrice('ntc') || 1)).toFixed(4)} NTC`
                    : '--'}
                </div>
              </div>
              <div className="exch-chart-toggle">
                <button
                  className={`exch-chart-toggle-btn ${exchChartType === 'area' ? 'active' : ''}`}
                  onClick={() => setExchChartType('area')}
                  title="Area Chart"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 12 L4 7 L7 9 L10 4 L15 6 L15 14 L1 14Z" fill="currentColor" opacity="0.3"/><path d="M1 12 L4 7 L7 9 L10 4 L15 6" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
                </button>
                <button
                  className={`exch-chart-toggle-btn ${exchChartType === 'candle' ? 'active' : ''}`}
                  onClick={() => setExchChartType('candle')}
                  title="Candlestick Chart"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="3" height="6" fill="currentColor" rx="0.5"/><line x1="3.5" y1="1" x2="3.5" y2="4" stroke="currentColor" strokeWidth="1"/><line x1="3.5" y1="10" x2="3.5" y2="14" stroke="currentColor" strokeWidth="1"/><rect x="8" y="6" width="3" height="5" fill="currentColor" rx="0.5"/><line x1="9.5" y1="3" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1"/><line x1="9.5" y1="11" x2="9.5" y2="15" stroke="currentColor" strokeWidth="1"/></svg>
                </button>
              </div>
            </div>
            <div className="exch-liquidity-info">
              {(() => {
                if (!poolReserves) return (
                  <div className="exch-liq-item">
                    <span className="exch-liq-icon"><Droplets size={14} /></span>
                    <span className="exch-liq-label">Pool Liquidity</span>
                    <span className="exch-liq-value">{poolLoading ? 'Loading...' : '--'}</span>
                  </div>
                )
                const ntcMint = getMint('ntc')
                const isANtc = ntcMint && poolReserves.tokenA.mint === ntcMint
                const ntcSide = isANtc ? poolReserves.tokenA : poolReserves.tokenB
                const pairSide = isANtc ? poolReserves.tokenB : poolReserves.tokenA
                const ntcAmount = Number(ntcSide.uiAmount) || 0
                const pairAmount = Number(pairSide.uiAmount) || 0
                const ntcSym = ntcToken?.symbol || 'NTC'
                const pairSym = poolPairSymbol || (poolPairTokenId && TOKENS.find(t => t.id === poolPairTokenId)?.symbol) || ''
                const fmtNum = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                return (
                  <div className="exch-liq-item">
                    <span className="exch-liq-icon"><Droplets size={14} /></span>
                    <span className="exch-liq-label">Pool Liquidity</span>
                    <span className="exch-liq-value">{fmtNum(ntcAmount)} {ntcSym} + {fmtNum(pairAmount)} {pairSym}</span>
                  </div>
                )
              })()}
            </div>
            <div className="exch-chart-controls-row">
              <div className="exch-chart-timeframes">
                {['30m', '1H', '1D', '1W', '1M', 'ALL'].map(tf => (
                  <button
                    key={tf}
                    className={`exch-tf-btn ${exchTimeframe === tf ? 'active' : ''}`}
                    onClick={() => setExchTimeframe(tf)}
                  >
                    {tf}
                  </button>
                ))}
              </div>
              <div className="exch-data-mode-toggle">
                <button
                  className={`exch-tf-btn ${exchDataMode === 'price' ? 'active' : ''}`}
                  onClick={() => setExchDataMode('price')}
                >
                  Price
                </button>
                <button
                  className={`exch-tf-btn ${exchDataMode === 'volume' ? 'active' : ''}`}
                  onClick={() => setExchDataMode('volume')}
                >
                  Volume
                </button>
              </div>
            </div>
            <div className="exch-chart-area">
              <ExchangeChart token={displayToken} chartType={exchChartType} timeframe={exchTimeframe} dataMode={exchDataMode} onHover={setHoveredCandle} tokenPrice={getTokenPrice(displayToken.id)} realCandles={hasChartData ? realCandles : null} />
            </div>
          </div>
        </div>

        <div className="exch-right">
          <div className="exch-swap-card">
            <div className="exch-tabs">
              {['Swap', 'Buy', 'Sell'].map(tab => (
                <button
                  key={tab}
                  className={`exch-tab ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'Swap' ? t('exch_swap') : tab === 'Buy' ? t('exch_buy') : t('exch_sell')}
                </button>
              ))}
              <button
                className="exch-settings-btn"
                onClick={() => setShowSlippage(!showSlippage)}
              >
                <SettingsIcon size={16} />
              </button>
            </div>

            {activeTab === 'Sell' ? (
              <>
                <div className="exch-input-group">
                  <div className="exch-amount-row">
                    <input
                      type="number"
                      className="exch-amount-input"
                      placeholder="0.00"
                      value={sellTabAmount}
                      onChange={(e) => setSellTabAmount(e.target.value)}
                    />
                    <button className="exch-token-btn" onClick={() => setSellTabModalOpen(true)}>
                      {getApiImage(sellTabToken.id) ? (
                        <img src={getApiImage(sellTabToken.id)} alt={sellTabToken.symbol} style={{ width: 22, height: 22, borderRadius: '50%' }} />
                      ) : (
                        <TokenBadge token={sellTabToken} size={22} />
                      )}
                      <span>{sellTabToken.symbol}</span>
                      <span className="exch-chevron">▾</span>
                    </button>
                  </div>
                  <div className="exch-fiat-value">
                    {sellTabAmount && parseFloat(sellTabAmount) > 0
                      ? `≈ ${currency.symbol}${((parseFloat(sellTabAmount) * (getTokenPrice(sellTabToken.id) || 1)) * 0.965).toFixed(2)}`
                      : `0.00 ${currency.code}`}
                  </div>
                </div>

                <div className="exch-swap-arrow static">
                  <span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14M12 19l-5-5M12 19l5-5" />
                    </svg>
                  </span>
                </div>

                <div className="exch-input-group">
                  <div className="exch-amount-row">
                    <input
                      type="number"
                      className="exch-amount-input"
                      placeholder="0.00"
                      value={sellTabAmount ? ((parseFloat(sellTabAmount) * (getTokenPrice(sellTabToken.id) || 1)) * 0.965).toFixed(2) : ''}
                      readOnly
                    />
                    <div className="exch-currency-select">
                      <span className="exch-currency-label">{currency.code}</span>
                    </div>
                  </div>
                </div>

                <button
                  className="exch-swap-btn"
                  disabled={true}
                  style={{ opacity: 0.4, cursor: 'not-allowed' }}
                >
                  {`${t('exch_sell')} ${sellTabToken.symbol}`}
                </button>
                {onchainStep && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(0,212,170,0.08)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: 8, fontSize: 12, color: '#00d4aa' }}>
                    {onchainStep === 'building_transfer' && 'Building token transfer...'}
                    {onchainStep === 'signing_transfer' && 'Please sign the transfer in your wallet...'}
                    {onchainStep === 'sending_transfer' && 'Sending transfer to Solana...'}
                  </div>
                )}
                {moonpayError && (
                  <div className="exch-error" style={{ marginTop: 8 }}>{moonpayError}</div>
                )}
              </>
            ) : activeTab === 'Buy' ? (
              <>
                <div className="exch-input-group">
                  <div className="exch-amount-row">
                    <input
                      type="number"
                      className="exch-amount-input"
                      placeholder="0.00"
                      value={buyTabAmount}
                      onChange={(e) => setBuyTabAmount(e.target.value)}
                    />
                    <div className="exch-currency-select">
                      <span className="exch-currency-label">{currency.code}</span>
                    </div>
                  </div>
                  <div className="exch-fiat-value">{currency.symbol}{buyTabAmount || '0.00'}</div>
                  <div className="buy-tab-presets">
                    {['100', '300', '1000'].map(amt => (
                      <button
                        key={amt}
                        className={`buy-tab-preset-btn ${buyTabAmount === amt ? 'active' : ''}`}
                        onClick={() => setBuyTabAmount(amt)}
                      >
                        {currency.symbol}{amt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="exch-swap-arrow static">
                  <span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 16V4M7 4L3 8M7 4L11 8" />
                      <path d="M17 8V20M17 20L21 16M17 20L13 16" />
                    </svg>
                  </span>
                </div>

                <div className="exch-input-group">
                  <div className="exch-amount-row">
                    <input
                      type="number"
                      className="exch-amount-input"
                      placeholder={buyTabPayment === 'nowpay' && buyEstimateLoading ? 'Loading...' : '0.00'}
                      value={
                        buyTabPayment === 'nowpay'
                          ? (cryptoEstimate?.ntcAmount != null ? parseFloat(cryptoEstimate.ntcAmount).toFixed(2) : '')
                          : (buyTabAmount ? (parseFloat(buyTabAmount) / (getTokenPrice(buyTabToken.id) || 1)).toFixed(2) : '')
                      }
                      readOnly
                    />
                    <button className="exch-token-btn" onClick={() => setBuyTabModalOpen(true)}>
                      {getApiImage(buyTabToken.id) ? (
                        <img src={getApiImage(buyTabToken.id)} alt={buyTabToken.symbol} style={{ width: 22, height: 22, borderRadius: '50%' }} />
                      ) : (
                        <TokenBadge token={buyTabToken} size={22} />
                      )}
                      <span>{buyTabToken.symbol}</span>
                      <span className="exch-chevron">▾</span>
                    </button>
                  </div>
                  <div className="exch-fiat-value">{currency.symbol}{buyTabAmount || '0.00'}</div>
                </div>

                <div className="buy-tab-payment-section">
                  <div className="buy-tab-payment-label">{t('buy_pay_with')}</div>
                  <div className="buy-tab-payment-options">
                    <button
                      className={`buy-tab-payment-btn ${buyTabPayment === 'nowpay' ? 'active' : ''}`}
                      onClick={() => { setBuyTabPayment('nowpay'); handleCryptoReset() }}
                    >
                      <span className="buy-tab-pay-icon"><Coins size={16} /></span>
                      <span>Pay with Crypto</span>
                      <span className="buy-tab-pay-arrow">›</span>
                    </button>
                    <button
                      className={`buy-tab-payment-btn ${buyTabPayment === 'nowpay' && selectedCryptoCurrency === 'btc' ? 'active' : ''}`}
                      onClick={() => { setBuyTabPayment('nowpay'); setSelectedCryptoCurrency('btc'); handleCryptoReset() }}
                    >
                      <span className="buy-tab-pay-icon">₿</span>
                      <span>BTC</span>
                      <span className="buy-tab-pay-arrow">›</span>
                    </button>
                  </div>
                </div>

                {buyTabPayment === 'nowpay' && cryptoStep === 'form' && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Pay Currency</div>
                    <button
                      onClick={() => setShowCurrencyPicker(!showCurrencyPicker)}
                      style={{
                        width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                        color: '#fff', cursor: 'pointer', display: 'flex',
                        justifyContent: 'space-between', alignItems: 'center', fontSize: 14,
                      }}
                    >
                      <span>{selectedCryptoCurrency.toUpperCase()}</span>
                      <span style={{ color: '#888' }}>▾</span>
                    </button>
                    {showCurrencyPicker && (
                      <div style={{
                        marginTop: 4, background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8, maxHeight: 180, overflowY: 'auto', padding: 4,
                      }}>
                        <input
                          type="text"
                          placeholder="Search currency..."
                          value={currencySearch}
                          onChange={(e) => setCurrencySearch(e.target.value)}
                          style={{
                            width: '100%', padding: '6px 10px', background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
                            color: '#fff', fontSize: 12, marginBottom: 4, boxSizing: 'border-box',
                          }}
                        />
                        {filteredCryptoCurrencies.map(c => (
                          <div
                            key={c}
                            onClick={() => { setSelectedCryptoCurrency(c); setShowCurrencyPicker(false); setCurrencySearch('') }}
                            style={{
                              padding: '6px 10px', cursor: 'pointer', fontSize: 13, color: '#fff',
                              borderRadius: 4, background: c === selectedCryptoCurrency ? 'rgba(0,212,170,0.15)' : 'transparent',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = c === selectedCryptoCurrency ? 'rgba(0,212,170,0.15)' : 'transparent'}
                          >
                            <span>{c.toUpperCase()}</span>
                            <span style={{ fontSize: 9, color: '#00d4aa', opacity: 0.7 }}>
                              {(() => { const ct = getCurrencyType(c); return ct === 'evm' ? 'EVM' : ct === 'solana' ? 'Solana' : 'Wallet' })()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {cryptoEstimate && (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(0,212,170,0.06)', borderRadius: 8, fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa' }}>
                          <span>Estimated cost</span>
                          <span style={{ color: '#00d4aa' }}>{cryptoEstimate.estimatedPayAmount} {selectedCryptoCurrency.toUpperCase()}</span>
                        </div>
                      </div>
                    )}
                    {cryptoError && (
                      <div className="exch-error" style={{ marginTop: 8 }}>{cryptoError}</div>
                    )}
                  </div>
                )}

                {buyTabPayment === 'nowpay' && cryptoStep === 'paying' && cryptoPayment && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 12px', background: 'rgba(0,212,170,0.06)', borderRadius: 8, marginBottom: 8,
                    }}>
                      <span style={{ color: '#888', fontSize: 12 }}>Send</span>
                      <span style={{ color: '#00d4aa', fontSize: 15, fontWeight: 700 }}>
                        {cryptoPayment.payAmount} {cryptoPayment.payCurrency?.toUpperCase()}
                      </span>
                    </div>

                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 8,
                    }}>
                      <span style={{ color: '#888', fontSize: 12 }}>You receive</span>
                      <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{cryptoPayment.ntcAmount?.toLocaleString()} {buyTabToken?.symbol || 'NTC'}</span>
                    </div>

                    {!cryptoWallet.txHash ? (
                      <>
                        {getCurrencyType(cryptoPayment.payCurrency) === 'solana' ? (
                          /* SOL — Phantom browser wallet directly */
                          <>
                            <button
                              className="exch-swap-btn"
                              disabled={cryptoWallet.connecting || cryptoWallet.sending}
                              onClick={() => cryptoWallet.connectAndSendSol(cryptoPayment.payAddress, cryptoPayment.payAmount)}
                              style={{ marginBottom: 8, background: 'rgba(153,69,255,0.15)', border: '1px solid rgba(153,69,255,0.3)', color: '#9945FF' }}
                            >
                              {cryptoWallet.connecting
                                ? 'Connecting Phantom...'
                                : cryptoWallet.sending
                                ? 'Confirm in Phantom...'
                                : `Pay ${cryptoPayment.payAmount} SOL with Phantom`}
                            </button>
                            {!cryptoWallet.isPhantomInstalled && (
                              <div style={{ fontSize: 11, color: '#f0ad4e', marginBottom: 8, textAlign: 'center' }}>
                                Phantom wallet not detected.{' '}
                                <a href="https://phantom.app" target="_blank" rel="noopener noreferrer" style={{ color: '#9945FF', textDecoration: 'underline' }}>
                                  Install Phantom
                                </a>
                              </div>
                            )}
                          </>
                        ) : (
                          /* EVM — WalletConnect / browser wallet */
                          <button
                            className="exch-swap-btn"
                            disabled={cryptoWallet.connecting || cryptoWallet.sending}
                            onClick={() => cryptoWallet.connectAndSendEvm(cryptoPayment.payCurrency, cryptoPayment.payAddress, cryptoPayment.payAmount)}
                            style={{ marginBottom: 8 }}
                          >
                            {cryptoWallet.connecting
                              ? 'Opening WalletConnect...'
                              : cryptoWallet.sending
                              ? 'Confirm in wallet...'
                              : `Connect Wallet & Pay ${cryptoPayment.payAmount} ${cryptoPayment.payCurrency?.toUpperCase()}`}
                          </button>
                        )}
                      </>
                    ) : (
                      <div style={{
                        padding: '8px 12px', background: 'rgba(0,212,170,0.08)', borderRadius: 8, marginBottom: 8,
                        fontSize: 12, color: '#00d4aa', textAlign: 'center',
                      }}>
                        Payment sent! Tx: {cryptoWallet.txHash.slice(0, 10)}...{cryptoWallet.txHash.slice(-6)}
                      </div>
                    )}
                    {cryptoWallet.error && (
                      <div className="exch-error" style={{ marginTop: 0, marginBottom: 8, fontSize: 11 }}>
                        {cryptoWallet.error}
                      </div>
                    )}

                    <div style={{
                      padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 8, textAlign: 'center',
                      background: !paymentStatus || paymentStatus.status === 'pending' ? 'rgba(240,173,78,0.1)' : (paymentStatus.status === 'completed' && paymentStatus.ntc_tx_signature) ? 'rgba(0,212,170,0.1)' : paymentStatus.status === 'failed' || paymentStatus.status === 'send_failed' ? 'rgba(217,83,79,0.1)' : 'rgba(91,192,222,0.1)',
                      color: !paymentStatus || paymentStatus.status === 'pending' ? '#f0ad4e' : (paymentStatus.status === 'completed' && paymentStatus.ntc_tx_signature) ? '#00d4aa' : paymentStatus.status === 'failed' || paymentStatus.status === 'send_failed' ? '#d9534f' : '#5bc0de',
                    }}>
                      {!paymentStatus || paymentStatus.status === 'pending' ? 'Waiting for payment...' : paymentStatus.status === 'confirming' ? 'Confirming payment...' : paymentStatus.status === 'confirmed' ? `Payment confirmed, sending ${buyToken?.symbol || 'tokens'}...` : (paymentStatus.status === 'sending' || (paymentStatus.status === 'completed' && !paymentStatus.ntc_tx_signature)) ? `Sending ${buyToken?.symbol || 'tokens'} to your wallet...` : (paymentStatus.status === 'completed' && paymentStatus.ntc_tx_signature) ? 'Payment complete!' : paymentStatus.status === 'failed' ? 'Payment failed' : paymentStatus.status === 'send_failed' ? `${buyToken?.symbol || 'Token'} transfer failed` : paymentStatus.status}
                    </div>

                    <button
                      onClick={handleCryptoReset}
                      className="exch-swap-btn"
                      style={{ background: (paymentStatus?.status === 'completed' && paymentStatus?.ntc_tx_signature) ? 'rgba(0,212,170,0.2)' : 'rgba(255,255,255,0.05)' }}
                    >
                      {(paymentStatus?.status === 'completed' && paymentStatus?.ntc_tx_signature) ? 'Done' : paymentStatus?.status === 'failed' || paymentStatus?.status === 'send_failed' ? 'Try Again' : 'Cancel'}
                    </button>
                  </div>
                )}

                {cryptoStep === 'form' && (
                  <button
                    className="exch-swap-btn"
                    disabled={cryptoLoading}
                    onClick={() => {
                      if (!connected || !buyTabAmount || parseFloat(buyTabAmount) <= 0) return
                      handleCryptoPayment()
                    }}
                  >
                    {cryptoLoading
                      ? t('buy_processing') + '...'
                      : !connected ? t('exch_connect_wallet') : !buyTabAmount ? t('exch_enter_amount')
                      : `Pay with ${selectedCryptoCurrency.toUpperCase()}`}
                  </button>
                )}
                {onchainStep && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(0,212,170,0.08)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: 8, fontSize: 12, color: '#00d4aa' }}>
                    {onchainStep === 'building_transfer' && 'Building token transfer...'}
                    {onchainStep === 'signing_transfer' && 'Please sign the transfer in your wallet...'}
                    {onchainStep === 'sending_transfer' && 'Sending transfer to Solana...'}
                  </div>
                )}
              </>
            ) : (
              <>
                {showSlippage && (
                  <div className="exch-slippage-panel">
                    <div className="exch-slippage-label">{t('exch_slippage_tolerance')}</div>
                    <div className="exch-slippage-options">
                      {['0.1', '0.5', '1.0'].map(val => (
                        <button
                          key={val}
                          className={`exch-slip-btn ${slippage === val ? 'active' : ''}`}
                          onClick={() => setSlippage(val)}
                        >
                          {val}%
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="exch-input-group">
                  <div className="exch-amount-row">
                    <input
                      type="number"
                      className="exch-amount-input"
                      placeholder="0.00"
                      value={sellAmount}
                      onChange={(e) => handleSellAmountChange(e.target.value)}
                    />
                    <button className="exch-token-btn" onClick={() => handleOpenModal('sell')}>
                      {sellToken ? (
                        <>
                          {getApiImage(sellToken.id) ? (
                            <img src={getApiImage(sellToken.id)} alt={sellToken.symbol} style={{ width: 22, height: 22, borderRadius: '50%' }} />
                          ) : (
                            <TokenBadge token={sellToken} size={22} />
                          )}
                          <span>{sellToken.symbol}</span>
                        </>
                      ) : <span>{t('exch_select')}</span>}
                      <span className="exch-chevron">▾</span>
                    </button>
                  </div>
                  <div className="exch-usd-hint">{sellDisplayValue}</div>
                </div>

                <div className="exch-swap-arrow">
                  <button type="button" onClick={handleSwapTokens} aria-label="Swap token direction">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 16V4M7 4L3 8M7 4L11 8" />
                      <path d="M17 8V20M17 20L21 16M17 20L13 16" />
                    </svg>
                  </button>
                </div>

                <div className="exch-input-group">
                  <div className="exch-amount-row">
                    <input
                      type="number"
                      className="exch-amount-input"
                      placeholder={quoteLoading ? 'Fetching quote...' : '0.00'}
                      value={buyAmount}
                      readOnly={!!quoteData || quoteLoading}
                      onChange={(e) => !quoteData && !quoteLoading && handleBuyAmountChange(e.target.value)}
                      style={quoteLoading ? { opacity: 0.5 } : {}}
                    />
                    <button className={`exch-token-btn ${buyIsNtc ? 'locked' : ''}`} onClick={() => handleOpenModal('buy')}>
                      {buyToken ? (
                        <>
                          {getApiImage(buyToken.id) ? (
                            <img src={getApiImage(buyToken.id)} alt={buyToken.symbol} style={{ width: 22, height: 22, borderRadius: '50%' }} />
                          ) : (
                            <TokenBadge token={buyToken} size={22} />
                          )}
                          <span>{buyToken.symbol}</span>
                        </>
                      ) : <span>{t('exch_select_token')}</span>}
                      {!buyIsNtc && <span className="exch-chevron">▾</span>}
                    </button>
                  </div>
                  <div className="exch-usd-hint">{buyDisplayValue}</div>
                </div>

                {connected && swapLimits && (() => {
                  const getLimitColor = (remaining, limit) => {
                    const pct = remaining / limit
                    if (pct <= 0) return '#ff4d6a'
                    if (pct <= 0.2) return '#f59e0b'
                    return '#22c55e'
                  }
                  const cappedDailyRemaining = Math.max(0, Math.min(swapLimits.daily.remaining, swapLimits.monthly.remaining, swapLimits.daily.limit))
                  const cappedDailyUsed = Math.max(0, swapLimits.daily.limit - cappedDailyRemaining)
                  const dailyPct = swapLimits.daily.limit > 0 ? Math.min(1, cappedDailyUsed / swapLimits.daily.limit) : 0
                  const monthlyPct = swapLimits.monthly.limit > 0 ? Math.min(1, swapLimits.monthly.used / swapLimits.monthly.limit) : 0
                  const dailyColor = getLimitColor(cappedDailyRemaining, swapLimits.daily.limit)
                  const monthlyColor = getLimitColor(swapLimits.monthly.remaining, swapLimits.monthly.limit)
                  return (
                    <div style={{ margin: '10px 0', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ color: '#94a3b8' }}>Daily Limit</span>
                        <span style={{ color: dailyColor, fontWeight: 600 }}>
                          {cappedDailyRemaining.toFixed(1)} remaining
                        </span>
                      </div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
                        <div style={{ height: '100%', width: `${dailyPct * 100}%`, background: dailyColor, borderRadius: 2, transition: 'width 0.3s' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ color: '#94a3b8' }}>Monthly Limit</span>
                        <span style={{ color: monthlyColor, fontWeight: 600 }}>
                          {swapLimits.monthly.remaining.toFixed(1)} remaining
                        </span>
                      </div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${monthlyPct * 100}%`, background: monthlyColor, borderRadius: 2, transition: 'width 0.3s' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#64748b' }}>
                        <span>{cappedDailyUsed.toFixed(1)} / {swapLimits.daily.limit} tokens today</span>
                        <span>{swapLimits.monthly.used.toFixed(1)} / {swapLimits.monthly.limit} tokens this month</span>
                      </div>
                    </div>
                  )
                })()}

                <button
                  className="exch-swap-btn"
                  disabled={!sellToken || !buyToken || !sellAmount || (connected && !sellAmount) || swapLoading || (swapLimits && swapLimits.daily.remaining <= 0) || (swapLimits && swapLimits.monthly.remaining <= 0)}
                  onClick={handleSwapClick}
                >
                  {swapLoading ? 'Swapping...' : !connected ? t('exch_connect_wallet') : (swapLimits && (swapLimits.daily.remaining <= 0 || swapLimits.monthly.remaining <= 0)) ? 'Swap Limit Reached' : !sellToken || !buyToken ? t('exch_select_a_token') : !sellAmount ? t('exch_enter_amount') : t('exch_swap')}
                </button>

                {swapError && (
                  <div className="exch-swap-error" style={{ color: '#ff4d6a', fontSize: 13, marginTop: 8, textAlign: 'center', wordBreak: 'break-word' }}>
                    {swapError}
                  </div>
                )}

                {swapResult && (
                  <div className="exch-swap-success" style={{ color: '#a3e635', fontSize: 13, marginTop: 8, textAlign: 'center' }}>
                    Swap confirmed!{' '}
                    <a
                      href={explorerTxUrl(swapResult.signature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#a78bfa', textDecoration: 'underline' }}
                    >
                      View on Explorer
                    </a>
                    {swapResult.referralBonus && swapResult.referralBonus.refereePaid && (
                      <div style={{ marginTop: 4, color: '#fbbf24', fontSize: 12 }}>
                        +{swapResult.referralBonus.refereeReward} NTC referral bonus added to your wallet
                      </div>
                    )}
                  </div>
                )}

                {sellToken && buyToken && rate && (
                  <div className="exch-swap-info">
                    <span>1 {sellToken.symbol} ≈ {fmtPrice(sellPriceVal)}</span>
                    <span>Swap Fee: {swapFeePct}%</span>
                    <span>Transfer Fee: {transferFeePct}%</span>
                    <span>{t('exch_slippage')} {slippage}%</span>
                  </div>
                )}

                {connected && !referralApplied && !(swapLimits && (swapLimits.daily.used > 0 || swapLimits.monthly.used > 0)) && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: 10 }}>
                    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Have a referral code? Apply it to earn bonus NTC on your first swap.</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={referralCode}
                        onChange={e => setReferralCode(e.target.value.toUpperCase())}
                        placeholder="Enter referral code"
                        maxLength={16}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 10px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'monospace', letterSpacing: 1 }}
                      />
                      <button
                        onClick={applyReferralCode}
                        disabled={!referralCode.trim() || referralLoading}
                        style={{ padding: '6px 14px', background: 'rgba(168,85,247,0.2)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 6, color: '#a78bfa', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: !referralCode.trim() || referralLoading ? 0.5 : 1 }}
                      >
                        {referralLoading ? '...' : 'Apply'}
                      </button>
                    </div>
                    {referralStatus && (
                      <div style={{ marginTop: 6, fontSize: 12, color: referralStatus.type === 'success' ? '#22c55e' : '#ef4444' }}>
                        {referralStatus.message}
                      </div>
                    )}
                  </div>
                )}

              </>
            )}
          </div>
        </div>
      </div>


      {displayToken.description && (
        <div className="exch-about-token">
          <h2 className="exch-about-title">{t('exch_about_title')} {tToken(`token_${displayToken.id}_fullname`, getApiName(displayToken.id) || displayToken.fullName)} ({displayToken.symbol})</h2>
          <div className={`exch-about-text${aboutExpanded ? '' : ' exch-about-text-clamped'}`}>
            {(() => {
              const raw = tToken(`token_${displayToken.id}_description`, displayToken.description);
              const lines = raw.split('\n');
              const elements = [];
              let i = 0;
              while (i < lines.length) {
                const line = lines[i].trim();
                if (!line) { i++; continue; }
                const isSectionHeader = /^[^\n]{1,80}[:：]\s*$/.test(line);
                const isBullet = line.startsWith('• ') || line.startsWith('· ');
                if (isSectionHeader) {
                  elements.push(<p key={i} className="desc-section-header"><strong>{line}</strong></p>);
                } else if (isBullet) {
                  elements.push(<p key={i} className="desc-bullet">{line}</p>);
                } else {
                  elements.push(<p key={i} className="desc-paragraph">{line}</p>);
                }
                i++;
              }
              return elements;
            })()}
          </div>
          <button
            className="exch-about-toggle"
            onClick={() => setAboutExpanded(prev => !prev)}
          >
            {aboutExpanded ? 'See Less' : 'See More'}
          </button>
        </div>
      )}

      <div className="exch-tx-header">
        <div className="exch-tx-header-left">
          <div className="exch-tx-tabs">
            <button
              className={`exch-tx-tab${txTab === 'all' ? ' active' : ''}`}
              onClick={() => setTxTab('all')}
            >
              {t('exch_all_trades')}
            </button>
            <button
              className={`exch-tx-tab${txTab === 'mine' ? ' active' : ''}`}
              onClick={() => { if (walletAddress) setTxTab('mine') }}
              disabled={!walletAddress}
              title={!walletAddress ? t('exch_connect_wallet_tooltip') : ''}
            >
              {t('exch_my_transactions')} ({displayToken.symbol})
            </button>
          </div>
        </div>
        <div className="exch-tx-search">
          <input
            type="text"
            placeholder={t('exch_search')}
            value={txSearch}
            onChange={(e) => setTxSearch(e.target.value)}
          />
          <span className="exch-tx-search-icon"><Search size={14} /></span>
        </div>
      </div>
      <div className="exch-transactions">
        <table className="exch-tx-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('exch_type')}</th>
              <th>{t('exch_from')}</th>
              <th>{t('exch_to')}</th>
              <th>{t('exch_amount')}</th>
              <th>{t('exch_price')}</th>
              <th>{t('exch_time')}</th>
              <th>{t('exch_status')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredTx.length > 0 ? filteredTx.map((tx) => (
              <tr key={tx.id}>
                <td>{tx.id}</td>
                <td><span className="exch-tx-type">{tx.type}</span></td>
                <td>{tx.amountFrom} {tx.from}</td>
                <td>{tx.amountTo} {tx.to}</td>
                <td>{tx.price}</td>
                <td>{tx.price}</td>
                <td className="exch-tx-time">{tx.time}</td>
                <td>
                  <span className={`exch-tx-status ${tx.status.toLowerCase()}`}>{tx.status}</span>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px', fontSize: '13px' }}>
                  {txTab === 'mine' && !walletAddress
                    ? t('exch_connect_wallet_to_view')
                    : txTab === 'mine'
                      ? t('exch_no_trades_for_pair')
                      : t('exch_no_trades_yet')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <TokenModal
          onSelect={handleSelectToken}
          onClose={() => setModalOpen(null)}
          excludeToken={modalOpen === 'sell' ? buyToken : sellToken}
        />
      )}

      {buyTabModalOpen && (
        <TokenModal
          onSelect={(token) => { setBuyTabToken(token); setBuyTabModalOpen(false) }}
          onClose={() => setBuyTabModalOpen(false)}
          includeBase
        />
      )}

      {sellTabModalOpen && (
        <TokenModal
          onSelect={(token) => { setSellTabToken(token); setSellTabModalOpen(false) }}
          onClose={() => setSellTabModalOpen(false)}
          includeBase
        />
      )}

      {showSwapConfirm && (
        <div className="swap-confirm-overlay" onClick={() => setShowSwapConfirm(false)}>
          <div className="swap-confirm-modal" onClick={e => e.stopPropagation()}>
            <h3 className="swap-confirm-title">Confirm Swap</h3>
            <div className="swap-confirm-details">
              <div className="swap-confirm-row">
                <span className="swap-confirm-label">You pay</span>
                <span className="swap-confirm-value">{sellAmount} {sellToken?.symbol}</span>
              </div>
              <div className="swap-confirm-arrow">↓</div>
              <div className="swap-confirm-row">
                <span className="swap-confirm-label">You receive</span>
                <span className="swap-confirm-value">~{buyAmount} {buyToken?.symbol}</span>
              </div>
              <div className="swap-confirm-row" style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
                <span>Slippage</span>
                <span>{slippage}%</span>
              </div>
            </div>
            <div className="swap-confirm-actions">
              <button className="swap-confirm-cancel" onClick={() => setShowSwapConfirm(false)}>Cancel</button>
              <button className="swap-confirm-proceed" onClick={confirmSwap}>Confirm Swap</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function generateDates(count, timeframe) {
  const now = new Date()
  const dates = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    if (timeframe === '30m') d.setMinutes(d.getMinutes() - i * 30)
    else if (timeframe === '1H') d.setHours(d.getHours() - i)
    else if (timeframe === '1D') d.setHours(d.getHours() - i)
    else if (timeframe === '1W') d.setDate(d.getDate() - i)
    else if (timeframe === '1M') d.setDate(d.getDate() - i)
    else d.setDate(d.getDate() - i * 7)
    dates.push(d)
  }
  return dates
}

function formatCandleDate(date, timeframe) {
  if (timeframe === '30m' || timeframe === '1H' || timeframe === '1D') {
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function ExchangeChart({ token, chartType = 'area', timeframe = '1D', dataMode = 'price', onHover, tokenPrice, realCandles }) {
  const [hovIdx, setHovIdx] = useState(null)
  const basePrice = tokenPrice || token?.price || 1

  let points, dates
  if (realCandles && realCandles.length > 0) {
    points = realCandles.map(c => c.close)
    dates = realCandles.map(c => new Date(c.time))
  } else {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', color: 'var(--text-muted)', fontSize: '13px' }}>
        No trade data yet
      </div>
    )
  }

  if (!points.length) return null

  const handleLeave = () => { setHovIdx(null); onHover && onHover(null) }

  const W = 700
  const PRICE_H = 320
  const VOL_H = 70
  const AXIS_W = 65
  const PAD_TOP = 15
  const PAD_BOTTOM = 25
  const TOTAL_H = PRICE_H + VOL_H + PAD_BOTTOM
  const chartW = W - AXIS_W
  const GREEN = '#22c55e'
  const RED = '#ef4444'
  const GRID_COLOR = 'rgba(255,255,255,0.04)'
  const AXIS_COLOR = 'rgba(255,255,255,0.35)'

  const fmtAxisPrice = (v) => {
    if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
    if (v >= 1) return v.toFixed(2)
    if (v >= 0.01) return v.toFixed(4)
    return v.toFixed(6)
  }

  const fmtAxisTime = (d) => {
    if (['30m', '1H'].includes(timeframe)) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (timeframe === '1D') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const niceGridLevels = (min, max, targetCount) => {
    const range = max - min || 1
    const rough = range / targetCount
    const mag = Math.pow(10, Math.floor(Math.log10(rough)))
    const residual = rough / mag
    let step
    if (residual <= 1.5) step = mag
    else if (residual <= 3) step = 2 * mag
    else if (residual <= 7) step = 5 * mag
    else step = 10 * mag
    const levels = []
    let v = Math.ceil(min / step) * step
    while (v <= max) { levels.push(v); v += step }
    return levels
  }

  const computeVolumes = () => {
    if (!realCandles || realCandles.length === 0) return points.map(() => 0)
    return realCandles.map(c => {
      if (c.volume !== undefined && c.volume !== null) return Number(c.volume)
      const base = 50000 * (c.close / basePrice)
      const spread = Math.abs(c.high - c.low) / (c.close || 1)
      return base * (0.3 + spread * 5)
    })
  }

  const volumes = computeVolumes()
  let maxVol = 1
  for (let i = 0; i < volumes.length; i++) {
    if (volumes[i] > maxVol) maxVol = volumes[i]
  }

  const renderGridAndAxis = (min, max) => {
    const priceLevels = niceGridLevels(min, max, 5)
    const priceRange = max - min || 1
    const toY = (v) => PAD_TOP + (1 - (v - min) / priceRange) * (PRICE_H - PAD_TOP)
    const timeStep = Math.max(1, Math.floor(points.length / 6))
    return (
      <g>
        {priceLevels.map((lv, i) => {
          const y = toY(lv)
          if (y < PAD_TOP || y > PRICE_H) return null
          return (
            <g key={`pg${i}`}>
              <line x1={0} y1={y} x2={chartW} y2={y} stroke={GRID_COLOR} strokeWidth="1" />
              <text x={chartW + 8} y={y + 4} fill={AXIS_COLOR} fontSize="10" fontFamily="monospace">{fmtAxisPrice(lv)}</text>
            </g>
          )
        })}
        <line x1={0} y1={PRICE_H} x2={chartW} y2={PRICE_H} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        {dates.filter((_, i) => i % timeStep === 0).map((d, i) => {
          const idx = dates.indexOf(d)
          const x = (idx / (points.length - 1 || 1)) * chartW
          return (
            <g key={`tg${i}`}>
              <line x1={x} y1={PAD_TOP} x2={x} y2={PRICE_H + VOL_H} stroke={GRID_COLOR} strokeWidth="1" />
              <text x={x} y={PRICE_H + VOL_H + 14} fill={AXIS_COLOR} fontSize="9" fontFamily="monospace" textAnchor="middle">{fmtAxisTime(d)}</text>
            </g>
          )
        })}
      </g>
    )
  }

  const renderVolumeBars = (candleData) => {
    const count = candleData ? candleData.length : points.length
    const slotW = chartW / count
    const barW = slotW * 0.6
    return (
      <g>
        {volumes.map((vol, i) => {
          const x = i * slotW + (slotW - barW) / 2
          const barH = Math.max(1, (vol / maxVol) * (VOL_H - 5))
          const isUp = candleData ? candleData[i].close >= candleData[i].open : (i === 0 ? true : points[i] >= points[i - 1])
          return (
            <rect key={`vb${i}`} x={x} y={PRICE_H + VOL_H - barH} width={barW} height={barH} fill={isUp ? GREEN : RED} opacity={hovIdx === i ? 0.6 : 0.25} rx="1" />
          )
        })}
      </g>
    )
  }

  const renderCrosshair = (count) => {
    if (hovIdx === null) return null
    const slotW = chartW / count
    const x = hovIdx * slotW + slotW / 2
    return (
      <g>
        <line x1={x} y1={PAD_TOP} x2={x} y2={PRICE_H + VOL_H} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3,3" />
      </g>
    )
  }

  if (dataMode === 'volume') {
    const count = points.length
    const slotW = chartW / count
    const barW = slotW * 0.65

    if (chartType === 'area') {
      const volPoints = volumes.map((v, i) => {
        const x = (i / (volumes.length - 1 || 1)) * chartW
        const y = PAD_TOP + (1 - v / maxVol) * (PRICE_H + VOL_H - PAD_TOP - 5)
        return `${x},${y}`
      })
      const linePath = `M${volPoints.join(' L')}`
      const areaPath = `${linePath} L${chartW},${PRICE_H + VOL_H} L0,${PRICE_H + VOL_H}Z`
      const hitW = chartW / volumes.length
      return (
        <svg viewBox={`0 0 ${W} ${TOTAL_H}`} preserveAspectRatio="xMidYMid meet" className="exch-chart-svg" onMouseLeave={handleLeave}>
          <defs>
            <linearGradient id="exchVolGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#exchVolGrad)" />
          <path d={linePath} fill="none" stroke="#a855f7" strokeWidth="2" />
          {volumes.map((vol, i) => {
            const x = (i / (volumes.length - 1 || 1)) * chartW - hitW / 2
            return (
              <rect key={`h${i}`} x={Math.max(0, x)} y={0} width={hitW} height={TOTAL_H} fill="transparent"
                onMouseEnter={() => { setHovIdx(i); onHover && onHover({ price: points[i], date: formatCandleDate(dates[i], timeframe) }) }}
                style={{ cursor: 'crosshair' }} />
            )
          })}
          {renderCrosshair(volumes.length)}
        </svg>
      )
    }

    return (
      <svg viewBox={`0 0 ${W} ${TOTAL_H}`} preserveAspectRatio="xMidYMid meet" className="exch-chart-svg" onMouseLeave={handleLeave}>
        {volumes.map((vol, i) => {
          const x = i * slotW + (slotW - barW) / 2
          const barH = Math.max(1, (vol / maxVol) * (PRICE_H + VOL_H - PAD_TOP - 5))
          const isUp = i === 0 ? true : points[i] >= points[i - 1]
          return (
            <g key={i}>
              <rect x={x} y={PRICE_H + VOL_H - barH} width={barW} height={barH} fill={isUp ? GREEN : RED} opacity={hovIdx === i ? 1 : 0.7} rx="1" />
              <rect x={i * slotW} y={0} width={slotW} height={TOTAL_H} fill="transparent"
                onMouseEnter={() => { setHovIdx(i); onHover && onHover({ price: points[i], date: formatCandleDate(dates[i], timeframe) }) }}
                style={{ cursor: 'crosshair' }} />
            </g>
          )
        })}
        {renderCrosshair(count)}
      </svg>
    )
  }

  if (chartType === 'candle') {
    let candles
    if (realCandles && realCandles.length > 0) {
      candles = realCandles.map(c => ({ open: c.open, close: c.close, high: c.high, low: c.low, date: new Date(c.time) }))
    } else {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', color: 'var(--text-muted)', fontSize: '13px' }}>
          No trade data yet
        </div>
      )
    }

    if (!candles.length) return null

    const candleCount = candles.length
    let min = candles[0].low, max = candles[0].high
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].low < min) min = candles[i].low
      if (candles[i].high > max) max = candles[i].high
    }
    const priceRange = max - min || 1
    const padRange = priceRange * 0.05
    const pMin = min - padRange
    const pMax = max + padRange
    const pRange = pMax - pMin

    const slotW = chartW / candleCount
    const candleWidth = Math.max(3, slotW * 0.65)
    const toY = (v) => PAD_TOP + (1 - (v - pMin) / pRange) * (PRICE_H - PAD_TOP)

    return (
      <svg viewBox={`0 0 ${W} ${TOTAL_H}`} preserveAspectRatio="xMidYMid meet" className="exch-chart-svg" onMouseLeave={handleLeave}>
        {renderGridAndAxis(pMin, pMax)}
        {renderVolumeBars(candles)}
        {candles.map((c, i) => {
          const x = i * slotW + (slotW - candleWidth) / 2
          const isGreen = c.close >= c.open
          const color = isGreen ? GREEN : RED
          const bodyTop = toY(Math.max(c.open, c.close))
          const bodyBottom = toY(Math.min(c.open, c.close))
          const bodyHeight = Math.max(bodyBottom - bodyTop, 2)
          const wickX = i * slotW + slotW / 2
          const isHovered = hovIdx === i
          return (
            <g key={i}>
              <line x1={wickX} y1={toY(c.high)} x2={wickX} y2={toY(c.low)} stroke={color} strokeWidth={isHovered ? 2 : 1.5} opacity={isHovered ? 1 : 0.9} />
              <rect x={x} y={bodyTop} width={candleWidth} height={bodyHeight} fill={color} rx="3.5" opacity={isHovered ? 1 : 0.9} />
              {isHovered && (
                <g>
                  <rect x={x - 1} y={bodyTop - 1} width={candleWidth + 2} height={bodyHeight + 2} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1" rx="4" />
                  <line x1={0} y1={toY(c.close)} x2={chartW} y2={toY(c.close)} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3,3" />
                  <rect x={chartW + 2} y={toY(c.close) - 8} width={AXIS_W - 4} height={16} rx="3" fill={color} opacity="0.9" />
                  <text x={chartW + AXIS_W / 2} y={toY(c.close) + 4} fill="#fff" fontSize="9" fontFamily="monospace" textAnchor="middle">{fmtAxisPrice(c.close)}</text>
                </g>
              )}
              <rect x={i * slotW} y={0} width={slotW} height={TOTAL_H} fill="transparent"
                onMouseEnter={() => { setHovIdx(i); onHover && onHover({ price: c.close, open: c.open, high: c.high, low: c.low, date: formatCandleDate(c.date, timeframe) }) }}
                style={{ cursor: 'crosshair' }} />
            </g>
          )
        })}
        {renderCrosshair(candleCount)}
      </svg>
    )
  }

  let min = points[0], max = points[0]
  for (let i = 1; i < points.length; i++) {
    if (points[i] < min) min = points[i]
    if (points[i] > max) max = points[i]
  }
  const priceRange = max - min || 1
  const padRange = priceRange * 0.05
  const pMin = min - padRange
  const pMax = max + padRange
  const pRange = pMax - pMin

  const toY = (v) => PAD_TOP + (1 - (v - pMin) / pRange) * (PRICE_H - PAD_TOP)
  const linePoints = points.map((v, i) => {
    const x = (i / (points.length - 1 || 1)) * chartW
    return `${x},${toY(v)}`
  })
  const linePath = `M${linePoints.join(' L')}`
  const areaPath = `${linePath} L${chartW},${PRICE_H} L0,${PRICE_H}Z`
  const hitW = chartW / points.length

  const isUp = points.length >= 2 && points[points.length - 1] >= points[0]
  const lineColor = isUp ? GREEN : RED

  return (
    <svg viewBox={`0 0 ${W} ${TOTAL_H}`} preserveAspectRatio="xMidYMid meet" className="exch-chart-svg" onMouseLeave={handleLeave}>
      <defs>
        <linearGradient id="exchAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.2" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {renderGridAndAxis(pMin, pMax)}
      {renderVolumeBars(null)}
      <path d={areaPath} fill="url(#exchAreaGrad)" />
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" />
      {points.map((v, i) => {
        const x = (i / (points.length - 1 || 1)) * chartW - hitW / 2
        return (
          <rect key={`h${i}`} x={Math.max(0, x)} y={0} width={hitW} height={TOTAL_H} fill="transparent"
            onMouseEnter={() => { setHovIdx(i); onHover && onHover({ price: v, date: formatCandleDate(dates[i], timeframe) }) }}
            style={{ cursor: 'crosshair' }} />
        )
      })}
      {hovIdx !== null && (
        <g>
          <line x1={(hovIdx / (points.length - 1 || 1)) * chartW} y1={PAD_TOP} x2={(hovIdx / (points.length - 1 || 1)) * chartW} y2={PRICE_H + VOL_H} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3,3" />
          <line x1={0} y1={toY(points[hovIdx])} x2={chartW} y2={toY(points[hovIdx])} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3,3" />
          <circle cx={(hovIdx / (points.length - 1 || 1)) * chartW} cy={toY(points[hovIdx])} r="4" fill={lineColor} stroke="#fff" strokeWidth="1.5" />
        </g>
      )}
    </svg>
  )
}

export default Swap
