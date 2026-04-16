import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export const ADMIN_OWNERS_QUERY_KEY = ['adminOwners']

async function fetchAdminOwners() {
  const res = await fetch('/api/treasury/multisig')
  if (!res.ok) throw new Error(`API returned ${res.status}`)
  const data = await res.json()
  const owners = data.owners
    || (data.members ? data.members.map(m => m.key || m) : null)
  if (owners && owners.length > 0) {
    localStorage.setItem('adminOwnerWallets', JSON.stringify(owners))
    return owners
  }
  throw new Error('No owners found')
}

function loadCachedOwners() {
  try {
    return JSON.parse(localStorage.getItem('adminOwnerWallets') || 'null') || []
  } catch { return [] }
}

export function useAdminOwnersQuery() {
  const query = useQuery({
    queryKey: ADMIN_OWNERS_QUERY_KEY,
    queryFn: fetchAdminOwners,
    staleTime: 300_000,
    placeholderData: loadCachedOwners(),
    retry: 1,
  })

  return {
    ownerWallets: query.data || loadCachedOwners(),
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useInvalidateAdminOwners() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ADMIN_OWNERS_QUERY_KEY })
  }, [queryClient])
}
