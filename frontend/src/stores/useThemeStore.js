import { create } from 'zustand'

const useThemeStore = create((set) => ({
  theme: localStorage.getItem('cryptonite-theme') || 'dark-purple',
  setTheme: (theme) => {
    localStorage.setItem('cryptonite-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },
}))

const initTheme = useThemeStore.getState().theme
document.documentElement.setAttribute('data-theme', initTheme)

export { useThemeStore }
export const useTheme = () => useThemeStore()
