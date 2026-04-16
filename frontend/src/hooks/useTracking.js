import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'

function getSessionId() {
  let id = sessionStorage.getItem('_sid')
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    sessionStorage.setItem('_sid', id)
  }
  return id
}

function detectSource() {
  const ref = document.referrer || ''
  if (!ref || ref.includes(window.location.origin)) return 'direct'
  if (/google|bing|yahoo|duckduckgo|baidu|yandex/i.test(ref)) return 'search'
  return 'direct'
}

function post(url, body) {
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})
  } catch (_) {}
}

export default function useTracking() {
  const { publicKey } = useWallet()
  const location = useLocation()
  const walletTracked = useRef(null)
  const lastPage = useRef(null)

  useEffect(() => {
    if (publicKey) {
      const addr = publicKey.toBase58()
      if (walletTracked.current !== addr) {
        walletTracked.current = addr
        post('/api/track/wallet', { wallet: addr })
      }
    }
  }, [publicKey])

  useEffect(() => {
    const page = location.pathname
    if (page === lastPage.current) return
    lastPage.current = page

    post('/api/track/visit', {
      sessionId: getSessionId(),
      wallet: publicKey ? publicKey.toBase58() : '',
      page,
      source: detectSource(),
    })
  }, [location.pathname, publicKey])
}
