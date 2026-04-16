import { useLanguage } from '../stores/useLanguageStore'
import { Zap, Lock, BarChart3, ShieldCheck, BookOpen, RefreshCw, Rocket } from 'lucide-react'

function Api() {
  const { t } = useLanguage()
  const apiEndpoints = [
    {
      method: 'GET',
      path: '/api/v1/tokens',
      description: 'Retrieve a list of all available tokens on the Cryptonite exchange, including metadata and current pricing.',
      status: 'coming-soon'
    },
    {
      method: 'GET',
      path: '/api/v1/tokens/{symbol}/price',
      description: 'Get real-time price data for a specific token, including 24h change, volume, and market cap.',
      status: 'coming-soon'
    },
    {
      method: 'POST',
      path: '/api/v1/swap/quote',
      description: 'Request a swap quote between two tokens. Returns estimated output, price impact, fees, and routing information.',
      status: 'coming-soon'
    },
    {
      method: 'POST',
      path: '/api/v1/swap/execute',
      description: 'Execute a token swap transaction on the Solana blockchain with MEV protection and optimized routing.',
      status: 'coming-soon'
    },
    {
      method: 'GET',
      path: '/api/v1/markets',
      description: 'Fetch market overview data including top movers, trending tokens, and aggregate volume statistics.',
      status: 'coming-soon'
    },
    {
      method: 'GET',
      path: '/api/v1/wallet/{address}/balances',
      description: 'Retrieve token balances for a given Solana wallet address across all supported Cryptonite tokens.',
      status: 'coming-soon'
    },
    {
      method: 'GET',
      path: '/api/v1/transactions/{txHash}',
      description: 'Look up transaction details by hash, including status, token amounts, fees, and confirmation time.',
      status: 'coming-soon'
    },
    {
      method: 'WebSocket',
      path: '/ws/v1/prices',
      description: 'Subscribe to real-time price feeds for one or more tokens via WebSocket connection.',
      status: 'coming-soon'
    }
  ];

  const features = [
    {
      icon: <Zap size={24} />,
      title: 'High Performance',
      description: 'Sub-100ms response times with globally distributed infrastructure for minimal latency.'
    },
    {
      icon: <Lock size={24} />,
      title: 'Secure Authentication',
      description: 'API key authentication with rate limiting, IP whitelisting, and HMAC request signing.'
    },
    {
      icon: <BarChart3 size={24} />,
      title: 'Real-Time Data',
      description: 'WebSocket streams for live price updates, order book changes, and transaction notifications.'
    },
    {
      icon: <ShieldCheck size={24} />,
      title: 'MEV Protection',
      description: 'Built-in Jito bundle integration to protect API-initiated swaps from frontrunning attacks.'
    },
    {
      icon: <BookOpen size={24} />,
      title: 'Comprehensive WhitePaper',
      description: 'Detailed documentation with code examples in JavaScript, Python, Rust, and cURL.'
    },
    {
      icon: <RefreshCw size={24} />,
      title: 'Rate Limits',
      description: 'Generous rate limits with tiered plans: Free (100 req/min), Pro (1,000 req/min), Enterprise (unlimited).'
    }
  ];

  const methodColors = {
    'GET': '#00d18c',
    'POST': '#7b61ff',
    'WebSocket': '#f0b90b'
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t('api_title')}</h1>
        <p>{t('api_desc')}</p>
      </div>

      <div className="api-coming-soon-banner">
        <div className="api-banner-icon"><Rocket size={32} /></div>
        <div className="api-banner-content">
          <h2>{t('api_coming_soon')}</h2>
          <p>The Cryptonite API is currently under active development. We're building a robust, developer-friendly API to give you programmatic access to all exchange features. Join our waitlist to be notified when it launches.</p>
          <div className="api-banner-actions">
            <button className="nav-btn primary">Join Waitlist</button>
            <button className="nav-btn">View Roadmap</button>
          </div>
        </div>
      </div>

      <div className="api-section">
        <h2 className="api-section-title">API Features</h2>
        <div className="grid-3">
          {features.map((feature, i) => (
            <div key={i} className="info-card api-feature-card">
              <div className="api-feature-icon">{feature.icon}</div>
              <h3>{feature.title}</h3>
              <p style={{ marginTop: '8px', fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="api-section">
        <h2 className="api-section-title">Planned Endpoints</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
          Below is a preview of the endpoints that will be available when the API launches.
        </p>
        <div className="api-endpoints-list">
          {apiEndpoints.map((endpoint, i) => (
            <div key={i} className="api-endpoint-card">
              <div className="api-endpoint-header">
                <span
                  className="api-method-badge"
                  style={{ background: methodColors[endpoint.method] + '22', color: methodColors[endpoint.method] }}
                >
                  {endpoint.method}
                </span>
                <code className="api-endpoint-path">{endpoint.path}</code>
                <span className="api-status-badge">{t('api_coming_soon')}</span>
              </div>
              <p className="api-endpoint-desc">{endpoint.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="api-section">
        <h2 className="api-section-title">Quick Start Preview</h2>
        <div className="api-code-block">
          <div className="api-code-header">
            <span>JavaScript / Node.js</span>
            <span className="api-code-tag">Preview</span>
          </div>
          <pre className="api-code-content">
{`import { CryptoniteAPI } from '@cryptonite/sdk';

const client = new CryptoniteAPI({
  apiKey: 'your-api-key',
  network: 'mainnet'
});

// Get a swap quote
const quote = await client.getSwapQuote({
  inputToken: 'NTC',
  outputToken: 'ASDC',
  amount: 100,
  slippage: 0.5
});

console.log('Estimated output:', quote.outputAmount);
console.log('Price impact:', quote.priceImpact);

// Execute the swap
const tx = await client.executeSwap(quote, {
  wallet: yourWalletKeypair,
  mevProtection: true
});

console.log('Transaction:', tx.signature);`}
          </pre>
        </div>
      </div>

    </div>
  )
}

export default Api
