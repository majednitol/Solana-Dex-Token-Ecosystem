import { useQuery } from '@tanstack/react-query'

export const GLOBAL_MARKET_QUERY_KEY = ['globalMarket']

async function fetchPlatformStats() {
  const res = await fetch('/api/platform/stats')
  if (!res.ok) throw new Error(`API returned ${res.status}`)
  return res.json()
}

export function useGlobalMarketQuery() {
  return useQuery({
    queryKey: GLOBAL_MARKET_QUERY_KEY,
    queryFn: fetchPlatformStats,
    staleTime: 120_000,
    refetchInterval: 120_000,
  })
}
