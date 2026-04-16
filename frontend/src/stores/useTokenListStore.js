import { create } from 'zustand'
import BASE_TOKENS from '../data/tokens'

const useTokenListStore = create((set) => ({
  registryTokens: [],
  loading: true,

  setTokens: (tokens) => {
    set({ registryTokens: tokens, loading: false })
  },

  setLoading: (loading) => {
    set({ loading })
  },
}))

export { useTokenListStore }
export function useTokenList() {
  const store = useTokenListStore()
  return {
    tokens: store.registryTokens.length > 0 ? store.registryTokens : BASE_TOKENS,
    loading: store.loading,
  }
}
