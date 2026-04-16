import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export const POOL_RESERVES_QUERY_KEY = ['poolReserves']

async function fetchPoolReserves(tokenASymbol, tokenBSymbol) {
  if (!tokenASymbol || !tokenBSymbol) return null
  const res = await fetch(`/api/pools?tokenA=${tokenASymbol}&tokenB=${tokenBSymbol}`)
  if (res.status === 429 || res.status >= 500) throw new Error('Server error')
  const data = await res.json()
  if (data.ok && data.reserves) {
    return { reserves: data.reserves, pairSymbol: tokenBSymbol }
  }
  return null
}

export function usePoolReservesQuery(tokenASymbol, tokenBSymbol, enabled = true) {
  return useQuery({
    queryKey: [...POOL_RESERVES_QUERY_KEY, tokenASymbol || '', tokenBSymbol || ''],
    queryFn: () => fetchPoolReserves(tokenASymbol, tokenBSymbol),
    staleTime: 15_000,
    enabled: enabled && !!tokenASymbol && !!tokenBSymbol,
    retry: 3,
    retryDelay: (attempt) => Math.min(2000 * Math.pow(2, attempt), 8000),
  })
}

export function useInvalidatePoolReserves() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: POOL_RESERVES_QUERY_KEY })
  }, [queryClient])
}
