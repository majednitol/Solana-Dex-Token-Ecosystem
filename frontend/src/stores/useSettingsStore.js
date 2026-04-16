import { create } from 'zustand'

function safeParse(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return fallback
    return JSON.parse(v)
  } catch { return fallback }
}

const useSettingsStore = create((set) => ({
  expertMode: safeParse('cryptonite-expert-mode', false),
  showConfirmation: safeParse('cryptonite-show-confirmation', true),
  setExpertMode: (val) => {
    localStorage.setItem('cryptonite-expert-mode', JSON.stringify(val))
    set({ expertMode: val })
  },
  setShowConfirmation: (val) => {
    localStorage.setItem('cryptonite-show-confirmation', JSON.stringify(val))
    set({ showConfirmation: val })
  },
}))

export { useSettingsStore }
export const useSettings = () => useSettingsStore()
