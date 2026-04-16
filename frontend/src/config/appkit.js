////appkit.js
let appkitInstance = null
let initPromise = null

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'ddf61e6174a49e12bbfa6b8fab0eabbb'

const metadata = {
  name: 'Niteswap Token Platform',
  description: 'Buy NTC, ASDC, and other tokens with crypto',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://cryptoniteswap.xyz',
  icons: ['/favicon.ico']
}

async function initAppKit() {
  if (appkitInstance) return appkitInstance
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      const { createAppKit } = await import('@reown/appkit')
      const { WagmiAdapter } = await import('@reown/appkit-adapter-wagmi')
      const networks = await import('@reown/appkit/networks')

      const evmNetworks = [
        networks.mainnet, networks.bsc, networks.polygon,
        networks.arbitrum, networks.optimism, networks.base, networks.avalanche,
      ]

      const wagmiAdapter = new WagmiAdapter({
        projectId,
        networks: evmNetworks,
      })

      // Only EVM adapters — SOL is handled by Phantom directly
      appkitInstance = createAppKit({
        adapters: [wagmiAdapter],
        networks: evmNetworks,
        projectId,
        metadata,
        features: {
          analytics: false,
          email: false,
          socials: false,
        },
        themeMode: 'dark',
      })

      return appkitInstance
    } catch (e) {
      console.error('[AppKit] Failed to initialize:', e)
      initPromise = null
      return null
    }
  })()

  return initPromise
}

/**
 * Reset WalletConnect / AppKit state so the wallet selection modal
 * always starts fresh (no remembered wallet from previous payment).
 */
async function resetAppKit() {
  try {
    const kit = appkitInstance
    if (!kit) return
    // Disconnect any active session
    if (kit.disconnect) {
      await kit.disconnect().catch(() => {})
    }
    // Close modal if open
    if (kit.close) {
      await kit.close().catch(() => {})
    }
  } catch (e) {
    console.warn('[AppKit] resetAppKit error:', e.message)
  }
}

export { initAppKit, resetAppKit, projectId, metadata }
