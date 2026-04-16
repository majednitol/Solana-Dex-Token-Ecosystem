import { create } from 'zustand'

const CURRENCIES = {
  usd: { code: 'USD', symbol: '$', rate: 1.00 },
  eur: { code: 'EUR', symbol: '\u20ac', rate: 0.92 },
  gbp: { code: 'GBP', symbol: '\u00a3', rate: 0.79 },
  cad: { code: 'CAD', symbol: 'CA$', rate: 1.36 },
  jpy: { code: 'JPY', symbol: '\u00a5', rate: 149.50 },
}

const useCurrencyStore = create((set, get) => ({
  currencyKey: 'usd',
  currency: CURRENCIES.usd,
  currencies: CURRENCIES,
  setCurrencyKey: (key) => set({ currencyKey: key, currency: CURRENCIES[key] }),
  convert: (usdAmount) => usdAmount * get().currency.rate,
  formatPrice: (usdPrice) => {
    const { currency } = get()
    const converted = usdPrice * currency.rate
    const sym = currency.symbol
    if (currency.code === 'JPY') {
      if (converted >= 1e12) return `${sym}${(converted / 1e12).toFixed(2)}T`
      if (converted >= 1e9) return `${sym}${(converted / 1e9).toFixed(2)}B`
      if (converted >= 1e6) return `${sym}${(converted / 1e6).toFixed(2)}M`
      if (converted >= 1000) return `${sym}${Math.round(converted).toLocaleString()}`
      return `${sym}${Math.round(converted).toLocaleString()}`
    }
    if (converted >= 1000) return `${sym}${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    if (converted >= 1) return `${sym}${converted.toFixed(2)}`
    return `${sym}${converted.toFixed(6)}`
  },
  formatLargeNumber: (usdAmount) => {
    if (usdAmount == null || !Number.isFinite(usdAmount)) return '-'
    if (usdAmount === 0) return `${get().currency.symbol}0.00`
    const { currency } = get()
    const converted = usdAmount * currency.rate
    const sym = currency.symbol
    if (converted >= 1e12) return `${sym}${(converted / 1e12).toFixed(2)}T`
    if (converted >= 1e9) return `${sym}${(converted / 1e9).toFixed(2)}B`
    if (converted >= 1e6) return `${sym}${(converted / 1e6).toFixed(2)}M`
    if (converted >= 1e3) return `${sym}${(converted / 1e3).toFixed(2)}K`
    return `${sym}${converted.toLocaleString()}`
  },
}))

export { useCurrencyStore }
export const useCurrency = () => useCurrencyStore()
