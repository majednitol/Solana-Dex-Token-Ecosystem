import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import BASE_TOKENS from '../../data/tokens'

export const TOKEN_LIST_QUERY_KEY = ['tokenList']

async function fetchTokenList() {
  const res = await fetch('/api/tokens')
  if (!res.ok) throw new Error(`API returned ${res.status}`)
  const data = await res.json()
  if (!data.ok || !Array.isArray(data.tokens)) throw new Error('Invalid token list response')
  const onChainMap = new Map()
  for (const t of data.tokens) {
    const id = (t.key || t.symbol).toLowerCase()
    onChainMap.set(id, t)
  }
  return BASE_TOKENS.map(base => {
    const chain = onChainMap.get(base.id)
    if (chain) {
      return {
        ...base,
        fullName: chain.name,
        mint: chain.mint,
        decimals: chain.decimals,
        uri: chain.uri,
        treasuryAta: chain.treasuryAta,
        onChain: true,
      }
    }
    return { ...base, onChain: false }
  })
}

export function useTokenListQuery() {
  const query = useQuery({
    queryKey: TOKEN_LIST_QUERY_KEY,
    queryFn: fetchTokenList,
    staleTime: 60_000,
    placeholderData: BASE_TOKENS,
  })

  const tokens = query.data && query.data.length > 0 ? query.data : BASE_TOKENS

  return {
    tokens,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useInvalidateTokenList() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: TOKEN_LIST_QUERY_KEY })
  }, [queryClient])
}
