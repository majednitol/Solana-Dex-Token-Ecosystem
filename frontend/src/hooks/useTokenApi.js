import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

export default function useTokenApi() {
  const { connected, publicKey } = useWallet()
  const [apiTokenData, setApiTokenData] = useState({})

  useEffect(() => {
    const ownerParam = connected && publicKey ? publicKey.toBase58() : ''
    const url = ownerParam ? `/api/tokens?owner=${ownerParam}` : '/api/tokens'

    fetch(url)
      .then(r => r.json())
      .then(async (data) => {
        if (!data.ok || !data.tokens) return
        const mapped = {}
        for (const tk of data.tokens) {
          const key = tk.key?.toLowerCase() || tk.symbol.toLowerCase()
          mapped[key] = { name: tk.name, symbol: tk.symbol, uri: tk.uri, image: null }
        }

        const uriEntries = data.tokens.filter(tk => tk.uri)
        const imageResults = await Promise.allSettled(
          uriEntries.map(tk =>
            fetch(tk.uri)
              .then(r => r.json())
              .then(json => ({ key: tk.key?.toLowerCase() || tk.symbol.toLowerCase(), image: json.image || null }))
          )
        )
        for (const result of imageResults) {
          if (result.status === 'fulfilled' && result.value.image) {
            mapped[result.value.key].image = result.value.image
          }
        }

        setApiTokenData(mapped)
      })
      .catch(() => {})
  }, [connected, publicKey])

  const getApiName = useCallback((tokenId) => {
    const data = apiTokenData[tokenId?.toLowerCase()]
    return data?.name || null
  }, [apiTokenData])

  const getApiImage = useCallback((tokenId) => {
    const data = apiTokenData[tokenId?.toLowerCase()]
    return data?.image || null
  }, [apiTokenData])

  return { apiTokenData, getApiName, getApiImage }
}
