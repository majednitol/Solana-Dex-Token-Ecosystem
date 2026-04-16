import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export const REFERRAL_DATA_QUERY_KEY = ['referralData']

async function fetchReferralData(wallet) {
  if (!wallet) return null
  const [codeRes, statsRes, configRes] = await Promise.all([
    fetch(`/api/referral/code?wallet=${wallet}`),
    fetch(`/api/referral/stats?wallet=${wallet}`),
    fetch('/api/referral/config'),
  ])
  const [codeData, statsData, configData] = await Promise.all([codeRes.json(), statsRes.json(), configRes.json()])
  return {
    code: codeData.ok ? codeData.code : '',
    stats: statsData.ok ? statsData : null,
    config: configData.ok ? configData.config : null,
  }
}

export function useReferralQuery(wallet, enabled = true) {
  return useQuery({
    queryKey: [...REFERRAL_DATA_QUERY_KEY, wallet || ''],
    queryFn: () => fetchReferralData(wallet),
    staleTime: 30_000,
    enabled: enabled && !!wallet,
  })
}

export const ADMIN_REFERRAL_CONFIG_QUERY_KEY = ['adminReferralConfig']

async function fetchAdminReferralConfig(wallet) {
  const [configRes, proposalsRes] = await Promise.all([
    fetch(`/api/admin/referral-config?wallet=${wallet || ''}`),
    fetch(`/api/admin/referral-config/proposals?wallet=${wallet || ''}`),
  ])
  const [configData, proposalsData] = await Promise.all([configRes.json(), proposalsRes.json()])
  return {
    config: configData.ok ? configData.config : null,
    stats: configData.ok ? configData.stats : null,
    proposals: proposalsData.ok ? (proposalsData.proposals || []) : [],
  }
}

export function useAdminReferralConfigQuery(wallet, enabled = true) {
  return useQuery({
    queryKey: [...ADMIN_REFERRAL_CONFIG_QUERY_KEY, wallet || ''],
    queryFn: () => fetchAdminReferralConfig(wallet),
    staleTime: 30_000,
    enabled,
  })
}

export const REFERRAL_STATS_QUERY_KEY = ['referralStats']

export function useReferralStatsQuery(wallet, enabled = true) {
  return useQuery({
    queryKey: [...REFERRAL_STATS_QUERY_KEY, wallet || ''],
    queryFn: async () => {
      if (!wallet) return null
      const res = await fetch(`/api/referral/stats?wallet=${wallet}`)
      const data = await res.json()
      return data.ok ? data : null
    },
    staleTime: 30_000,
    enabled: enabled && !!wallet,
  })
}

export function useInvalidateReferralStats() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: REFERRAL_STATS_QUERY_KEY })
  }, [queryClient])
}

export function useInvalidateReferralData() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: REFERRAL_DATA_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: REFERRAL_STATS_QUERY_KEY })
  }, [queryClient])
}

export function useInvalidateAdminReferralConfig() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ADMIN_REFERRAL_CONFIG_QUERY_KEY })
  }, [queryClient])
}
