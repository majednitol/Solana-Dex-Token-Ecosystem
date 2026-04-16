import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export const SETUP_STATUS_QUERY_KEY = ['setupStatus']

async function fetchSetupStatus() {
  const res = await fetch('/api/admin/setup/status')
  if (!res.ok) throw new Error(`API returned ${res.status}`)
  return res.json()
}

export function useSetupStatusQuery(enabled = true) {
  return useQuery({
    queryKey: SETUP_STATUS_QUERY_KEY,
    queryFn: fetchSetupStatus,
    staleTime: 30_000,
    enabled,
  })
}

export function useInvalidateSetupStatus() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: SETUP_STATUS_QUERY_KEY })
  }, [queryClient])
}
