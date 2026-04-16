import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export const SWAP_LIMITS_QUERY_KEY = ['swapLimits']

async function fetchSwapLimits(wallet) {
  if (!wallet) return null
  const res = await fetch(`/api/swap/limits?wallet=${wallet}`)
  if (!res.ok) throw new Error(`API returned ${res.status}`)
  const data = await res.json()
  if (data.ok) return { daily: data.daily, monthly: data.monthly }
  return null
}

export function useSwapLimitsQuery(wallet, enabled = true) {
  return useQuery({
    queryKey: [...SWAP_LIMITS_QUERY_KEY, wallet || ''],
    queryFn: () => fetchSwapLimits(wallet),
    staleTime: 30_000,
    enabled: enabled && !!wallet,
  })
}

export const ADMIN_SWAP_LIMITS_QUERY_KEY = ['adminSwapLimits']

async function fetchAdminSwapLimits(wallet) {
  const [limitsRes, proposalsRes] = await Promise.all([
    fetch(`/api/admin/swap-limits?wallet=${wallet || ''}`),
    fetch(`/api/admin/swap-limits/proposals?wallet=${wallet || ''}`),
  ])
  const [limitsData, proposalsData] = await Promise.all([limitsRes.json(), proposalsRes.json()])
  return {
    limits: limitsData.ok ? limitsData.limits : null,
    proposals: proposalsData.ok ? (proposalsData.proposals || []) : [],
  }
}

export function useAdminSwapLimitsQuery(wallet, enabled = true) {
  return useQuery({
    queryKey: [...ADMIN_SWAP_LIMITS_QUERY_KEY, wallet || ''],
    queryFn: () => fetchAdminSwapLimits(wallet),
    staleTime: 30_000,
    enabled,
  })
}

export function useInvalidateAdminSwapLimits() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ADMIN_SWAP_LIMITS_QUERY_KEY })
  }, [queryClient])
}

export function useInvalidateSwapLimits() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: SWAP_LIMITS_QUERY_KEY })
  }, [queryClient])
}
