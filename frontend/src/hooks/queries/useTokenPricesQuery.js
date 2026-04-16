import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export const ADMIN_TOKEN_PRICES_QUERY_KEY = ['adminTokenPrices']

async function fetchAdminTokenPrices(wallet) {
  const res = await fetch(`/api/admin/token-prices?wallet=${wallet || ''}`)
  const data = await res.json()
  return {
    prices: data.ok ? (data.prices || []) : [],
    proposals: data.ok ? (data.proposals || []) : [],
  }
}

export function useAdminTokenPricesQuery(wallet, enabled = true) {
  return useQuery({
    queryKey: [...ADMIN_TOKEN_PRICES_QUERY_KEY, wallet || ''],
    queryFn: () => fetchAdminTokenPrices(wallet),
    staleTime: 30_000,
    enabled,
  })
}

export function useInvalidateAdminTokenPrices() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ADMIN_TOKEN_PRICES_QUERY_KEY })
  }, [queryClient])
}
