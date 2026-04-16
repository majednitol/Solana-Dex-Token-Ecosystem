import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import TOKENS from '../../data/tokens'

export const ORACLE_PRICES_QUERY_KEY = ['oraclePrices']

async function fetchOraclePrices() {
  try {
    const res = await fetch('/api/oracle/prices')
    const data = await res.json()
    if (!data.ok || !Array.isArray(data.prices)) return {}

    const priceMap = {}
    for (const row of data.prices) {
      const token = TOKENS.find(t => t.symbol === row.token_symbol)
      if (token && row.price > 0) {
        priceMap[token.id] = row.price
      }
    }
    return priceMap
  } catch {
    return {}
  }
}

export function useOraclePricesQuery() {
  const query = useQuery({
    queryKey: ORACLE_PRICES_QUERY_KEY,
    queryFn: fetchOraclePrices,
    staleTime: 15_000,
    refetchInterval: 60_000,
  })

  return {
    oraclePrices: query.data || {},
    oraclePricesLoaded: !query.isLoading,
    loading: query.isLoading,
  }
}

export function useInvalidateOraclePrices() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ORACLE_PRICES_QUERY_KEY })
  }, [queryClient])
}
