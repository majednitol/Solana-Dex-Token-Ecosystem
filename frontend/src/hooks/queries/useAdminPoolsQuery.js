import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export const ADMIN_POOLS_QUERY_KEY = ['adminPools']

async function fetchAdminPools() {
  const res = await fetch('/api/admin/pools')
  if (!res.ok) throw new Error(`API returned ${res.status}`)
  const data = await res.json()
  if (data.ok && Array.isArray(data.pools)) return data.pools
  return []
}

export function useAdminPoolsQuery(options = {}) {
  return useQuery({
    queryKey: ADMIN_POOLS_QUERY_KEY,
    queryFn: fetchAdminPools,
    staleTime: 30_000,
    ...options,
  })
}

export function useInvalidateAdminPools() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ADMIN_POOLS_QUERY_KEY })
  }, [queryClient])
}
