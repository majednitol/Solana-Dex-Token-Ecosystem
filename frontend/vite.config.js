import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api/chart/stream': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        headers: { 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache'
            proxyRes.headers['x-accel-buffering'] = 'no'
          })
        },
      },
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/uploads': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      react: path.resolve('./node_modules/react'),
      'react-dom': path.resolve('./node_modules/react-dom'),
      'react-router-dom': path.resolve('./node_modules/react-router-dom'),
      buffer: 'buffer',
    },
    dedupe: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
  },
  define: {
    'global': 'globalThis',
    'import.meta.env.MOONPAY_API_KEY': JSON.stringify(process.env.VITE_MOONPAY_API_KEY || process.env.MOONPAY_API_KEY || ''),
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  build: {
    assetsDir: '_assets',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-solana': ['@solana/web3.js'],
          'vendor-wallet': ['@solana/wallet-adapter-react', '@solana/wallet-adapter-react-ui'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
    target: 'esnext',
    minify: 'esbuild',
  },
})
