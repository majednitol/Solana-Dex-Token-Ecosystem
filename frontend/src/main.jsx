import { Buffer } from 'buffer'
window.Buffer = Buffer

import { initMints } from './data/mints'
initMints()

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WalletProvider from './components/WalletProvider'
import App from './App'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <App />
        </WalletProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)
