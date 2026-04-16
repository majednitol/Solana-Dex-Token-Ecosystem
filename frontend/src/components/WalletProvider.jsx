import { useMemo } from 'react'
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter-react'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import { clusterApiUrl } from '@solana/web3.js'

const NETWORK_ENV = (import.meta.env.VITE_SOLANA_NETWORK || 'mainnet').toLowerCase()

function WalletProvider({ children }) {
  const network = NETWORK_ENV === 'mainnet'
    ? WalletAdapterNetwork.Mainnet
    : WalletAdapterNetwork.Devnet

  const endpoint = useMemo(() => {
    const customRpc = import.meta.env.VITE_SOLANA_RPC_URL
    if (customRpc && customRpc.trim()) return customRpc.trim()
    return clusterApiUrl(network)
  }, [network])

  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
  ], [])

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        {children}
      </SolanaWalletProvider>
    </ConnectionProvider>
  )
}

export default WalletProvider
