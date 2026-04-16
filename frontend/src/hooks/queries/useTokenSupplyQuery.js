import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export const TOKEN_SUPPLY_QUERY_KEY = ['tokenSupply']

async function fetchTokenSupply() {
  const res = await fetch('/api/admin/tokens')
  if (!res.ok) throw new Error(`API returned ${res.status}`)
  return res.json()
}

export function useTokenSupplyQuery() {
  return useQuery({
    queryKey: TOKEN_SUPPLY_QUERY_KEY,
    queryFn: fetchTokenSupply,
    staleTime: 60_000,
  })
}

export function useInvalidateTokenSupply() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: TOKEN_SUPPLY_QUERY_KEY })
  }, [queryClient])
}
