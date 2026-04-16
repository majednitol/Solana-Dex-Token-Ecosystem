import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import TOKENS from '../../data/tokens'

export const POOL_PRICES_QUERY_KEY = ['poolPrices']

async function fetchPoolPrices() {
  let dbPools = []
  try {
    const dbRes = await fetch('/api/admin/pools')
    const dbData = await dbRes.json()
    if (dbData.ok && Array.isArray(dbData.pools)) {
      dbPools = dbData.pools.filter(p => p.pool_address)
    }
  } catch {}

  if (dbPools.length === 0) return {}

  const fetched = {}
  for (const pool of dbPools) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt))
        const poolAddrParam = pool.pool_address ? `&poolAddress=${pool.pool_address}` : ''
        const res = await fetch(`/api/pools?tokenA=${pool.token_a_symbol}&tokenB=${pool.token_b_symbol}${poolAddrParam}`)
        if (res.status === 429) continue
        const data = await res.json()
        if (data.ok && typeof data.price === 'number' && data.price > 0) {
          const tokenB = TOKENS.find(t => t.symbol === pool.token_b_symbol)
          if (tokenB) {
            fetched[tokenB.id] = data.price
          }
          const tokenA = TOKENS.find(t => t.symbol === pool.token_a_symbol)
          if (tokenA && data.price > 0) {
            fetched[tokenA.id] = 1 / data.price
          }
        }
        break
      } catch {}
    }
    await new Promise(r => setTimeout(r, 500))
  }

  return fetched
}

export function usePoolPricesQuery() {
  const query = useQuery({
    queryKey: POOL_PRICES_QUERY_KEY,
    queryFn: fetchPoolPrices,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  return {
    poolPrices: query.data || {},
    poolPricesLoaded: !query.isLoading,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useInvalidatePoolPrices() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: POOL_PRICES_QUERY_KEY })
  }, [queryClient])
}
