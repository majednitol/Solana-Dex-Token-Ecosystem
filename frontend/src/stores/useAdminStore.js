import { create } from 'zustand'

async function apiFetch(path, options = {}) {
  const wallet = window.__adminWalletAddress || ''
  const headers = {
    'x-wallet-address': wallet,
    ...(options.headers || {}),
  }
  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(path, {
    ...options,
    headers,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

const useAdminStore = create((set, get) => ({
  ownerWallets: [],
  additionalAdmins: [],
  adminsLoaded: false,

  setOwnerWallets: (owners) => {
    set({ ownerWallets: owners })
  },

  getAdminList: () => {
    const { ownerWallets, additionalAdmins } = get()
    return [
      ...ownerWallets.map(w => ({ wallet: w, role: 'owner' })),
      ...additionalAdmins,
    ]
  },

  loadAdminsFromApi: async () => {
    try {
      const data = await apiFetch('/api/admin/wallets')
      if (data.ok && Array.isArray(data.wallets)) {
        set({ additionalAdmins: data.wallets, adminsLoaded: true })
        return
      }
    } catch (e) {
      console.warn('[AdminStore] Failed to load admin wallets from API:', e.message)
    }
    set({ adminsLoaded: true })
  },

  addAdmin: async (wallet, role) => {
    const list = get().getAdminList()
    if (!wallet || list.some(a => a.wallet === wallet)) return
    if (role === 'owner') {
      const next = [...get().ownerWallets, wallet]
      set({ ownerWallets: next })
      return
    }
    try {
      const data = await apiFetch('/api/admin/wallets', {
        method: 'POST',
        body: JSON.stringify({ wallet, role }),
      })
      if (data.ok) {
        const canonicalRole = data.wallet ? data.wallet.role : role
        const next = [...get().additionalAdmins, { wallet, role: canonicalRole }]
        set({ additionalAdmins: next })
      }
    } catch (e) {
      console.error('[AdminStore] Failed to add admin:', e.message)
      throw e
    }
  },

  removeAdmin: async (wallet) => {
    const { ownerWallets, additionalAdmins } = get()
    if (ownerWallets.includes(wallet)) {
      if (ownerWallets.length <= 1) return
      const next = ownerWallets.filter(w => w !== wallet)
      set({ ownerWallets: next })
      return
    }
    try {
      const data = await apiFetch(`/api/admin/wallets/${encodeURIComponent(wallet)}`, {
        method: 'DELETE',
      })
      if (data.ok) {
        const next = additionalAdmins.filter(a => a.wallet !== wallet)
        set({ additionalAdmins: next })
      }
    } catch (e) {
      console.error('[AdminStore] Failed to remove admin:', e.message)
      throw e
    }
  },

  clearAdditionalAdmins: () => {
    set({ additionalAdmins: [] })
  },
}))

export { useAdminStore }
