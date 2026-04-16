import { useState, useCallback, useEffect, useRef } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'
import { loadMoonPay } from '@moonpay/moonpay-js'
import { getMint, initMints } from '../data/mints'

const MOONPAY_API_KEY = import.meta.env.VITE_MOONPAY_API_KEY || import.meta.env.MOONPAY_API_KEY || ''
const MOONPAY_ENV = (import.meta.env.VITE_MOONPAY_ENV || 'production').toLowerCase()

export default function useMoonPay() {
  const { publicKey, signTransaction } = useWallet()
  const { connection } = useConnection()
  const [loading, setLoading] = useState(false)
  const [transactions, setTransactions] = useState([])
  const [error, setError] = useState(null)
  const [onchainStep, setOnchainStep] = useState(null)
  const sdkRef = useRef(null)
  const sellSdkRef = useRef(null)
  const currentTxRef = useRef(null)
  const terminalReachedRef = useRef(false)
  const callbacksRef = useRef({ onComplete: null, onClose: null })

  const walletAddress = publicKey?.toBase58() || ''

  const fetchTransactions = useCallback(async () => {
    if (!walletAddress) return
    try {
      const res = await fetch(`/api/moonpay/transactions/${walletAddress}`)
      const data = await res.json()
      if (data.ok) setTransactions(data.transactions || [])
    } catch (e) {
      console.error('[MoonPay] fetchTransactions error:', e)
    }
  }, [walletAddress])

  const createTransaction = useCallback(async ({ cryptoCurrency, fiatCurrency, amountFiat, amountCrypto, type, tokenPrice }) => {
    if (!walletAddress) return null
    try {
      const res = await fetch('/api/moonpay/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userWallet: walletAddress,
          cryptoCurrency: cryptoCurrency || '',
          fiatCurrency: fiatCurrency || 'USD',
          amountFiat: amountFiat || 0,
          amountCrypto: amountCrypto || 0,
          type: type || 'buy',
          tokenPrice: tokenPrice || 0,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to create transaction')
      return data.transaction
    } catch (e) {
      console.error('[MoonPay] createTransaction error:', e)
      setError(e.message)
      return null
    }
  }, [walletAddress])

  const updateTransaction = useCallback(async (id, updates) => {
    const token = currentTxRef.current?.update_token
    if (!token) return null
    try {
      const res = await fetch(`/api/moonpay/transaction/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updates, updateToken: token }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to update transaction')
      return data.transaction
    } catch (e) {
      console.error('[MoonPay] updateTransaction error:', e)
      return null
    }
  }, [])

  const executeBuySwap = useCallback(async ({ tokenId, moonpayTxId, updateToken }) => {
    if (!publicKey || !signTransaction || !connection) return null
    if (!moonpayTxId || !updateToken) throw new Error('MoonPay transaction record required')
    await initMints()
    const tokenMint = getMint(tokenId)
    if (!tokenMint) throw new Error('Token mint not found')

    setOnchainStep('building_transfer')
    const res = await fetch('/api/buy/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientPubkey: publicKey.toBase58(),
        tokenMint,
        moonpayTxId,
        updateToken,
      }),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Failed to build buy transfer')

    setOnchainStep('signing_transfer')
    const txBytes = Uint8Array.from(atob(data.transaction), c => c.charCodeAt(0))
    const transaction = VersionedTransaction.deserialize(txBytes)
    const signed = await signTransaction(transaction)

    setOnchainStep('sending_transfer')
    const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))
    const sendRes = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction: signedBase64,
        blockhash: data.blockhash,
        lastValidBlockHeight: data.lastValidBlockHeight,
        updateChannels: ['balances:update'],
        updateDetail: 'buyTransfer',
      }),
    })
    const sendData = await sendRes.json()
    if (!sendData.ok) throw new Error(sendData.error || 'Failed to send buy transfer')

    setOnchainStep(null)
    return sendData.signature || null
  }, [publicKey, signTransaction, connection])

  const executeSellTransfer = useCallback(async ({ tokenId, amount }) => {
    if (!publicKey || !signTransaction || !connection) return null
    await initMints()
    const tokenMint = getMint(tokenId)
    if (!tokenMint) throw new Error('Token mint not found')

    setOnchainStep('building_transfer')
    const res = await fetch('/api/moonpay/transfer/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPubkey: publicKey.toBase58(),
        tokenMint,
        amount: parseFloat(amount),
      }),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Failed to build transfer transaction')

    setOnchainStep('signing_transfer')
    const txBytes = Uint8Array.from(atob(data.transaction), c => c.charCodeAt(0))
    const transaction = VersionedTransaction.deserialize(txBytes)
    const signed = await signTransaction(transaction)
    const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))

    setOnchainStep('sending_transfer')
    const sendRes = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction: signedBase64,
        blockhash: data.blockhash,
        lastValidBlockHeight: data.lastValidBlockHeight,
        updateChannels: ['balances:update'],
        updateDetail: 'moonpay_sell_transfer',
      }),
    })
    const sendData = await sendRes.json()
    if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transfer transaction')

    setOnchainStep(null)
    return sendData.signature
  }, [publicKey, signTransaction, connection])

  const openWidget = useCallback(async ({ cryptoCurrency = 'sol', fiatCurrency = 'usd', fiatAmount, tokenPrice, tokenId, onComplete, onClose }) => {
    if (!MOONPAY_API_KEY) {
      setError('MoonPay API key not configured')
      return false
    }

    setLoading(true)
    setError(null)
    terminalReachedRef.current = false
    callbacksRef.current = { onComplete, onClose }

    const tx = await createTransaction({
      cryptoCurrency,
      fiatCurrency: fiatCurrency.toUpperCase(),
      amountFiat: parseFloat(fiatAmount) || 0,
      tokenPrice: parseFloat(tokenPrice) || 0,
    })

    if (!tx) {
      setLoading(false)
      setError('Failed to create transaction record. Please try again.')
      return false
    }

    currentTxRef.current = tx

    try {
      if (!sdkRef.current) {
        const moonPayInit = await loadMoonPay()
        if (moonPayInit) {
          sdkRef.current = moonPayInit({
            flow: 'buy',
            environment: MOONPAY_ENV,
            variant: 'overlay',
            params: {
              apiKey: MOONPAY_API_KEY,
              currencyCode: cryptoCurrency,
              baseCurrencyCode: fiatCurrency,
              baseCurrencyAmount: fiatAmount ? String(fiatAmount) : undefined,
              walletAddress: walletAddress,
              showWalletAddressForm: true,
              colorCode: '#00d4aa',
            },
            handlers: {
              async onTransactionCreated(props) {
                const localTx = currentTxRef.current
                if (localTx && props?.id) {
                  await updateTransaction(localTx.id, {
                    moonpayTransactionId: props.id,
                    moonpayStatus: props.status || 'waitingPayment',
                    status: 'pending',
                  })
                }
              },
              async onTransactionCompleted(props) {
                terminalReachedRef.current = true
                const localTx = currentTxRef.current
                if (localTx) {
                  await updateTransaction(localTx.id, {
                    moonpayStatus: 'completed',
                    moonpayTransactionId: props?.id || '',
                    amountCrypto: props?.quoteCurrencyAmount || 0,
                  })

                  let swapSuccess = true
                  if (localTx._tokenId) {
                    try {
                      const sig = await executeBuySwap({
                        tokenId: localTx._tokenId,
                        moonpayTxId: localTx.id,
                        updateToken: localTx.update_token,
                      })
                      if (sig) {
                        localTx._txSignature = sig
                        await updateTransaction(localTx.id, { txSignature: sig, status: 'completed' })
                      } else {
                        await updateTransaction(localTx.id, { status: 'completed' })
                      }
                    } catch (swapErr) {
                      swapSuccess = false
                      console.error('[MoonPay] Post-buy swap error:', swapErr.message)
                      const isRejected = swapErr?.message?.includes('User rejected')
                      await updateTransaction(localTx.id, { status: isRejected ? 'swap_rejected' : 'swap_failed' })
                      setError(isRejected ? 'Swap was cancelled' : 'Payment received but token swap failed: ' + swapErr.message)
                    }
                  } else {
                    await updateTransaction(localTx.id, { status: 'completed' })
                  }

                  setLoading(false)
                  setOnchainStep(null)
                  fetchTransactions()
                  if (swapSuccess) {
                    callbacksRef.current.onComplete?.(localTx)
                  } else {
                    callbacksRef.current.onClose?.()
                  }
                }
              },
              async onClose() {
                const txRef = currentTxRef.current
                if (txRef && !terminalReachedRef.current) {
                  await updateTransaction(txRef.id, { status: 'widget_closed' })
                }
                terminalReachedRef.current = false
                setLoading(false)
                setOnchainStep(null)
                fetchTransactions()
                callbacksRef.current.onClose?.()
              },
            },
          })
        }
      } else {
        sdkRef.current.updateConfig({
          params: {
            apiKey: MOONPAY_API_KEY,
            currencyCode: cryptoCurrency,
            baseCurrencyCode: fiatCurrency,
            baseCurrencyAmount: fiatAmount ? String(fiatAmount) : undefined,
            walletAddress: walletAddress,
            colorCode: '#00d4aa',
          },
        })
      }

      if (sdkRef.current) {
        currentTxRef.current._tokenId = tokenId || null
        currentTxRef.current._cryptoAmount = null
        sdkRef.current.show()
        if (tx) {
          await updateTransaction(tx.id, { status: 'widget_opened' })
        }
        return true
      } else {
        throw new Error('Failed to initialize MoonPay SDK')
      }
    } catch (e) {
      console.error('[MoonPay] SDK error:', e)
      setLoading(false)
      setOnchainStep(null)
      setError('MoonPay widget could not be loaded')
      if (tx) await updateTransaction(tx.id, { status: 'failed' })
      return false
    }
  }, [walletAddress, createTransaction, updateTransaction, fetchTransactions, executeBuySwap])

  const openSellWidget = useCallback(async ({ cryptoCurrency = 'sol', fiatCurrency = 'usd', cryptoAmount, tokenPrice, tokenId, onComplete, onClose }) => {
    if (!MOONPAY_API_KEY) {
      setError('MoonPay API key not configured')
      return false
    }

    setLoading(true)
    setError(null)
    terminalReachedRef.current = false
    callbacksRef.current = { onComplete, onClose }

    const tx = await createTransaction({
      cryptoCurrency,
      fiatCurrency: fiatCurrency.toUpperCase(),
      amountCrypto: parseFloat(cryptoAmount) || 0,
      type: 'sell',
      tokenPrice: parseFloat(tokenPrice) || 0,
    })

    if (!tx) {
      setLoading(false)
      setError('Failed to create transaction record. Please try again.')
      return false
    }

    currentTxRef.current = tx

    let transferSig = null
    if (tokenId) {
      try {
        transferSig = await executeSellTransfer({ tokenId, amount: cryptoAmount })
        if (transferSig) {
          await updateTransaction(tx.id, { txSignature: transferSig })
        }
      } catch (transferErr) {
        setLoading(false)
        setOnchainStep(null)
        const msg = transferErr?.message || 'Transfer failed'
        if (msg.includes('User rejected')) {
          setError(null)
          await updateTransaction(tx.id, { status: 'failed' })
          callbacksRef.current.onClose?.()
          return false
        }
        setError('Token transfer to vault failed: ' + msg)
        await updateTransaction(tx.id, { status: 'failed' })
        return false
      }
    }

    try {
      if (!sellSdkRef.current) {
        const moonPayInit = await loadMoonPay()
        if (moonPayInit) {
          sellSdkRef.current = moonPayInit({
            flow: 'sell',
            environment: MOONPAY_ENV,
            variant: 'overlay',
            params: {
              apiKey: MOONPAY_API_KEY,
              baseCurrencyCode: cryptoCurrency,
              quoteCurrencyCode: fiatCurrency,
              baseCurrencyAmount: cryptoAmount ? String(cryptoAmount) : undefined,
              walletAddress: walletAddress,
              colorCode: '#00d4aa',
            },
            handlers: {
              async onTransactionCreated(props) {
                const localTx = currentTxRef.current
                if (localTx && props?.id) {
                  await updateTransaction(localTx.id, {
                    moonpayTransactionId: props.id,
                    moonpayStatus: props.status || 'waitingPayment',
                    status: 'pending',
                  })
                }
              },
              async onTransactionCompleted(props) {
                terminalReachedRef.current = true
                const localTx = currentTxRef.current
                if (localTx) {
                  await updateTransaction(localTx.id, {
                    status: 'completed',
                    moonpayStatus: 'completed',
                    moonpayTransactionId: props?.id || '',
                    amountCrypto: props?.baseCurrencyAmount || 0,
                  })
                }
                setLoading(false)
                setOnchainStep(null)
                fetchTransactions()
                callbacksRef.current.onComplete?.(localTx)
              },
              async onClose() {
                const txRef = currentTxRef.current
                if (txRef && !terminalReachedRef.current) {
                  await updateTransaction(txRef.id, { status: 'widget_closed' })
                }
                terminalReachedRef.current = false
                setLoading(false)
                setOnchainStep(null)
                fetchTransactions()
                callbacksRef.current.onClose?.()
              },
            },
          })
        }
      } else {
        sellSdkRef.current.updateConfig({
          params: {
            apiKey: MOONPAY_API_KEY,
            baseCurrencyCode: cryptoCurrency,
            quoteCurrencyCode: fiatCurrency,
            baseCurrencyAmount: cryptoAmount ? String(cryptoAmount) : undefined,
            walletAddress: walletAddress,
            colorCode: '#00d4aa',
          },
        })
      }

      if (sellSdkRef.current) {
        sellSdkRef.current.show()
        if (tx) {
          await updateTransaction(tx.id, { status: 'widget_opened' })
        }
        return true
      } else {
        throw new Error('Failed to initialize MoonPay SDK')
      }
    } catch (e) {
      console.error('[MoonPay] Sell SDK error:', e)
      setLoading(false)
      setOnchainStep(null)
      setError('MoonPay widget could not be loaded')
      if (tx) await updateTransaction(tx.id, { status: 'failed' })
      return false
    }
  }, [walletAddress, createTransaction, updateTransaction, fetchTransactions, executeSellTransfer])

  useEffect(() => {
    if (!walletAddress) return
    fetchTransactions()
    const interval = setInterval(fetchTransactions, 30000)
    return () => clearInterval(interval)
  }, [walletAddress, fetchTransactions])

  return {
    openWidget,
    openSellWidget,
    loading,
    transactions,
    error,
    onchainStep,
    fetchTransactions,
    hasApiKey: !!MOONPAY_API_KEY,
    updateTransaction,
    executeBuySwap,
    executeSellTransfer,
  }
}
