import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export const TREASURY_DATA_QUERY_KEY = ['treasuryData']

async function fetchTreasuryData(wallet) {
  const [stateRes, balancesRes, feesRes, ownersRes, walletsRes, proposalsRes] = await Promise.all([
    fetch('/api/admin/squads/state'),
    fetch('/api/admin/squads/vault-balances'),
    fetch('/api/treasury/fees/history?limit=50'),
    fetch('/api/admin/multisig-owners'),
    fetch('/api/admin/treasury/wallets'),
    fetch(`/api/admin/squads/proposals?wallet=${wallet || ''}`),
  ])
  const [stateData, balancesData, feesData, ownersData, walletsData, proposalsData] = await Promise.all([
    stateRes.json(),
    balancesRes.json(),
    feesRes.json(),
    ownersRes.json(),
    walletsRes.json(),
    proposalsRes.json(),
  ])
  return { stateData, balancesData, feesData, ownersData, walletsData, proposalsData }
}

export function useTreasuryDataQuery(wallet, enabled = true) {
  return useQuery({
    queryKey: [...TREASURY_DATA_QUERY_KEY, wallet || ''],
    queryFn: () => fetchTreasuryData(wallet),
    staleTime: 30_000,
    enabled,
  })
}

export function useInvalidateTreasuryData() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: TREASURY_DATA_QUERY_KEY })
  }, [queryClient])
}
