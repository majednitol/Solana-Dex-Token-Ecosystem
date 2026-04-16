import { useQuery } from '@tanstack/react-query'

export const SWAP_QUOTE_QUERY_KEY = ['swapQuote']

async function fetchSwapQuote(mintIn, mintOut, rawAmount, owner) {
  if (!mintIn || !mintOut || !rawAmount) return null
  const ownerParam = owner ? `&owner=${owner}` : ''
  const res = await fetch(`/api/quote?mintIn=${mintIn}&mintOut=${mintOut}&amountIn=${rawAmount}${ownerParam}`)
  const data = await res.json()
  if (data.ok && data.quote?.quote?.tokenMinOutNet) {
    return data.quote
  }
  return null
}

export function useSwapQuoteQuery(mintIn, mintOut, rawAmount, owner, enabled = true) {
  return useQuery({
    queryKey: [...SWAP_QUOTE_QUERY_KEY, mintIn || '', mintOut || '', rawAmount || '', owner || ''],
    queryFn: () => fetchSwapQuote(mintIn, mintOut, rawAmount, owner),
    staleTime: 10_000,
    enabled: enabled && !!mintIn && !!mintOut && !!rawAmount,
    retry: false,
  })
}
