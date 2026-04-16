const exchanges = [
  { name: 'Raydium', type: 'DEX - Solana', volume: '$892.4M', trust: 'high', color: '#4fc3f7' },
  { name: 'Jupiter', type: 'DEX Aggregator - Solana', volume: '$1.2B', trust: 'high', color: '#00d68f' },
  { name: 'Orca', type: 'DEX - Solana', volume: '$345.6M', trust: 'high', color: '#f5f5f5' },
  { name: 'Meteora', type: 'DEX - Solana', volume: '$234.5M', trust: 'high', color: '#ff9800' },
  { name: 'Pump.fun', type: 'Launchpad - Solana', volume: '$567.8M', trust: 'medium', color: '#e91e63' },
  { name: 'Raydium CPMM', type: 'AMM - Solana', volume: '$156.3M', trust: 'high', color: '#4fc3f7' },
  { name: 'Moonshot', type: 'DEX - Solana', volume: '$89.2M', trust: 'medium', color: '#ffd700' },
  { name: 'Believe', type: 'DEX - Solana', volume: '$45.1M', trust: 'medium', color: '#a855f7' },
]

function Exchanges() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Exchanges</h1>
        <p>Supported decentralised exchanges on Solana and other networks</p>
      </div>

      <div className="grid-3">
        <div className="info-card">
          <h3>Total Exchanges</h3>
          <p>Active DEXs integrated</p>
          <div className="stat-value">{exchanges.length}</div>
        </div>
        <div className="info-card">
          <h3>Combined Volume</h3>
          <p>24h trading volume</p>
          <div className="stat-value">$3.53B</div>
        </div>
        <div className="info-card">
          <h3>Network</h3>
          <p>Primary blockchain</p>
          <div className="stat-value" style={{ fontSize: '20px' }}>Solana</div>
        </div>
      </div>

      <div className="info-card" style={{ marginTop: '16px' }}>
        {exchanges.map((exchange, i) => (
          <div className="exchange-item" key={exchange.name}>
            <div className="exchange-info">
              <div className="exchange-logo" style={{ background: `${exchange.color}20`, color: exchange.color }}>
                {exchange.name[0]}
              </div>
              <div>
                <div className="exchange-name">{exchange.name}</div>
                <div className="exchange-type">{exchange.type}</div>
              </div>
            </div>
            <div className="exchange-volume">
              <div className="vol-value">{exchange.volume}</div>
              <div className="vol-label">24h Volume</div>
            </div>
            <span className={`trust-badge ${exchange.trust}`}>
              {exchange.trust === 'high' ? 'High Trust' : 'Medium'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Exchanges
