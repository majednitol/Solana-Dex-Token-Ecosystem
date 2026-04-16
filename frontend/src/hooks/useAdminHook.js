import { useMemo } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useAdminStore } from '../stores/useAdminStore'

export function useAdmin() {
  const { connected, publicKey } = useWallet()
  const { ownerWallets, additionalAdmins, addAdmin, removeAdmin } = useAdminStore()

  const adminList = useMemo(() => [
    ...ownerWallets.map(w => ({ wallet: w, role: 'owner' })),
    ...additionalAdmins,
  ], [ownerWallets, additionalAdmins])

  const addr = connected && publicKey ? publicKey.toBase58() : null

  const isAdmin = useMemo(() => {
    if (!addr) return false
    return adminList.some(a => a.wallet === addr)
  }, [addr, adminList])

  const adminRole = useMemo(() => {
    if (!addr) return null
    const entry = adminList.find(a => a.wallet === addr)
    return entry ? entry.role : null
  }, [addr, adminList])

  return { isAdmin, adminRole, adminList, addAdmin, removeAdmin }
}
