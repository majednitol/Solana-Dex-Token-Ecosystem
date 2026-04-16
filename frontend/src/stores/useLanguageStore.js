import { create } from 'zustand'
import translations from '../translations'

const useLanguageStore = create((set, get) => ({
  language: localStorage.getItem('cryptonite-language') || 'en',
  setLanguage: (lang) => {
    localStorage.setItem('cryptonite-language', lang)
    set({ language: lang })
  },
  t: (key) => {
    const lang = get().language
    const langData = translations[lang] || translations.en
    return langData[key] || translations.en[key] || key
  },
}))

export { useLanguageStore }
export const useLanguage = () => useLanguageStore()
