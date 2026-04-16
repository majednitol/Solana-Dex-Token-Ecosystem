import { create } from 'zustand'

const loadSaved = () => {
  try {
    const stored = localStorage.getItem('watchlist')
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

const useWatchlistStore = create((set, get) => ({
  savedTokens: loadSaved(),
  toggleToken: (tokenId) => {
    const prev = get().savedTokens
    const next = prev.includes(tokenId)
      ? prev.filter(id => id !== tokenId)
      : [...prev, tokenId]
    localStorage.setItem('watchlist', JSON.stringify(next))
    set({ savedTokens: next })
  },
  isSaved: (tokenId) => get().savedTokens.includes(tokenId),
}))

export { useWatchlistStore }
export const useWatchlist = () => useWatchlistStore()
