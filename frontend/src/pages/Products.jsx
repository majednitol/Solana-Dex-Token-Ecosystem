import { ArrowLeftRight, TrendingUp, Droplets, BarChart3, Code2, Building2 } from 'lucide-react'

function Products() {
  const products = [
    { name: 'Swap', desc: 'Instant token swaps across multiple DEXs with the best rates and lowest slippage.', status: 'Live', icon: <ArrowLeftRight size={32} /> },
    { name: 'Staking', desc: 'Earn rewards by staking your tokens across supported Proof of Stake networks.', status: 'Live', icon: <TrendingUp size={32} /> },
    { name: 'Liquid Staking', desc: 'Stake tokens while maintaining liquidity through derivative tokens.', status: 'Beta', icon: <Droplets size={32} /> },
    { name: 'Analytics', desc: 'Advanced market analytics, portfolio tracking, and performance insights.', status: 'Live', icon: <BarChart3 size={32} /> },
    { name: 'Data API', desc: 'Developer-friendly API access for real-time market data and swap execution.', status: 'Live', icon: <Code2 size={32} /> },
    { name: 'Treasury Management', desc: 'Institutional-grade tools for managing multi-sig treasury wallets and pools.', status: 'Coming Soon', icon: <Building2 size={32} /> },
  ]

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Products</h1>
        <p>Explore the full suite of Cryptonite DeFi tools</p>
      </div>

      <div className="grid-3">
        {products.map((product) => (
          <div className="info-card" key={product.name} style={{ cursor: 'pointer' }}>
            <div style={{ marginBottom: '12px', color: 'var(--accent-purple)' }}>{product.icon}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <h3>{product.name}</h3>
              <span
                className="stat-badge"
                style={{
                  background: product.status === 'Live' ? 'var(--accent-green)' :
                    product.status === 'Beta' ? 'var(--accent-yellow)' : 'var(--bg-surface)',
                  color: product.status === 'Coming Soon' ? 'var(--text-secondary)' : '#000',
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                }}
              >
                {product.status}
              </span>
            </div>
            <p>{product.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Products
