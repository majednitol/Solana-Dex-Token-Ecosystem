import { create } from 'zustand'

const useTokenPriceStore = create((set, get) => ({
  prices: {},
  poolPricesLoaded: false,
  _realPriceIds: new Set(),

  syncPoolPrices: (poolPrices) => {
    if (!poolPrices || Object.keys(poolPrices).length === 0) {
      set({ poolPricesLoaded: true })
      return
    }
    const realPriceIds = get()._realPriceIds
    Object.keys(poolPrices).forEach(id => realPriceIds.add(id))
    set((state) => ({
      prices: { ...state.prices, ...poolPrices },
      poolPricesLoaded: true,
    }))
  },

  syncOraclePrices: (oraclePrices) => {
    if (!oraclePrices || Object.keys(oraclePrices).length === 0) return
    const realPriceIds = get()._realPriceIds
    const current = get().prices
    const merged = { ...current }
    for (const [id, price] of Object.entries(oraclePrices)) {
      if (!current[id] || !realPriceIds.has(id)) {
        merged[id] = price
      }
      realPriceIds.add(id)
    }
    set({ prices: merged })
  },

  updateTokenPrice: (id, price) => {
    get()._realPriceIds.add(id)
    set((state) => ({
      prices: { ...state.prices, [id]: price },
    }))
  },

  getTokenPrice: (id) => get().prices[id] ?? 0,

  hasRealPrice: (id) => get()._realPriceIds.has(id),
}))

export { useTokenPriceStore }
export const useTokenPrice = () => useTokenPriceStore()
