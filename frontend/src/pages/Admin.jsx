import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { explorerTxUrl } from '../utils/solanaExplorer'

function formatPerfPrice(val) {
  if (!val && val !== 0) return '--'
  const n = Number(val)
  if (n === 0) return '0.00000'
  if (n < 0.001) return n.toFixed(8)
  if (n < 1) return n.toFixed(5)
  return n.toFixed(5)
}

function formatPerfAge(seconds) {
  if (!seconds && seconds !== 0) return '--'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useAdmin } from '../hooks/useAdminHook'
import { useAdminStore } from '../stores/useAdminStore'
import { useLanguage } from '../stores/useLanguageStore'
import { useCurrency } from '../stores/useCurrencyStore'
import { Navigate } from 'react-router-dom'
import { AreaChart, Area, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from 'recharts'
import TOKENS from '../data/tokens'
import { VersionedTransaction } from '@solana/web3.js'
import useTokenApi from '../hooks/useTokenApi'
import { useSSERefresh } from '../hooks/useSSEEvent'
import { TrendingDown, BarChart3 as BarChartIcon, Clock, MessageCircle, Users, TrendingUp, Wallet, Calendar, Eye, User, Waves, Mail, CircleDot, Circle, CheckCircle, MailOpen } from 'lucide-react'
import { useSetupStatusQuery, useInvalidateSetupStatus } from '../hooks/queries/useSetupStatusQuery'
import { useTreasuryDataQuery, useInvalidateTreasuryData } from '../hooks/queries/useTreasuryDataQuery'
import { useAdminSwapLimitsQuery, useInvalidateAdminSwapLimits } from '../hooks/queries/useSwapLimitsQuery'
import { useAdminReferralConfigQuery, useInvalidateAdminReferralConfig } from '../hooks/queries/useReferralQuery'
import { useAdminTokenPricesQuery, useInvalidateAdminTokenPrices } from '../hooks/queries/useTokenPricesQuery'

const OVERVIEW_TOKEN_COLORS = {
  NTC: '#a855f7',
  ASDC: '#22c55e',
  EDC: '#eab308',
  RDC: '#8b5cf6',
  DMC: '#f97316',
  BDC: '#3b82f6',
  YDC: '#ef4444',
  SDC: '#06b6d4',
  CDC: '#ec4899',
  ADC: '#14b8a6',
  SGDC: '#f59e0b',
}

const defaultOverview = {
  referralData: [],
  referralTotal: 0,
  referralChange: 0,
  trafficData: [],
  weeklyData: [],
  mostViewedData: [],
  volume24h: 0,
  platformStats: { totalUsers: 0, usersChange: 0, totalVolume: 0, volumeChange: 0, totalFees: 0, feesChange: 0, totalTVL: 0, tvlChange: 0 },
  visitStats: { pageViews: 0, pageViewsChange: 0, uniqueVisitors: 0, uniqueVisitorsChange: 0, avgSession: '0m 0s', avgSessionChange: 0, bounceRate: 0, bounceRateChange: 0 },
  pageViewsOverTime: [],
  topPages: [],
}

const defaultAdminData = {
  platformStats: { totalUsers: 0, usersChange: 0, totalVolume: 0, volumeChange: 0, totalFees: 0, feesChange: 0, totalTrades: 0, tradesChange: 0, totalTVL: 0, tvlChange: 0 },
  volumeOverTime: [],
  tradeActivity: [],
  volumeByToken: [],
  topPerformers: [],
  trendingPairs: [],
}

const analyticsMenu = [
  { id: 'aggregated', label: 'Aggregated' },
  { id: 'trending', label: 'Trending' },
  { id: 'most-visited', label: 'Most Visited' },
]

const FEE_TIERS = [
  { value: 0.25, label: '0.25%' },
  { value: 0.30, label: '0.30%' },
  { value: 0.50, label: '0.50%' },
  { value: 1.00, label: '1.00%' },
]

const LOCK_PERIODS = [
  { days: 30, label: '30_days' },
  { days: 90, label: '90_days' },
  { days: 180, label: '180_days' },
  { days: 365, label: '365_days' },
  { days: -1, label: 'permanent' },
]


const buildPoolFromDb = (dbPool) => {
  const tokenA = TOKENS.find(t => t.symbol === dbPool.token_a_symbol)
  const tokenB = TOKENS.find(t => t.symbol === dbPool.token_b_symbol)
  return {
    id: `pool-db-${dbPool.id}`,
    dbId: dbPool.id,
    tokenA: tokenA || { symbol: dbPool.token_a_symbol, name: dbPool.token_a_symbol, id: dbPool.token_a_symbol.toLowerCase(), color: '#888' },
    tokenB: tokenB || { symbol: dbPool.token_b_symbol, name: dbPool.token_b_symbol, id: dbPool.token_b_symbol.toLowerCase(), color: '#888' },
    feeTier: dbPool.fee_tier || 0.30,
    tvl: 0,
    volume24h: 0,
    feesEarned: 0,
    apr: '0.0',
    status: 'active',
    createdAt: new Date(dbPool.created_at).toLocaleDateString(),
    poolAddress: dbPool.pool_address || null,
    tokenMintA: dbPool.token_a_mint || '',
    tokenMintB: dbPool.token_b_mint || '',
    liquidity: '0',
    price: 0,
    reserveA: '0',
    reserveB: '0',
  }
}


function PurchasesTab() {
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(false)

  const { publicKey: adminPk } = useWallet()

  useEffect(() => {
    if (!adminPk) return
    setLoading(true)
    fetch('/api/admin/purchases', { headers: { 'x-wallet-address': adminPk.toBase58() } })
      .then(r => r.json())
      .then(d => { if (d.ok) setPurchases(d.purchases || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [adminPk])

  const getStatusColor = (s) => {
    if (s === 'pending' || s === 'waiting') return '#f0ad4e'
    if (s === 'confirming' || s === 'sending') return '#5bc0de'
    if (s === 'completed' || s === 'finished') return '#00d4aa'
    if (s === 'failed' || s === 'expired' || s === 'send_failed') return '#d9534f'
    return '#888'
  }

  return (
    <div className="admin-card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>NOWPayments Purchases</h3>
        <button
          onClick={() => {
            if (!adminPk) return
            setLoading(true)
            fetch('/api/admin/purchases', { headers: { 'x-wallet-address': adminPk.toBase58() } }).then(r => r.json()).then(d => { if (d.ok) setPurchases(d.purchases || []) }).catch(() => {}).finally(() => setLoading(false))
          }}
          style={{ background: 'rgba(0,212,170,0.15)', border: '1px solid rgba(0,212,170,0.3)', color: '#00d4aa', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12 }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      {purchases.length === 0 && !loading && (
        <div style={{ color: '#888', padding: 20, textAlign: 'center' }}>No purchases yet</div>
      )}
      {purchases.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <th style={{ textAlign: 'left', padding: '8px 6px', color: '#888', fontWeight: 500 }}>Wallet</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>NTC</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>USD</th>
                <th style={{ textAlign: 'left', padding: '8px 6px', color: '#888', fontWeight: 500 }}>Paid</th>
                <th style={{ textAlign: 'left', padding: '8px 6px', color: '#888', fontWeight: 500 }}>NP Status</th>
                <th style={{ textAlign: 'left', padding: '8px 6px', color: '#888', fontWeight: 500 }}>Status</th>
                <th style={{ textAlign: 'center', padding: '8px 6px', color: '#888', fontWeight: 500 }}>Tx</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontWeight: 500 }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: 11 }}>
                    {p.user_wallet?.slice(0, 6)}...{p.user_wallet?.slice(-4)}
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px 6px', color: '#00d4aa', fontWeight: 600 }}>
                    {Number(p.ntc_amount).toFixed(2)}
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px 6px' }}>
                    ${Number(p.price_usd).toFixed(2)}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    {Number(p.pay_amount).toFixed(6)} {p.pay_currency?.toUpperCase()}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <span style={{ color: getStatusColor(p.nowpayments_status), textTransform: 'capitalize', fontSize: 11 }}>
                      {p.nowpayments_status || '--'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <span style={{ color: getStatusColor(p.status), textTransform: 'capitalize', fontSize: 11, fontWeight: 600 }}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                    {p.ntc_tx_signature ? (
                      <a
                        href={explorerTxUrl(p.ntc_tx_signature)}
                        target="_blank" rel="noopener noreferrer"
                        style={{ color: '#00d4aa', fontSize: 11, textDecoration: 'none' }}
                      >
                        {p.ntc_tx_signature.slice(0, 6)}...
                      </a>
                    ) : <span style={{ color: '#555' }}>--</span>}
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px 6px', color: '#888', fontSize: 11 }}>
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Admin() {
  const { isAdmin, adminRole, adminList, addAdmin, removeAdmin } = useAdmin()
  const { publicKey, signTransaction } = useWallet()
  const { connection } = useConnection()
  const { t } = useLanguage()
  const { currency, formatPrice, formatLargeNumber } = useCurrency()
  const loadAdminsFromApi = useAdminStore(s => s.loadAdminsFromApi)
  const adminsLoaded = useAdminStore(s => s.adminsLoaded)
  const [addAdminError, setAddAdminError] = useState('')
  const adminTabAllowList = new Set(['referral-rewards', 'performance', 'contact', 'net-permissions', 'token-prices'])
  const canAccessTab = (tabId, role) => role === 'admin' ? adminTabAllowList.has(tabId) : true
  const [activeTab, setActiveTab] = useState('overview')
  const setAllowedActiveTab = (tabId) => {
    setActiveTab(canAccessTab(tabId, adminRole) ? tabId : (adminRole === 'admin' ? 'referral-rewards' : 'overview'))
  }
  const [perfData, setPerfData] = useState(null)
  const [activeAnalytics, setActiveAnalytics] = useState('aggregated')
  const [timePeriod, setTimePeriod] = useState('all')
  const { getApiName, getApiImage } = useTokenApi()
  const [adminData, setAdminData] = useState(defaultAdminData)
  const [adminFeesData, setAdminFeesData] = useState([])
  const [priceTrends, setPriceTrends] = useState({})
  const [overviewData, setOverviewData] = useState(defaultOverview)

  useEffect(() => {
    if (publicKey) {
      window.__adminWalletAddress = publicKey.toBase58()
      loadAdminsFromApi()
    }
  }, [publicKey, loadAdminsFromApi])

  useEffect(() => {
    if (adminRole === 'admin' && !adminTabAllowList.has(activeTab)) {
      setActiveTab('referral-rewards')
    }
  }, [adminRole, activeTab])

  useEffect(() => {
    const period = timePeriod === 'week' ? 'week' : timePeriod === 'month' ? 'month' : timePeriod === 'year' ? 'year' : 'all'
    fetch(`/api/admin/stats?period=${period}`)
      .then(r => r.json())
      .then(data => { if (data.ok) setAdminData(data) })
      .catch(() => {})
    fetch(`/api/admin/price-trends?tokenIds=ntc,asdc,edc,rdc,dmc,bdc,ydc,sdc,cdc,adc,sgdc&period=${period}`)
      .then(r => r.json())
      .then(data => { if (data.ok) setPriceTrends(data.trends) })
      .catch(() => {})
    fetch(`/api/admin/aggregated?period=${period}`)
      .then(r => r.json())
      .then(data => { if (data.ok) setOverviewData(data) })
      .catch(() => {})
  }, [timePeriod])

  const [pools, setPools] = useState([])
  const [showCreatePool, setShowCreatePool] = useState(false)
  const [newPoolTokenA, setNewPoolTokenA] = useState('')
  const [newPoolTokenB, setNewPoolTokenB] = useState('')
  const [newPoolFee, setNewPoolFee] = useState(0.30)
  const [newPoolAmountA, setNewPoolAmountA] = useState('')
  const [newPoolAmountB, setNewPoolAmountB] = useState('')

  const [lockedPositions, setLockedPositions] = useState([])
  const [showLockForm, setShowLockForm] = useState(false)
  const [lockPoolId, setLockPoolId] = useState('')
  const [lockAmount, setLockAmount] = useState('')
  const [lockPeriod, setLockPeriod] = useState(90)

  const [showFeesPopup, setShowFeesPopup] = useState(false)
  const [feesPeriod, setFeesPeriod] = useState('all')
  const [feesBreakdown, setFeesBreakdown] = useState([])
  const [confirmPausePool, setConfirmPausePool] = useState(null)
  const [showAddAdmin, setShowAddAdmin] = useState(false)
  const [newAdminWallet, setNewAdminWallet] = useState('')
  const [newAdminRole, setNewAdminRole] = useState('admin')
  const [netPermissions, setNetPermissions] = useState([])
  const [netPermLoading, setNetPermLoading] = useState(false)
  const [netPermError, setNetPermError] = useState('')
  const [showAddNetPerm, setShowAddNetPerm] = useState(false)
  const [newNetPermWallet, setNewNetPermWallet] = useState('')
  const [netPermSaving, setNetPermSaving] = useState(false)
  const [supportMessages, setSupportMessages] = useState([])
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [contactFilter, setContactFilter] = useState('all')

  useEffect(() => {
    if (!publicKey) return
    fetch('/api/admin/support-messages', { headers: { 'x-wallet-address': publicKey.toBase58() } })
      .then(r => r.json())
      .then(d => { if (d.ok) setSupportMessages(d.messages || []) })
      .catch(() => {})
  }, [publicKey])

  const fetchNetPermissions = useCallback(async () => {
    if (!publicKey) return
    setNetPermLoading(true)
    setNetPermError('')
    try {
      const res = await fetch('/api/network-post-permissions', { headers: { 'x-wallet-address': publicKey.toBase58() } })
      const data = await res.json()
      if (data.ok) setNetPermissions(data.permissions || [])
      else setNetPermError(data.error || 'Failed to load permissions')
    } catch {
      setNetPermError('Could not connect to server')
    } finally {
      setNetPermLoading(false)
    }
  }, [publicKey])

  useEffect(() => {
    if (activeTab === 'net-permissions') fetchNetPermissions()
  }, [activeTab, fetchNetPermissions])

  const addNetPermission = async () => {
    if (!publicKey || !newNetPermWallet.trim()) return
    setNetPermSaving(true)
    setNetPermError('')
    try {
      const res = await fetch('/api/network-post-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': publicKey.toBase58() },
        body: JSON.stringify({ targetWallet: newNetPermWallet.trim() }),
      })
      const data = await res.json()
      if (data.ok) {
        setNewNetPermWallet('')
        setShowAddNetPerm(false)
        fetchNetPermissions()
      } else {
        setNetPermError(data.error || 'Failed to add permission')
      }
    } catch {
      setNetPermError('Could not connect to server')
    } finally {
      setNetPermSaving(false)
    }
  }

  const removeNetPermission = async (targetWallet) => {
    if (!publicKey) return
    try {
      const res = await fetch(`/api/network-post-permissions/${encodeURIComponent(targetWallet)}`, {
        method: 'DELETE',
        headers: { 'x-wallet-address': publicKey.toBase58() },
      })
      const data = await res.json()
      if (data.ok) setNetPermissions(prev => prev.filter(p => p.wallet !== targetWallet))
    } catch {}
  }

  const [swapFee, setSwapFee] = useState(0.3)
  const [editingSwapFee, setEditingSwapFee] = useState(false)
  const [tempSwapFee, setTempSwapFee] = useState('0.3')
  const [maxSlippage, setMaxSlippage] = useState(5.0)
  const [editingSlippage, setEditingSlippage] = useState(false)
  const [tempSlippage, setTempSlippage] = useState('5.0')
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [poolsLoading, setPoolsLoading] = useState(false)
  const [poolCreateLoading, setPoolCreateLoading] = useState(false)
  const [poolCreateError, setPoolCreateError] = useState(null)
  const [poolCreateErrorExpanded, setPoolCreateErrorExpanded] = useState(false)
  const [poolCreateResult, setPoolCreateResult] = useState(null)
  const [showAddLiquidity, setShowAddLiquidity] = useState(false)
  const [liqPoolId, setLiqPoolId] = useState('')
  const [liqAmountA, setLiqAmountA] = useState('')
  const [liqAmountB, setLiqAmountB] = useState('')
  const [liqLoading, setLiqLoading] = useState(false)
  const [liqResult, setLiqResult] = useState(null)
  const [liqError, setLiqError] = useState(null)
  const [liqBalances, setLiqBalances] = useState(null)
  const [liqBalancesLoading, setLiqBalancesLoading] = useState(false)
  const [removeLiqLoading, setRemoveLiqLoading] = useState(null)
  const [removeLiqResult, setRemoveLiqResult] = useState(null)
  const [removeLiqError, setRemoveLiqError] = useState(null)
  const [poolFees, setPoolFees] = useState({})
  const [collectFeeLoading, setCollectFeeLoading] = useState(null)
  const [collectFeeResult, setCollectFeeResult] = useState(null)
  const [collectFeeError, setCollectFeeError] = useState(null)
  const [treasuryMultisig, setTreasuryMultisig] = useState(null)
  const [treasuryBalances, setTreasuryBalances] = useState([])
  const [treasuryProposals, setTreasuryProposals] = useState([])
  const [treasuryFeeHistory, setTreasuryFeeHistory] = useState([])
  const [feeHistoryShowAll, setFeeHistoryShowAll] = useState(false)
  const [treasuryOwners, setTreasuryOwners] = useState(null)
  const [treasuryWallets, setTreasuryWallets] = useState([])
  const [treasuryLoading, setTreasuryLoading] = useState(true)
  const [treasuryActionLoading, setTreasuryActionLoading] = useState(null)
  const [treasuryActionError, setTreasuryActionError] = useState(null)
  const [treasuryActionResult, setTreasuryActionResult] = useState(null)
  const [proposeInstructions, setProposeInstructions] = useState('')
  const [createVaultIndex, setCreateVaultIndex] = useState(0)
  const [transferMint, setTransferMint] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferDestination, setTransferDestination] = useState('')
  const [vaultTransferToken, setVaultTransferToken] = useState('')
  const [vaultTransferAmount, setVaultTransferAmount] = useState('')
  const [vaultTransferDest, setVaultTransferDest] = useState('')

  const [swapLimitsData, setSwapLimitsData] = useState({ daily: 100, monthly: 500 })
  const [swapLimitProposals, setSwapLimitProposals] = useState([])
  const [swapLimitLoading, setSwapLimitLoading] = useState(false)
  const [proposedDailyLimit, setProposedDailyLimit] = useState('')
  const [proposedMonthlyLimit, setProposedMonthlyLimit] = useState('')
  const [swapLimitActionLoading, setSwapLimitActionLoading] = useState(null)
  const [swapLimitActionError, setSwapLimitActionError] = useState(null)
  const [swapLimitActionResult, setSwapLimitActionResult] = useState(null)

  const [referralConfig, setReferralConfig] = useState({ referrerReward: 0.25, refereeReward: 0.5 })
  const [referralAdminStats, setReferralAdminStats] = useState(null)
  const [referralProposals, setReferralProposals] = useState([])
  const [referralLoading, setReferralLoading] = useState(false)
  const [proposedReferrerReward, setProposedReferrerReward] = useState('')
  const [proposedRefereeReward, setProposedRefereeReward] = useState('')
  const [referralActionLoading, setReferralActionLoading] = useState(null)
  const [referralActionError, setReferralActionError] = useState(null)
  const [referralActionResult, setReferralActionResult] = useState(null)

  const [tokenPrices, setTokenPrices] = useState([])
  const [tokenPriceProposals, setTokenPriceProposals] = useState([])
  const [tokenPricesLoading, setTokenPricesLoading] = useState(false)
  const [proposedTokenSymbol, setProposedTokenSymbol] = useState('NTC')
  const [proposedTokenPrice, setProposedTokenPrice] = useState('')
  const [tokenPriceActionLoading, setTokenPriceActionLoading] = useState(null)
  const [tokenPriceActionError, setTokenPriceActionError] = useState(null)
  const [tokenPriceActionResult, setTokenPriceActionResult] = useState(null)

  const [setupStatus, setSetupStatus] = useState(null)
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupStep, setSetupStep] = useState(0)
  const [setupError, setSetupError] = useState(null)
  const [setupSuccess, setSetupSuccess] = useState(null)
  const [programIds, setProgramIds] = useState({ token_core_program_id: '' })
  const [multisigOwners, setMultisigOwners] = useState({ owner1: '', owner2: '', owner3: '' })
  const [setupActionLoading, setSetupActionLoading] = useState(null)
  const [multisigRetrying, setMultisigRetrying] = useState(false)

  const walletAddr = publicKey?.toBase58() || ''
  const treasuryTabActive = activeTab === 'treasury' || activeTab === 'setup' || activeTab === 'swap-limits' || activeTab === 'referral-rewards' || activeTab === 'token-prices'
  const { data: setupQueryData, isLoading: setupQueryLoading } = useSetupStatusQuery(treasuryTabActive || activeTab === 'setup')
  const invalidateSetupStatus = useInvalidateSetupStatus()
  const { data: treasuryQueryData, isLoading: treasuryQueryLoading } = useTreasuryDataQuery(walletAddr, treasuryTabActive)
  const invalidateTreasuryData = useInvalidateTreasuryData()
  const swapLimitsTabActive = activeTab === 'swap-limits'
  const { data: adminSwapLimitsData, isLoading: adminSwapLimitsLoading } = useAdminSwapLimitsQuery(walletAddr, swapLimitsTabActive)
  const invalidateAdminSwapLimits = useInvalidateAdminSwapLimits()
  const referralRewardsTabActive = activeTab === 'referral-rewards'
  const { data: adminReferralData, isLoading: adminReferralLoading } = useAdminReferralConfigQuery(walletAddr, referralRewardsTabActive)
  const invalidateAdminReferralConfig = useInvalidateAdminReferralConfig()
  const tokenPricesTabActive = activeTab === 'token-prices'
  const { data: adminTokenPricesData, isLoading: adminTokenPricesLoading } = useAdminTokenPricesQuery(walletAddr, tokenPricesTabActive)
  const invalidateAdminTokenPrices = useInvalidateAdminTokenPrices()

  useEffect(() => {
    if (setupQueryData?.ok) {
      setSetupStatus(setupQueryData)
      if (setupQueryData.programs?.data) {
        setProgramIds(prev => ({
          token_core_program_id: setupQueryData.programs.data.token_core_program_id || prev.token_core_program_id,
        }))
      }
      if (setupQueryData.multisigOwners?.data) {
        const mo = setupQueryData.multisigOwners.data
        setMultisigOwners({ owner1: mo.owner1 || '', owner2: mo.owner2 || '', owner3: mo.owner3 || '' })
      }
    }
    setSetupLoading(setupQueryLoading)
  }, [setupQueryData, setupQueryLoading])

  useEffect(() => {
    if (treasuryQueryData) {
      const { stateData, balancesData, feesData, ownersData, walletsData, proposalsData } = treasuryQueryData
      if (stateData?.ok) setTreasuryMultisig(stateData)
      if (balancesData?.ok) setTreasuryBalances(balancesData.balances || [])
      if (proposalsData?.ok) setTreasuryProposals(proposalsData.proposals || [])
      if (feesData?.ok) setTreasuryFeeHistory(feesData.events || [])
      if (ownersData?.ok) setTreasuryOwners(ownersData.owners)
      if (walletsData?.ok) setTreasuryWallets(walletsData.wallets || [])
    }
    setTreasuryLoading(treasuryQueryLoading)
  }, [treasuryQueryData, treasuryQueryLoading])

  useEffect(() => {
    if (adminSwapLimitsData) {
      if (adminSwapLimitsData.limits) setSwapLimitsData(adminSwapLimitsData.limits)
      setSwapLimitProposals(adminSwapLimitsData.proposals || [])
    }
    setSwapLimitLoading(adminSwapLimitsLoading)
  }, [adminSwapLimitsData, adminSwapLimitsLoading])

  useEffect(() => {
    if (adminReferralData) {
      if (adminReferralData.config) setReferralConfig(adminReferralData.config)
      if (adminReferralData.stats) setReferralAdminStats(adminReferralData.stats)
      setReferralProposals(adminReferralData.proposals || [])
    }
    setReferralLoading(adminReferralLoading)
  }, [adminReferralData, adminReferralLoading])

  useEffect(() => {
    if (adminTokenPricesData) {
      setTokenPrices(adminTokenPricesData.prices || [])
      setTokenPriceProposals(adminTokenPricesData.proposals || [])
    }
    setTokenPricesLoading(adminTokenPricesLoading)
  }, [adminTokenPricesData, adminTokenPricesLoading])

  const loadFullPoolData = useCallback(async (signal) => {
    setPoolsLoading(true)
    try {
      const dbRes = await fetch('/api/admin/pools')
      const dbData = await dbRes.json()
      if (!dbData.ok || !dbData.pools || dbData.pools.length === 0) {
        setPools([])
        setPoolsLoading(false)
        return
      }
      const dbPools = dbData.pools.map(buildPoolFromDb)
      if (signal?.aborted) return
      setPools(prev => {
        if (prev.length === 0) return dbPools
        return dbPools.map(dp => {
          const existing = prev.find(p => p.id === dp.id)
          if (existing) {
            return { ...dp, liquidity: existing.liquidity, price: existing.price, reserveA: existing.reserveA, reserveB: existing.reserveB, tvl: existing.tvl, volume24h: existing.volume24h, feesEarned: existing.feesEarned, apr: existing.apr, status: existing.status }
          }
          return dp
        })
      })

      for (let i = 0; i < dbPools.length; i++) {
        if (signal?.aborted) break
        const p = dbPools[i]
        let fetched = false
        for (let attempt = 0; attempt < 3 && !fetched && !(signal?.aborted); attempt++) {
          try {
            if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt))
            const poolAddrParam = p.poolAddress ? `&poolAddress=${p.poolAddress}` : ''
            const res = await fetch(`/api/pools?tokenA=${p.tokenA.symbol}&tokenB=${p.tokenB.symbol}${poolAddrParam}`)
            if (res.status === 429) continue
            const data = await res.json()
            if (data.ok && !(signal?.aborted)) {
              const resA = parseFloat(data.reserves?.tokenA?.uiAmount || '0')
              const resB = parseFloat(data.reserves?.tokenB?.uiAmount || '0')
              const tvlVal = (!isNaN(resA) && !isNaN(resB)) ? Math.round(resA + resB) : 0
              setPools(prev => prev.map(u => u.id === p.id ? {
                ...u,
                poolAddress: data.poolAddress || u.poolAddress,
                liquidity: data.liquidity || '0',
                price: data.price || 0,
                reserveA: data.reserves?.tokenA?.uiAmount || '0',
                reserveB: data.reserves?.tokenB?.uiAmount || '0',
                tvl: tvlVal,
                status: 'active',
              } : u))
            }
            fetched = true
          } catch (e) {
            if (attempt === 2) { /* skip */ }
          }
        }
        if (i < dbPools.length - 1) await new Promise(r => setTimeout(r, 500))
      }

      if (!(signal?.aborted)) {
        const tokenIds = [...new Set(dbPools.flatMap(p => [p.tokenA.id, p.tokenB.id]))]
        if (tokenIds.length > 0) {
          try {
            const statsRes = await fetch(`/api/chart/stats?tokenIds=${tokenIds.map(encodeURIComponent).join(',')}`)
            const statsData = await statsRes.json()
            if (statsData.ok && statsData.stats && !(signal?.aborted)) {
              setPools(prev => prev.map(p => {
                const sA = statsData.stats[p.tokenA.id] || {}
                const sB = statsData.stats[p.tokenB.id] || {}
                const vol = (sA.volume24h || 0) + (sB.volume24h || 0)
                const fees = Math.round(vol * (p.feeTier || 0.30) / 100)
                const tvl = p.tvl || 0
                const apr = tvl > 0 ? ((fees * 365 / tvl) * 100).toFixed(1) : '0.0'
                return { ...p, volume24h: vol, feesEarned: fees, apr }
              }))
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      console.error('Failed to load pools from database:', e)
      setPools([])
    }
    if (!(signal?.aborted)) setPoolsLoading(false)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadFullPoolData(controller.signal)
    return () => { controller.abort() }
  }, [loadFullPoolData])

  useEffect(() => {
    let cancelled = false
    const fetchFees = async () => {
      const activePools = pools.filter(p => p.poolAddress)
      if (activePools.length === 0) return
      const walletAddr = publicKey?.toBase58?.() || ''
      const EMPTY_FEES = { totalFeeOwedA: '0', totalFeeOwedB: '0', positions: [] }
      const fetchWithTimeout = async (url, ms) => {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), ms)
        try {
          const res = await fetch(url, { signal: ctrl.signal })
          clearTimeout(timer)
          return res
        } catch (e) {
          clearTimeout(timer)
          throw e
        }
      }
      const promises = activePools.map(async (pool) => {
        try {
          const url = walletAddr
            ? `/api/fees?poolAddress=${pool.poolAddress}&userPubkey=${walletAddr}`
            : `/api/fees?poolAddress=${pool.poolAddress}`
          const res = await fetchWithTimeout(url, 10000)
          const data = await res.json()
          if (data.ok && !cancelled) {
            setPoolFees(prev => ({ ...prev, [pool.id]: data }))
          } else if (!cancelled) {
            setPoolFees(prev => prev[pool.id] ? prev : { ...prev, [pool.id]: EMPTY_FEES })
          }
        } catch (_) {
          if (!cancelled) {
            setPoolFees(prev => prev[pool.id] ? prev : { ...prev, [pool.id]: EMPTY_FEES })
          }
        }
      })
      await Promise.allSettled(promises)
    }
    fetchFees()
    return () => { cancelled = true }
  }, [pools, publicKey])

  useEffect(() => {
    if (!showFeesPopup) return
    fetch(`/api/admin/fees?period=${feesPeriod}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setFeesBreakdown(d.fees || []) })
      .catch(() => {})
  }, [showFeesPopup, feesPeriod])

  const fetchPerf = useCallback(async () => {
    try {
      const res = await fetch('/api/oracle/performance')
      if (!res.ok) return
      const json = await res.json()
      if (json.success) setPerfData(json.data)
    } catch (_) {}
  }, [])

  useEffect(() => {
    if (activeTab === 'performance') {
      fetchPerf()
      const interval = setInterval(fetchPerf, 30000)
      return () => clearInterval(interval)
    }
  }, [activeTab, fetchPerf])

  useEffect(() => {
    const activePools = pools.filter(p => p.poolAddress)
    if (activePools.length === 0) return
    setLockedPositions(prev => {
      const manualLocks = prev.filter(l => l.source === 'manual')
      const onChainLocks = activePools.map(pool => {
        const resA = parseFloat(pool.reserveA || '0')
        const resB = parseFloat(pool.reserveB || '0')
        const tvl = (!isNaN(resA) && !isNaN(resB)) ? Math.round(resA + resB) : 0
        return {
          id: `lock-${pool.id}`,
          poolId: pool.id,
          pair: `${pool.tokenA.symbol}/${pool.tokenB.symbol}`,
          amount: tvl,
          liquidity: pool.liquidity || '0',
          reserveA: pool.reserveA || '0',
          reserveB: pool.reserveB || '0',
          poolAddress: pool.poolAddress,
          tokenMintA: pool.tokenMintA || '',
          tokenMintB: pool.tokenMintB || '',
          price: pool.price || 0,
          lockDate: pool.createdAt || new Date().toLocaleDateString(),
          unlockDate: 'Permanent',
          lockPeriod: -1,
          status: 'locked',
          source: 'onchain',
        }
      })
      return [...onChainLocks, ...manualLocks]
    })
  }, [pools])

  useSSERefresh('admin:update', invalidateSetupStatus, 1500)
  useSSERefresh('treasury:update', useCallback(() => { if (activeTab === 'treasury') invalidateTreasuryData() }, [activeTab, invalidateTreasuryData]), 1500)
  useSSERefresh('balances:update', useCallback(() => { if (activeTab === 'treasury') invalidateTreasuryData() }, [activeTab, invalidateTreasuryData]), 2000)
  useSSERefresh('pools:update', loadFullPoolData, 2000)
  useSSERefresh('tokens:update', invalidateSetupStatus, 1500)

  const handleSaveProgramIds = async () => {
    if (!publicKey) return
    setSetupActionLoading('programs')
    setSetupError(null)
    setSetupSuccess(null)
    try {
      const res = await fetch('/api/admin/programs/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...programIds, userPubkey: publicKey.toBase58() }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to save')
      setSetupSuccess('Program IDs saved successfully')
      invalidateSetupStatus()
    } catch (e) {
      setSetupError(e.message)
    } finally {
      setSetupActionLoading(null)
    }
  }

  const handleSaveMultisigOwners = async () => {
    if (!publicKey) return
    setSetupActionLoading('multisig-owners')
    setSetupError(null)
    setSetupSuccess(null)
    try {
      const res = await fetch('/api/admin/multisig-owners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...multisigOwners, userPubkey: publicKey.toBase58() }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to save')
      setSetupSuccess('Multisig owners saved successfully')
      invalidateSetupStatus()
    } catch (e) {
      setSetupError(e.message)
    } finally {
      setSetupActionLoading(null)
    }
  }

  const handleSetupCreateSquadsMultisig = async () => {
    if (!publicKey || !signTransaction) return
    const owners = [multisigOwners.owner1, multisigOwners.owner2, multisigOwners.owner3].filter(Boolean)
    if (owners.length < 2) { setSetupError('At least 2 owner wallet addresses are required'); return }
    setSetupActionLoading('create-squads')
    setMultisigRetrying(false)
    setSetupError(null)
    setSetupSuccess(null)
    const retryTimer = setTimeout(() => setMultisigRetrying(true), 45000)
    try {
      const buildRes = await fetch('/api/admin/squads/create-multisig/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owners, threshold: 2, userPubkey: publicKey.toBase58() }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build multisig transaction')
      if (buildData.alreadyExists) {
        setSetupSuccess(`Squads multisig already exists! Vault: ${buildData.vaultPda?.slice(0, 8)}...${buildData.vaultPda?.slice(-4)}`)
        invalidateSetupStatus()
        invalidateTreasuryData()
        return
      }
      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))
      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight, updateChannels: ['admin:update'], updateDetail: 'multisig_created' }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send multisig transaction')
      const finalizeRes = await fetch('/api/admin/squads/create-multisig/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          multisigPda: buildData.multisigPda,
          vaultPda: buildData.vaultPda,
          createKey: buildData.createKey,
          owners,
          threshold: 2,
          txSignature: sendData.signature,
          userPubkey: publicKey.toBase58(),
        }),
      })
      const finalizeData = await finalizeRes.json()
      if (!finalizeData.ok) throw new Error(finalizeData.error || 'Failed to finalize multisig')
      setSetupSuccess(`Squads multisig created!\nVault: ${buildData.vaultPda}\nSigner: ${publicKey.toBase58()}\nTx: ${sendData.signature}`)
      invalidateSetupStatus()
      invalidateTreasuryData()
    } catch (e) {
      if (!e?.message?.includes('User rejected')) setSetupError(e.message)
    } finally {
      clearTimeout(retryTimer)
      setMultisigRetrying(false)
      setSetupActionLoading(null)
    }
  }

  const handleInitToken = async (token) => {
    if (!publicKey || !signTransaction) return
    setSetupActionLoading('token-' + token.symbol)
    setSetupError(null)
    setSetupSuccess(null)
    try {
      const formData = new FormData()
      formData.append('userPubkey', publicKey.toBase58())
      formData.append('name', token.name)
      formData.append('symbol', token.symbol)
      formData.append('supply', token.supply)
      formData.append('decimals', String(token.decimals))
      const buildRes = await fetch('/api/tokens/create/build', { method: 'POST', headers: { 'x-token-symbol': token.symbol }, body: formData })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build token transaction')
      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))
      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight, updateChannels: ['tokens:update', 'admin:update'], updateDetail: 'token_minted' }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')
      if (buildData.mint) {
        try {
          await fetch('/api/tokens/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mint: buildData.mint }),
          })
        } catch {}
      }
      await fetch('/api/admin/token/init/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPubkey: publicKey.toBase58(),
          symbol: buildData.symbol, name: buildData.name, mint_address: buildData.mint,
          decimals: buildData.decimals, supply: buildData.supply,
          metadata_uri: buildData.metadataUrl || '', image_url: buildData.logoUrl || '',
          tx_signature: sendData.signature,
          treasury_ata: buildData.treasuryAta || '',
        }),
      })
      setSetupSuccess(`${token.symbol} token created successfully`)
      invalidateSetupStatus()
    } catch (e) {
      if (!e?.message?.includes('User rejected')) setSetupError(e.message)
    } finally {
      setSetupActionLoading(null)
    }
  }



  useSSERefresh('swap_limits_update', useCallback(() => { if (activeTab === 'swap-limits') invalidateAdminSwapLimits() }, [activeTab, invalidateAdminSwapLimits]), 1500)
  useSSERefresh('referral_config_update', useCallback(() => { if (activeTab === 'referral-rewards') invalidateAdminReferralConfig() }, [activeTab, invalidateAdminReferralConfig]), 1500)
  useSSERefresh('token_prices_update', useCallback(() => { if (activeTab === 'token-prices') invalidateAdminTokenPrices() }, [activeTab, invalidateAdminTokenPrices]), 1500)

  const handleProposeSwapLimitChange = async () => {
    if (!publicKey || !signTransaction) return
    const daily = parseFloat(proposedDailyLimit)
    const monthly = parseFloat(proposedMonthlyLimit)
    if (!daily || daily <= 0 || !monthly || monthly <= 0) {
      setSwapLimitActionError('Both limits must be positive numbers')
      return
    }
    if (daily > monthly) {
      setSwapLimitActionError('Daily limit cannot exceed monthly limit')
      return
    }
    setSwapLimitActionLoading('propose')
    setSwapLimitActionError(null)
    setSwapLimitActionResult(null)
    try {
      const buildRes = await fetch('/api/admin/squads/propose-limit-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator: publicKey.toBase58(), dailyLimit: daily, monthlyLimit: monthly }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to create proposal')
      const vtBytes = Uint8Array.from(atob(buildData.vaultTransaction), c => c.charCodeAt(0))
      const vtTx = VersionedTransaction.deserialize(vtBytes)
      const signedVt = await signTransaction(vtTx)
      const signedVtBase64 = btoa(String.fromCharCode(...signedVt.serialize()))
      const vtSendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedVtBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const vtSendData = await vtSendRes.json()
      if (!vtSendData.ok) throw new Error(vtSendData.error || 'Vault transaction failed')
      const propBytes = Uint8Array.from(atob(buildData.proposalTransaction), c => c.charCodeAt(0))
      const propTx = VersionedTransaction.deserialize(propBytes)
      const signedProp = await signTransaction(propTx)
      const signedPropBase64 = btoa(String.fromCharCode(...signedProp.serialize()))
      const propSendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedPropBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const propSendData = await propSendRes.json()
      if (!propSendData.ok) throw new Error(propSendData.error || 'Proposal transaction failed')
      const proposeSig = propSendData.signature || vtSendData.signature || ''
      setSwapLimitActionResult({ type: 'propose', transactionIndex: buildData.transactionIndex, daily, monthly, signature: proposeSig })
      if (proposeSig) {
        fetch('/api/admin/swap-limits/proposals/update-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userPubkey: publicKey.toBase58(), transactionIndex: buildData.transactionIndex, action: 'propose_signature', propose_signature: proposeSig }),
        }).catch(() => {})
      }
      setProposedDailyLimit('')
      setProposedMonthlyLimit('')
      invalidateAdminSwapLimits()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setSwapLimitActionError(err?.message || 'Propose failed')
    } finally {
      setSwapLimitActionLoading(null)
    }
  }

  const handleSwapLimitApprove = async (transactionIndex) => {
    if (!publicKey || !signTransaction) return
    setSwapLimitActionLoading('approve-' + transactionIndex)
    setSwapLimitActionError(null)
    setSwapLimitActionResult(null)
    try {
      const buildRes = await fetch('/api/admin/squads/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: publicKey.toBase58(), transactionIndex }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build approve transaction')
      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))
      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')
      if (sendData.txError) throw new Error('Transaction failed on-chain: ' + sendData.txError)
      if (!sendData.confirmed) {
        setSwapLimitActionLoading('confirming-approve-' + transactionIndex)
        await new Promise(resolve => setTimeout(resolve, 10000))
      }
      setSwapLimitActionResult({ type: 'approve', transactionIndex, signature: sendData.signature })
      try {
        await fetch('/api/admin/swap-limits/proposals/update-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userPubkey: publicKey.toBase58(), transactionIndex, action: 'approve', approve_signature: sendData.signature }),
        })
      } catch {}
      invalidateAdminSwapLimits()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setSwapLimitActionError(err?.message || 'Approve failed')
    } finally {
      setSwapLimitActionLoading(null)
    }
  }

  const handleSwapLimitExecute = async (transactionIndex) => {
    if (!publicKey || !signTransaction) return
    setSwapLimitActionLoading('execute-' + transactionIndex)
    setSwapLimitActionError(null)
    setSwapLimitActionResult(null)
    try {
      const buildRes = await fetch('/api/admin/squads/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: publicKey.toBase58(), transactionIndex }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build execute transaction')
      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))
      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')
      if (sendData.txError) throw new Error('Transaction failed on-chain: ' + sendData.txError)
      if (!sendData.confirmed) {
        setSwapLimitActionLoading('confirming-execute-' + transactionIndex)
        await new Promise(resolve => setTimeout(resolve, 10000))
      }
      setSwapLimitActionResult({ type: 'execute', transactionIndex, signature: sendData.signature })
      await new Promise(r => setTimeout(r, 3000))
      let updateSuccess = false
      for (let attempt = 0; attempt < 3 && !updateSuccess; attempt++) {
        try {
          const updateRes = await fetch('/api/admin/swap-limits/proposals/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userPubkey: publicKey.toBase58(), transactionIndex, action: 'execute', execute_signature: sendData.signature }),
          })
          const updateData = await updateRes.json()
          if (updateData.ok) {
            updateSuccess = true
          } else if (attempt < 2) {
            await new Promise(r => setTimeout(r, 2000))
          }
        } catch {
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
        }
      }
      invalidateAdminSwapLimits()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setSwapLimitActionError(err?.message || 'Execute failed')
    } finally {
      setSwapLimitActionLoading(null)
    }
  }

  const handleProposeReferralConfigChange = async () => {
    if (!publicKey || !signTransaction) return
    const referrerReward = parseFloat(proposedReferrerReward)
    const refereeReward = parseFloat(proposedRefereeReward)
    if (isNaN(referrerReward) || referrerReward < 0 || isNaN(refereeReward) || refereeReward < 0) {
      setReferralActionError('Both rewards must be non-negative numbers')
      return
    }
    setReferralActionLoading('propose')
    setReferralActionError(null)
    setReferralActionResult(null)
    try {
      const buildRes = await fetch('/api/admin/squads/propose-referral-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator: publicKey.toBase58(), referrerReward, refereeReward }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to create proposal')
      const vtBytes = Uint8Array.from(atob(buildData.vaultTransaction), c => c.charCodeAt(0))
      const vtTx = VersionedTransaction.deserialize(vtBytes)
      const signedVt = await signTransaction(vtTx)
      const signedVtBase64 = btoa(String.fromCharCode(...signedVt.serialize()))
      const vtSendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedVtBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const vtSendData = await vtSendRes.json()
      if (!vtSendData.ok) throw new Error(vtSendData.error || 'Vault transaction failed')
      const propBytes = Uint8Array.from(atob(buildData.proposalTransaction), c => c.charCodeAt(0))
      const propTx = VersionedTransaction.deserialize(propBytes)
      const signedProp = await signTransaction(propTx)
      const signedPropBase64 = btoa(String.fromCharCode(...signedProp.serialize()))
      const propSendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedPropBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const propSendData = await propSendRes.json()
      if (!propSendData.ok) throw new Error(propSendData.error || 'Proposal transaction failed')
      const proposeSig = propSendData.signature || vtSendData.signature || ''
      setReferralActionResult({ type: 'propose', transactionIndex: buildData.transactionIndex, referrerReward, refereeReward, signature: proposeSig })
      setProposedReferrerReward('')
      setProposedRefereeReward('')
      invalidateAdminReferralConfig()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setReferralActionError(err?.message || 'Propose failed')
    } finally {
      setReferralActionLoading(null)
    }
  }

  const handleReferralApprove = async (transactionIndex) => {
    if (!publicKey || !signTransaction) return
    setReferralActionLoading('approve-' + transactionIndex)
    setReferralActionError(null)
    setReferralActionResult(null)
    try {
      const buildRes = await fetch('/api/admin/squads/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: publicKey.toBase58(), transactionIndex }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build approve transaction')
      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))
      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')
      if (sendData.txError) throw new Error('Transaction failed on-chain: ' + sendData.txError)
      if (!sendData.confirmed) {
        setReferralActionLoading('confirming-approve-' + transactionIndex)
        await new Promise(resolve => setTimeout(resolve, 10000))
      }
      setReferralActionResult({ type: 'approve', transactionIndex, signature: sendData.signature })
      try {
        await fetch('/api/admin/referral-config/proposals/update-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userPubkey: publicKey.toBase58(), transactionIndex, action: 'approve' }),
        })
      } catch {}
      invalidateAdminReferralConfig()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setReferralActionError(err?.message || 'Approve failed')
    } finally {
      setReferralActionLoading(null)
    }
  }

  const handleReferralExecute = async (transactionIndex) => {
    if (!publicKey || !signTransaction) return
    setReferralActionLoading('execute-' + transactionIndex)
    setReferralActionError(null)
    setReferralActionResult(null)
    try {
      const buildRes = await fetch('/api/admin/squads/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: publicKey.toBase58(), transactionIndex }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build execute transaction')
      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))
      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')
      if (sendData.txError) throw new Error('Transaction failed on-chain: ' + sendData.txError)
      if (!sendData.confirmed) {
        setReferralActionLoading('confirming-execute-' + transactionIndex)
        await new Promise(resolve => setTimeout(resolve, 10000))
      }
      setReferralActionResult({ type: 'execute', transactionIndex, signature: sendData.signature })
      await new Promise(r => setTimeout(r, 3000))
      let updateSuccess = false
      for (let attempt = 0; attempt < 3 && !updateSuccess; attempt++) {
        try {
          const updateRes = await fetch('/api/admin/referral-config/proposals/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userPubkey: publicKey.toBase58(), transactionIndex, action: 'execute', execute_signature: sendData.signature }),
          })
          const updateData = await updateRes.json()
          if (updateData.ok) {
            updateSuccess = true
          } else if (attempt < 2) {
            await new Promise(r => setTimeout(r, 2000))
          }
        } catch {
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
        }
      }
      invalidateAdminReferralConfig()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setReferralActionError(err?.message || 'Execute failed')
    } finally {
      setReferralActionLoading(null)
    }
  }

  const handleProposeTokenPriceChange = async () => {
    if (!publicKey || !signTransaction) return
    const price = parseFloat(proposedTokenPrice)
    if (!price || price <= 0) {
      setTokenPriceActionError('Price must be a positive number')
      return
    }
    setTokenPriceActionLoading('propose')
    setTokenPriceActionError(null)
    setTokenPriceActionResult(null)
    try {
      const buildRes = await fetch('/api/admin/token-prices/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator: publicKey.toBase58(), tokenSymbol: proposedTokenSymbol, priceUsd: price }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to create proposal')
      const vtBytes = Uint8Array.from(atob(buildData.vaultTransaction), c => c.charCodeAt(0))
      const vtTx = VersionedTransaction.deserialize(vtBytes)
      const signedVt = await signTransaction(vtTx)
      const signedVtBase64 = btoa(String.fromCharCode(...signedVt.serialize()))
      const vtSendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedVtBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const vtSendData = await vtSendRes.json()
      if (!vtSendData.ok) throw new Error(vtSendData.error || 'Vault transaction failed')
      if (!vtSendData.confirmed) throw new Error('Vault transaction was not confirmed on-chain. Please try again.')
      const propBytes = Uint8Array.from(atob(buildData.proposalTransaction), c => c.charCodeAt(0))
      const propTx = VersionedTransaction.deserialize(propBytes)
      const signedProp = await signTransaction(propTx)
      const signedPropBase64 = btoa(String.fromCharCode(...signedProp.serialize()))
      const propSendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedPropBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const propSendData = await propSendRes.json()
      if (!propSendData.ok) throw new Error(propSendData.error || 'Proposal transaction failed')
      if (!propSendData.confirmed) throw new Error('Proposal transaction was not confirmed on-chain. Please try again.')
      const proposeSig = propSendData.signature || vtSendData.signature || ''
      const saveRes = await fetch('/api/admin/token-prices/proposals/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPubkey: publicKey.toBase58(),
          transactionIndex: buildData.transactionIndex,
          action: 'propose_signature',
          propose_signature: proposeSig,
          tokenSymbol: proposedTokenSymbol,
          proposedPrice: price,
          currentPrice: buildData.currentPrice,
          creator: publicKey.toBase58(),
        }),
      })
      const saveData = await saveRes.json()
      if (!saveData.ok) throw new Error(saveData.error || 'Failed to record proposal after on-chain confirmation')
      setTokenPriceActionResult({ type: 'propose', transactionIndex: buildData.transactionIndex, tokenSymbol: proposedTokenSymbol, price, signature: proposeSig })
      setProposedTokenPrice('')
      invalidateAdminTokenPrices()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setTokenPriceActionError(err?.message || 'Propose failed')
    } finally {
      setTokenPriceActionLoading(null)
    }
  }

  const handleTokenPriceApprove = async (transactionIndex) => {
    if (!publicKey || !signTransaction) return
    setTokenPriceActionLoading('approve-' + transactionIndex)
    setTokenPriceActionError(null)
    setTokenPriceActionResult(null)
    try {
      const buildRes = await fetch('/api/admin/squads/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: publicKey.toBase58(), transactionIndex }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build approve transaction')
      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))
      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')
      if (sendData.txError) throw new Error('Transaction failed on-chain: ' + sendData.txError)
      if (!sendData.confirmed) {
        setTokenPriceActionLoading('confirming-approve-' + transactionIndex)
        await new Promise(resolve => setTimeout(resolve, 10000))
      }
      setTokenPriceActionResult({ type: 'approve', transactionIndex, signature: sendData.signature })
      try {
        await fetch('/api/admin/token-prices/proposals/update-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userPubkey: publicKey.toBase58(), transactionIndex, action: 'approve', approve_signature: sendData.signature }),
        })
      } catch {}
      invalidateAdminTokenPrices()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setTokenPriceActionError(err?.message || 'Approve failed')
    } finally {
      setTokenPriceActionLoading(null)
    }
  }

  const handleTokenPriceExecute = async (transactionIndex) => {
    if (!publicKey || !signTransaction) return
    setTokenPriceActionLoading('execute-' + transactionIndex)
    setTokenPriceActionError(null)
    setTokenPriceActionResult(null)
    try {
      const buildRes = await fetch('/api/admin/squads/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: publicKey.toBase58(), transactionIndex }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build execute transaction')
      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))
      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')
      if (sendData.txError) throw new Error('Transaction failed on-chain: ' + sendData.txError)
      if (!sendData.confirmed) {
        setTokenPriceActionLoading('confirming-execute-' + transactionIndex)
        await new Promise(resolve => setTimeout(resolve, 10000))
      }
      setTokenPriceActionResult({ type: 'execute', transactionIndex, signature: sendData.signature })
      await new Promise(r => setTimeout(r, 3000))
      let updateSuccess = false
      for (let attempt = 0; attempt < 3 && !updateSuccess; attempt++) {
        try {
          const updateRes = await fetch('/api/admin/token-prices/proposals/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userPubkey: publicKey.toBase58(), transactionIndex, action: 'execute', execute_signature: sendData.signature }),
          })
          const updateData = await updateRes.json()
          if (updateData.ok) {
            updateSuccess = true
          } else if (attempt < 2) {
            await new Promise(r => setTimeout(r, 2000))
          }
        } catch {
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
        }
      }
      invalidateAdminTokenPrices()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setTokenPriceActionError(err?.message || 'Execute failed')
    } finally {
      setTokenPriceActionLoading(null)
    }
  }

  const handleSquadsApprove = async (transactionIndex) => {
    if (!publicKey || !signTransaction) return
    setTreasuryActionLoading('approve-' + transactionIndex)
    setTreasuryActionError(null)
    setTreasuryActionResult(null)
    try {
      const buildRes = await fetch('/api/admin/squads/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: publicKey.toBase58(), transactionIndex }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build approve transaction')
      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))
      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')
      if (sendData.txError) throw new Error('Transaction failed on-chain: ' + sendData.txError)
      if (!sendData.confirmed) {
        setTreasuryActionLoading('confirming-approve-' + transactionIndex)
        await new Promise(resolve => setTimeout(resolve, 10000))
      }
      setTreasuryActionResult({ type: 'approve', transactionIndex, signature: sendData.signature })
      try {
        const updateRes = await fetch('/api/admin/squads/proposals/update-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userPubkey: publicKey.toBase58(), transactionIndex, action: 'approve' }),
        })
        const updateData = await updateRes.json()
        if (!updateData.ok) console.warn('Proposal status update:', updateData.error)
      } catch {}
      invalidateTreasuryData()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setTreasuryActionError(err?.message || 'Approve failed')
    } finally {
      setTreasuryActionLoading(null)
    }
  }

  const handleSquadsExecute = async (transactionIndex) => {
    if (!publicKey || !signTransaction) return
    setTreasuryActionLoading('execute-' + transactionIndex)
    setTreasuryActionError(null)
    setTreasuryActionResult(null)
    try {
      const buildRes = await fetch('/api/admin/squads/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: publicKey.toBase58(), transactionIndex }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build execute transaction')
      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))
      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedBase64, blockhash: buildData.blockhash, lastValidBlockHeight: buildData.lastValidBlockHeight }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')
      if (sendData.txError) throw new Error('Transaction failed on-chain: ' + sendData.txError)
      if (!sendData.confirmed) {
        setTreasuryActionLoading('confirming-execute-' + transactionIndex)
        await new Promise(resolve => setTimeout(resolve, 10000))
      }
      setTreasuryActionResult({ type: 'execute', transactionIndex, signature: sendData.signature })
      try {
        await fetch('/api/admin/squads/proposals/update-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userPubkey: publicKey.toBase58(), transactionIndex, action: 'execute', execute_signature: sendData.signature }),
        })
      } catch {}
      invalidateTreasuryData()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setTreasuryActionError(err?.message || 'Execute failed')
    } finally {
      setTreasuryActionLoading(null)
    }
  }


  const handleSquadsCreateVault = async () => {
    if (!publicKey) return
    setTreasuryActionLoading('create-vault')
    setTreasuryActionError(null)
    setTreasuryActionResult(null)
    try {
      const res = await fetch('/api/admin/squads/create-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPubkey: publicKey.toBase58(), index: createVaultIndex }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to create vault')
      setTreasuryActionResult({ type: 'create-vault', vaultPda: data.vaultPda || data.vault, index: createVaultIndex })
      invalidateTreasuryData()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setTreasuryActionError(err?.message || 'Create vault failed')
    } finally {
      setTreasuryActionLoading(null)
    }
  }

  const handleSquadsPropose = async () => {
    if (!publicKey || !signTransaction) return
    let instructions
    try {
      instructions = JSON.parse(proposeInstructions)
      if (!Array.isArray(instructions)) throw new Error('Must be an array')
    } catch (e) {
      setTreasuryActionError('Instructions must be valid JSON array: ' + e.message)
      return
    }
    setTreasuryActionLoading('propose')
    setTreasuryActionError(null)
    setTreasuryActionResult(null)
    try {
      const res = await fetch('/api/admin/squads/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator: publicKey.toBase58(), userPubkey: publicKey.toBase58(), instructions }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to create proposal')
      if (data.vaultTransaction) {
        const vtBytes = Uint8Array.from(atob(data.vaultTransaction), c => c.charCodeAt(0))
        const vtTx = VersionedTransaction.deserialize(vtBytes)
        const signedVt = await signTransaction(vtTx)
        const signedVtBase64 = btoa(String.fromCharCode(...signedVt.serialize()))
        const vtSendRes = await fetch('/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction: signedVtBase64, blockhash: data.blockhash, lastValidBlockHeight: data.lastValidBlockHeight }),
        })
        const vtSendData = await vtSendRes.json()
        if (!vtSendData.ok) throw new Error(vtSendData.error || 'Failed to send vault transaction')
      }
      if (data.proposalTransaction) {
        const propBytes = Uint8Array.from(atob(data.proposalTransaction), c => c.charCodeAt(0))
        const propTx = VersionedTransaction.deserialize(propBytes)
        const signedProp = await signTransaction(propTx)
        const signedPropBase64 = btoa(String.fromCharCode(...signedProp.serialize()))
        const sendRes = await fetch('/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction: signedPropBase64, blockhash: data.blockhash, lastValidBlockHeight: data.lastValidBlockHeight }),
        })
        const sendData = await sendRes.json()
        if (!sendData.ok) throw new Error(sendData.error || 'Failed to send proposal transaction')
      }
      setTreasuryActionResult({ type: 'propose', transactionIndex: data.transactionIndex })
      setProposeInstructions('')
      invalidateTreasuryData()
    } catch (err) {
      if (!err?.message?.includes('User rejected')) setTreasuryActionError(err?.message || 'Propose failed')
    } finally {
      setTreasuryActionLoading(null)
    }
  }

  const handleVaultTransfer = async () => {
    if (!publicKey || !signTransaction) return
    const selectedBalance = treasuryBalances.find(b => b.symbol === vaultTransferToken)
    if (!selectedBalance) { setTreasuryActionError('Select a token'); return }
    if (!vaultTransferAmount || Number(vaultTransferAmount) <= 0) { setTreasuryActionError('Enter a valid amount'); return }
    if (!vaultTransferDest) { setTreasuryActionError('Enter a destination wallet'); return }
    setTreasuryActionLoading('vault-transfer')
    setTreasuryActionError(null)
    setTreasuryActionResult(null)
    try {
      const res = await fetch('/api/admin/squads/propose-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator: publicKey.toBase58(),
          userPubkey: publicKey.toBase58(),
          mint: selectedBalance.mint,
          destination: vaultTransferDest,
          amount: vaultTransferAmount,
          decimals: selectedBalance.decimals ?? 5,
          tokenSymbol: vaultTransferToken,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to create transfer proposal')
      if (data.vaultTransaction) {
        const vtBytes = Uint8Array.from(atob(data.vaultTransaction), c => c.charCodeAt(0))
        const vtTx = VersionedTransaction.deserialize(vtBytes)
        const signedVt = await signTransaction(vtTx)
        const signedVtBase64 = btoa(String.fromCharCode(...signedVt.serialize()))
        const vtSendRes = await fetch('/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction: signedVtBase64, blockhash: data.blockhash, lastValidBlockHeight: data.lastValidBlockHeight }),
        })
        const vtSendData = await vtSendRes.json()
        if (!vtSendData.ok) throw new Error(vtSendData.error || 'Failed to send vault transaction')
      }
      if (data.proposalTransaction) {
        const propBytes = Uint8Array.from(atob(data.proposalTransaction), c => c.charCodeAt(0))
        const propTx = VersionedTransaction.deserialize(propBytes)
        const signedProp = await signTransaction(propTx)
        const signedPropBase64 = btoa(String.fromCharCode(...signedProp.serialize()))
        const sendRes = await fetch('/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction: signedPropBase64, blockhash: data.blockhash, lastValidBlockHeight: data.lastValidBlockHeight }),
        })
        const sendData = await sendRes.json()
        if (!sendData.ok) throw new Error(sendData.error || 'Failed to send proposal')
      }
      setTreasuryActionResult({ type: 'vault-transfer', transactionIndex: data.transactionIndex, token: vaultTransferToken, amount: vaultTransferAmount, destination: vaultTransferDest })
      setVaultTransferAmount('')
      invalidateTreasuryData()
    } catch (err) {
      console.error('Vault transfer error:', err)
      if (!err?.message?.includes('User rejected')) {
        const msg = err?.message || err?.toString() || 'Transfer proposal failed'
        setTreasuryActionError(msg)
      }
    } finally {
      setTreasuryActionLoading(null)
    }
  }

  const handleTreasuryCollectFees = async () => {
    if (!publicKey) return
    setTreasuryActionLoading('collect')
    setTreasuryActionError(null)
    setTreasuryActionResult(null)
    try {
      const res = await fetch('/api/treasury/fees/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': publicKey.toBase58() },
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Collect fees failed')
      setTreasuryActionResult({ type: 'collect', harvested: data.harvested })
      invalidateTreasuryData()
    } catch (err) {
      setTreasuryActionError(err?.message || 'Collect fees failed')
    } finally {
      setTreasuryActionLoading(null)
    }
  }

  const handleTreasuryWithdrawFees = async () => {
    if (!publicKey) return
    setTreasuryActionLoading('withdraw')
    setTreasuryActionError(null)
    setTreasuryActionResult(null)
    try {
      const res = await fetch('/api/treasury/fees/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': publicKey.toBase58() },
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Withdraw fees failed')
      setTreasuryActionResult({ type: 'withdraw', total: data.total, succeeded: data.succeeded })
      invalidateTreasuryData()
    } catch (err) {
      setTreasuryActionError(err?.message || 'Withdraw fees failed')
    } finally {
      setTreasuryActionLoading(null)
    }
  }

  if (!publicKey) {
    return <Navigate to="/" replace />
  }

  if (!isAdmin && adminsLoaded) {
    return <Navigate to="/" replace />
  }

  if (!isAdmin && !adminsLoaded) {
    return null
  }

  const referralData = overviewData.referralData
  const referralTotal = overviewData.referralTotal || referralData.reduce((s, d) => s + d.value, 0)
  const referralChange = overviewData.referralChange || 0
  const trafficData = overviewData.trafficData
  const weeklyData = overviewData.weeklyData
  const mostViewedData = (overviewData.mostViewedData || []).map(d => ({ ...d, color: OVERVIEW_TOKEN_COLORS[d.name] || '#6b7280' }))
  const volume24h = overviewData.volume24h || 0
  const platformStats = overviewData.platformStats
  const visitStats = overviewData.visitStats || {}
  const pageViewsOverTime = overviewData.pageViewsOverTime || []
  const topPages = overviewData.topPages || []

  const volumeOverTime = adminData.volumeOverTime || []
  const tradeActivity = adminData.tradeActivity || []
  const volumeByToken = adminData.volumeByToken || []
  const topPerformers = adminData.topPerformers || []
  const trendingPairs = adminData.trendingPairs || []
  const trendingSwapsStats = adminData.trendingSwapsStats || { count: 0, change: 0 }
  const totalVolumeByToken = volumeByToken.reduce((s, d) => s + d.volume, 0)

  const handleCreatePool = async () => {
    if (!newPoolTokenA || !newPoolTokenB) return
    if (newPoolTokenA === newPoolTokenB) {
      setPoolCreateError('Token A and Token B must be different')
      return
    }
    if (!publicKey || !signTransaction) {
      setPoolCreateError('Connect your wallet first')
      return
    }
    const tokenA = TOKENS.find(t => t.id === newPoolTokenA)
    const tokenB = TOKENS.find(t => t.id === newPoolTokenB)
    if (!tokenA || !tokenB) return

    const feeToTick = { 0.25: 8, 0.30: 64, 0.50: 128, 1.00: 256 }
    const tickSpacing = feeToTick[newPoolFee] || 64

    setPoolCreateLoading(true)
    setPoolCreateError(null)
    setPoolCreateErrorExpanded(false)
    setPoolCreateResult(null)
    try {
      const buildRes = await fetch('/api/pools/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenX: tokenA.symbol,
          tokenY: tokenB.symbol,
          tickSpacing,
          priceXUsd: 1,
          priceYUsd: 1,
          userPubkey: publicKey.toBase58(),
        }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build pool transaction')

      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))

      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: signedBase64,
          blockhash: buildData.blockhash,
          lastValidBlockHeight: buildData.lastValidBlockHeight,
          updateChannels: ['pools:update', 'prices:update'],
          updateDetail: 'pool_created',
          tradeMeta: {
            eventType: 'pool_created',
            tokenA: tokenA.symbol,
            tokenB: tokenB.symbol,
            tokenAMint: buildData.summary?.mintA || '',
            tokenBMint: buildData.summary?.mintB || '',
            amountIn: 0,
            amountOut: 0,
            price: 0,
            poolAddress: buildData.summary?.poolAddress || '',
            wallet: publicKey.toBase58(),
          },
        }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')

      const poolAddress = buildData.summary?.poolAddress || ''
      const feeToTick = { 0.25: 8, 0.30: 64, 0.50: 128, 1.00: 256 }

      try {
        await fetch('/api/admin/pools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token_a_symbol: tokenA.symbol,
            token_b_symbol: tokenB.symbol,
            token_a_mint: buildData.summary?.mintA || '',
            token_b_mint: buildData.summary?.mintB || '',
            pool_address: poolAddress,
            tick_spacing: feeToTick[newPoolFee] || 64,
            fee_tier: newPoolFee,
            tx_signature: sendData.signature || '',
          }),
        })
      } catch (dbErr) {
        console.error('Failed to save pool to database:', dbErr)
      }

      loadFullPoolData()

      setPoolCreateResult({
        signature: sendData.signature,
        pair: `${tokenA.symbol}/${tokenB.symbol}`,
        poolAddress,
      })
      setNewPoolTokenA('')
      setNewPoolTokenB('')
      setNewPoolFee(0.30)
      setNewPoolAmountA('')
      setNewPoolAmountB('')
    } catch (err) {
      const msg = err?.message || 'Pool creation failed'
      if (!msg.includes('User rejected')) {
        setPoolCreateError(msg)
      }
    } finally {
      setPoolCreateLoading(false)
    }
  }

  const handleCollectFees = async (pool) => {
    if (!publicKey || !signTransaction) {
      setCollectFeeError('Connect your wallet first')
      return
    }
    if (!pool.poolAddress) {
      setCollectFeeError('No pool address found')
      return
    }
    setCollectFeeLoading(pool.id)
    setCollectFeeError(null)
    setCollectFeeResult(null)
    try {
      const walletAddr = publicKey.toBase58()
      const feesRes = await fetch(`/api/fees?poolAddress=${pool.poolAddress}&userPubkey=${walletAddr}`)
      const feesData = await feesRes.json()
      if (!feesData.ok || !feesData.positions || feesData.positions.length === 0) {
        throw new Error('No positions owned by your wallet found in this pool')
      }

      const posWithFees = feesData.positions.find(p => p.feeOwedA !== '0' || p.feeOwedB !== '0')
      if (!posWithFees) {
        setCollectFeeError('No fees to collect from this pool')
        return
      }

      const buildRes = await fetch('/api/fees/collect/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionMint: posWithFees.positionMint,
          userPubkey: walletAddr,
        }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build collect fees transaction')

      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))

      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: signedBase64,
          blockhash: buildData.blockhash,
          lastValidBlockHeight: buildData.lastValidBlockHeight,
          updateChannels: ['balances:update', 'pools:update'],
          updateDetail: 'fees_collected',
          tradeMeta: {
            eventType: 'fee_collection',
            tokenA: pool.tokenA.symbol,
            tokenB: pool.tokenB.symbol,
            tokenAMint: '',
            tokenBMint: '',
            amountIn: buildData.summary?.feeOwedA || 0,
            amountOut: buildData.summary?.feeOwedB || 0,
            price: 0,
            poolAddress: pool.poolAddress,
            wallet: publicKey.toBase58(),
          },
        }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')

      setCollectFeeResult({
        signature: sendData.signature,
        pool: `${pool.tokenA.symbol}/${pool.tokenB.symbol}`,
        feeA: buildData.summary?.feeOwedA || '0',
        feeB: buildData.summary?.feeOwedB || '0',
      })

      setPoolFees(prev => ({ ...prev, [pool.id]: { ...prev[pool.id], totalFeeOwedA: '0', totalFeeOwedB: '0', positions: [] } }))
      loadFullPoolData()
    } catch (err) {
      const msg = err?.message || 'Collect fees failed'
      if (!msg.includes('User rejected')) {
        setCollectFeeError(msg)
      }
    } finally {
      setCollectFeeLoading(null)
    }
  }

  const handleTogglePoolStatus = (poolId) => {
    setPools(prev => prev.map(p =>
      p.id === poolId ? { ...p, status: p.status === 'active' ? 'paused' : 'active' } : p
    ))
  }

  const handleRemovePool = (poolId) => {
    setPools(prev => prev.filter(p => p.id !== poolId))
  }

  const handleLockLiquidity = () => {
    if (!lockPoolId) return
    const pool = pools.find(p => p.id === lockPoolId)
    if (!pool) return
    const amount = lockAmount && parseFloat(lockAmount) > 0 ? parseFloat(lockAmount) : pool.tvl
    const unlockDate = lockPeriod === -1
      ? 'Permanent'
      : new Date(Date.now() + lockPeriod * 86400000).toLocaleDateString()
    const newLock = {
      id: `lock-${Date.now()}`,
      poolId: lockPoolId,
      pair: `${pool.tokenA.symbol}/${pool.tokenB.symbol}`,
      amount,
      liquidity: pool.liquidity || '0',
      reserveA: pool.reserveA || '0',
      reserveB: pool.reserveB || '0',
      poolAddress: pool.poolAddress || null,
      price: pool.price || 0,
      lockDate: new Date().toLocaleDateString(),
      unlockDate,
      lockPeriod,
      status: 'locked',
      source: 'manual',
    }
    setLockedPositions(prev => [...prev, newLock])
    setShowLockForm(false)
    setLockPoolId('')
    setLockAmount('')
    setLockPeriod(90)
  }

  const handleUnlockPosition = (lockId) => {
    setLockedPositions(prev => prev.filter(l => l.id !== lockId))
  }

  const fetchLiqBalances = async (poolId) => {
    if (!poolId || !publicKey) { setLiqBalances(null); return }
    const pool = pools.find(p => p.id === poolId)
    if (!pool || !pool.poolAddress) { setLiqBalances(null); return }
    setLiqBalancesLoading(true)
    try {
      const res = await fetch(`/api/liquidity/balances?userPubkey=${publicKey.toBase58()}&tokenX=${encodeURIComponent(pool.tokenA.symbol)}&tokenY=${encodeURIComponent(pool.tokenB.symbol)}`)
      const data = await res.json()
      if (data.ok) {
        setLiqBalances({ tokenX: data.tokenX, tokenY: data.tokenY })
      } else {
        setLiqBalances(null)
      }
    } catch {
      setLiqBalances(null)
    } finally {
      setLiqBalancesLoading(false)
    }
  }

  useEffect(() => {
    fetchLiqBalances(liqPoolId)
  }, [liqPoolId, publicKey])

  const liqAmountAExceedsBalance = liqBalances && liqAmountA && Number(liqAmountA) > liqBalances.tokenX.available
  const liqAmountBExceedsBalance = liqBalances && liqAmountB && Number(liqAmountB) > liqBalances.tokenY.available

  const handleAddLiquidity = async () => {
    if (!liqPoolId || !liqAmountA || !liqAmountB) return
    if (!publicKey || !signTransaction) {
      setLiqError('Connect your wallet first')
      return
    }
    const pool = pools.find(p => p.id === liqPoolId)
    if (!pool || !pool.poolAddress) {
      setLiqError('Pool not found or has no on-chain address')
      return
    }
    if (liqAmountAExceedsBalance || liqAmountBExceedsBalance) {
      setLiqError('Amount exceeds available balance. Reduce amounts or check your wallet.')
      return
    }
    setLiqLoading(true)
    setLiqError(null)
    setLiqResult(null)
    try {
      const buildRes = await fetch('/api/liquidity/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poolAddress: pool.poolAddress,
          tokenX: pool.tokenA.symbol,
          tokenY: pool.tokenB.symbol,
          amountXUi: liqAmountA,
          amountYUi: liqAmountB,
          decimalsX: 5,
          decimalsY: 5,
          slippageBps: 100,
          userPubkey: publicKey.toBase58(),
        }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build liquidity transaction')

      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))

      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: signedBase64,
          blockhash: buildData.blockhash,
          lastValidBlockHeight: buildData.lastValidBlockHeight,
          updateChannels: ['pools:update', 'balances:update', 'prices:update'],
          updateDetail: 'liquidity_added',
          tradeMeta: {
            eventType: 'add_liquidity',
            tokenA: pool.tokenA.symbol,
            tokenB: pool.tokenB.symbol,
            tokenAMint: '',
            tokenBMint: '',
            amountIn: liqAmountA,
            amountOut: liqAmountB,
            price: 0,
            poolAddress: pool.poolAddress,
            wallet: publicKey.toBase58(),
          },
        }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')
      if (sendData.txError) throw new Error(sendData.txError)

      const addedPositionMint = buildData.summary?.positionMint || null
      if (addedPositionMint) {
        setPools(prev => prev.map(p => {
          if (p.id === liqPoolId) {
            const existing = p.positionMints || []
            return { ...p, positionMints: [...existing, addedPositionMint] }
          }
          return p
        }))
      }

      loadFullPoolData()
      fetchLiqBalances(liqPoolId)

      setLiqResult({
        signature: sendData.signature,
        pool: `${pool.tokenA.symbol}/${pool.tokenB.symbol}`,
        amountA: liqAmountA,
        amountB: liqAmountB,
        positionMint: addedPositionMint,
      })
      setLiqAmountA('')
      setLiqAmountB('')
      setLiqPoolId('')
    } catch (err) {
      const msg = err?.message || 'Add liquidity failed'
      if (!msg.includes('User rejected')) {
        setLiqError(msg)
      }
    } finally {
      setLiqLoading(false)
    }
  }

  const handleRemoveLiquidity = async (lock) => {
    if (!publicKey || !signTransaction) {
      setRemoveLiqError('Connect your wallet first')
      return
    }
    if (!lock.poolAddress) {
      setRemoveLiqError('No pool address found for this position')
      return
    }
    setRemoveLiqLoading(lock.id)
    setRemoveLiqError(null)
    setRemoveLiqResult(null)
    try {
      const walletAddr = publicKey.toBase58()
      const posRes = await fetch(`/api/positions?poolAddress=${lock.poolAddress}&userPubkey=${walletAddr}`)
      const posData = await posRes.json()
      if (!posData.ok || !posData.positions || posData.positions.length === 0) {
        throw new Error('No positions owned by your wallet found in this pool')
      }

      const position = posData.positions[0]

      const buildRes = await fetch('/api/liquidity/remove/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionMint: position.positionMint,
          slippageBps: 100,
          userPubkey: walletAddr,
          tokenMintA: lock.tokenMintA || '',
          tokenMintB: lock.tokenMintB || '',
        }),
      })
      const buildData = await buildRes.json()
      if (!buildData.ok) throw new Error(buildData.error || 'Failed to build remove liquidity transaction')

      const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0))
      const transaction = VersionedTransaction.deserialize(txBytes)
      const signed = await signTransaction(transaction)
      const signedBase64 = btoa(String.fromCharCode(...signed.serialize()))

      const sendRes = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: signedBase64,
          blockhash: buildData.blockhash,
          lastValidBlockHeight: buildData.lastValidBlockHeight,
          updateChannels: ['pools:update', 'balances:update', 'prices:update'],
          updateDetail: 'liquidity_removed',
          tradeMeta: {
            eventType: 'remove_liquidity',
            tokenA: lock.pair?.split('/')[0] || '',
            tokenB: lock.pair?.split('/')[1] || '',
            tokenAMint: lock.tokenMintA || '',
            tokenBMint: lock.tokenMintB || '',
            amountIn: 0,
            amountOut: 0,
            price: 0,
            poolAddress: lock.poolAddress,
            wallet: publicKey.toBase58(),
          },
        }),
      })
      const sendData = await sendRes.json()
      if (!sendData.ok) throw new Error(sendData.error || 'Failed to send transaction')

      setRemoveLiqResult({
        signature: sendData.signature,
        pool: lock.pair,
      })

      loadFullPoolData()
    } catch (err) {
      const msg = err?.message || 'Remove liquidity failed'
      if (!msg.includes('User rejected')) {
        setRemoveLiqError(msg)
      }
    } finally {
      setRemoveLiqLoading(null)
    }
  }

  const totalLockedValue = lockedPositions.reduce((sum, l) => sum + l.amount, 0)
  const poolsWithLocks = new Set(lockedPositions.map(l => l.poolId)).size

  const fmtCurr = (val) => {
    const converted = val * currency.rate
    if (converted >= 1e9) return `${currency.symbol}${(converted / 1e9).toFixed(2)}B`
    if (converted >= 1e6) return `${currency.symbol}${(converted / 1e6).toFixed(2)}M`
    if (converted >= 1000) return `${currency.symbol}${converted.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    return `${currency.symbol}${converted.toFixed(2)}`
  }

  const fmtShort = (val) => {
    const converted = val * currency.rate
    if (converted >= 1000) return `${currency.symbol}${(converted / 1000).toFixed(2)}k`
    return `${currency.symbol}${converted.toFixed(2)}`
  }

  const fmtCount = (val) => {
    if (val >= 1000) return `${(val / 1000).toFixed(1)}k`
    return `${val}`
  }

  const allTabs = [
    { id: 'overview', label: t('admin_tab_overview') },
    { id: 'setup', label: 'Setup' },
    { id: 'pools', label: t('admin_tab_pools') },
    { id: 'liquidity', label: t('admin_tab_liquidity') },
    { id: 'contact', label: 'Contact' },
    { id: 'treasury', label: 'Treasury' },
    { id: 'swap-limits', label: 'Swap Limits' },
    { id: 'referral-rewards', label: 'Referral Rewards' },
    { id: 'token-prices', label: 'Token Prices' },
    { id: 'purchases', label: 'Purchases' },
    { id: 'performance', label: 'Performance' },
    { id: 'net-permissions', label: 'Network Permissions' },
    { id: 'settings', label: t('admin_tab_settings') },
  ]

  const tabs = adminRole === 'admin'
    ? allTabs.filter(tab => adminTabAllowList.has(tab.id))
    : allTabs

  const totalMostViewed = mostViewedData.reduce((s, d) => s + d.value, 0)

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div className="admin-header-left">
          <div className="admin-breadcrumb">Analytics / {analyticsMenu.find(a => a.id === activeAnalytics)?.label || 'Aggregated'}</div>
          <h1 className="admin-title">{analyticsMenu.find(a => a.id === activeAnalytics)?.label || 'Aggregated'}</h1>
        </div>
        <div className="admin-header-right">
          <div className="admin-time-filters">
            {['all', 'week', 'month', 'year'].map(p => (
              <button key={p} className={`admin-time-btn ${timePeriod === p ? 'active' : ''}`} onClick={() => setTimePeriod(p)}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <div className="admin-date-range">
            <Calendar size={14} /> {timePeriod === 'week' ? 'Last 7 Days' : timePeriod === 'month' ? 'Last 30 Days' : timePeriod === 'year' ? 'Jan 2025 - Dec 2025' : '18 Jan, 2025 - 18 Jun, 2025'}
          </div>
        </div>
      </div>

      <div className="admin-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`admin-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="admin-body-layout">
        <div className="admin-sidebar-nav">
          <div className="admin-sidebar-section">
            <div className="admin-sidebar-title">Analytics</div>
            {analyticsMenu.map(item => (
              <div
                key={item.id}
                className={`admin-sidebar-item ${activeAnalytics === item.id ? 'active' : ''}`}
                onClick={() => { setActiveAnalytics(item.id); setAllowedActiveTab('overview'); }}
              >
                {item.label}
                {activeAnalytics === item.id && <span className="admin-sidebar-dot"></span>}
              </div>
            ))}
          </div>
          <div className="admin-sidebar-section">
            <div className="admin-sidebar-title">Reports</div>
          </div>
        </div>

        <div className="admin-main-content">
          {activeTab === 'overview' && activeAnalytics === 'aggregated' && canAccessTab('overview', adminRole) && (
            <div className="admin-overview">
              <div className="admin-stats-grid">
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">{t('admin_total_users')}</span>
                    <span className="admin-stat-arrow">↗</span>
                  </div>
                  <span className="admin-stat-value">{fmtCount(platformStats.totalUsers || 0)}</span>
                  <span className="admin-stat-change positive">▲ {platformStats.usersChange}%</span>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">{t('admin_total_volume')}</span>
                    <span className="admin-stat-arrow">↗</span>
                  </div>
                  <span className="admin-stat-value">{fmtShort(platformStats.totalVolume)}</span>
                  <span className={`admin-stat-change ${platformStats.volumeChange >= 0 ? 'positive' : 'negative'}`}>{platformStats.volumeChange >= 0 ? '▲' : '▼'} {Math.abs(platformStats.volumeChange)}%</span>
                </div>
                <div className="admin-stat-card admin-stat-clickable" onClick={() => setShowFeesPopup(true)}>
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Total Fees</span>
                    <span className="admin-stat-arrow">↗</span>
                  </div>
                  <span className="admin-stat-value">{fmtShort(platformStats.totalFees)}</span>
                  <span className={`admin-stat-change ${platformStats.feesChange >= 0 ? 'positive' : 'negative'}`}>{platformStats.feesChange >= 0 ? '▲' : '▼'} {Math.abs(platformStats.feesChange)}%</span>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Total TVL</span>
                    <span className="admin-stat-arrow">↗</span>
                  </div>
                  <span className="admin-stat-value">{fmtCurr(platformStats.totalTVL)}</span>
                  <span className="admin-stat-change positive">▲ {platformStats.tvlChange}%</span>
                </div>
              </div>

              <div className="admin-charts-row">
                <div className="admin-card admin-chart-card">
                  <div className="admin-chart-header">
                    <h3>Referral Percentages</h3>
                  </div>
                  <div className="admin-chart-value-row">
                    <span className="admin-chart-big-value">{fmtShort(referralTotal)}</span>
                    <span className={`admin-stat-change ${referralChange >= 0 ? 'positive' : 'negative'}`}>{referralChange >= 0 ? '▲' : '▼'} {Math.abs(referralChange)}%</span>
                  </div>
                  <div className="admin-chart-container">
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={referralData}>
                        <defs>
                          <linearGradient id="refGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12 }} />
                        <Area type="monotone" dataKey="value" stroke="#a855f7" fill="url(#refGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="admin-card admin-chart-card">
                  <div className="admin-chart-header">
                    <h3>Traffic Source</h3>
                    <div className="admin-chart-legend">
                      <span className="admin-legend-item"><span className="admin-legend-dot" style={{background: '#22c55e'}}></span> Search Engine</span>
                      <span className="admin-legend-item"><span className="admin-legend-dot" style={{background: '#a855f7'}}></span> Direct</span>
                    </div>
                  </div>
                  <div className="admin-chart-container">
                    <ResponsiveContainer width="100%" height={230}>
                      <ComposedChart data={trafficData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12 }} />
                        <Bar dataKey="search" fill="#a855f7" radius={[2, 2, 0, 0]} barSize={8} />
                        <Line type="monotone" dataKey="direct" stroke="#22c55e" strokeWidth={2} dot={{ fill: '#22c55e', r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="admin-charts-row">
                <div className="admin-card admin-chart-card">
                  <div className="admin-chart-header">
                    <h3>Weekly Visitors</h3>
                    <div className="admin-chart-legend">
                      <span className="admin-legend-item"><span className="admin-legend-dot" style={{background: '#a855f7'}}></span> New visitors</span>
                      <span className="admin-legend-item"><span className="admin-legend-dot" style={{background: '#6b7280'}}></span> Returning visitors</span>
                    </div>
                  </div>
                  <div className="admin-chart-container">
                    <ResponsiveContainer width="100%" height={230}>
                      <AreaChart data={weeklyData}>
                        <defs>
                          <linearGradient id="newGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6b7280" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#6b7280" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12 }} />
                        <Area type="monotone" dataKey="returning" stroke="#6b7280" fill="url(#retGrad)" strokeWidth={2} />
                        <Area type="monotone" dataKey="newVisitors" stroke="#a855f7" fill="url(#newGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="admin-card admin-chart-card">
                  <div className="admin-chart-header">
                    <h3>Most Viewed</h3>
                    <span className="admin-chart-sub">{timePeriod === 'week' ? 'Last 7 Days' : timePeriod === 'month' ? 'Last 30 Days' : timePeriod === 'year' ? 'Last Year' : 'All Time'}</span>
                  </div>
                  <div className="admin-most-viewed-content">
                    <div className="admin-most-viewed-list">
                      {mostViewedData.map(item => (
                        <div key={item.name} className="admin-most-viewed-item">
                          <span className="admin-legend-dot" style={{background: item.color}}></span>
                          <span className="admin-mv-name">{item.name}</span>
                          <span className="admin-mv-value">{fmtCurr(item.value)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="admin-donut-wrapper">
                      <ResponsiveContainer width={160} height={160}>
                        <PieChart>
                          <Pie data={mostViewedData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} dataKey="value" strokeWidth={0}>
                            {mostViewedData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="admin-donut-center">
                        <span className="admin-donut-label">Volume (24h)</span>
                        <span className="admin-donut-value">{fmtShort(volume24h)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'overview' && activeAnalytics === 'trending' && canAccessTab('overview', adminRole) && (() => {
            const sortedPerformers = [...topPerformers].sort((a, b) => b.change24h - a.change24h);
            const topGainer = sortedPerformers[0] || { symbol: '-', change24h: 0 };
            const topLoser = sortedPerformers[sortedPerformers.length - 1] || { symbol: '-', change24h: 0 };
            const mostTraded = [...topPerformers].sort((a, b) => b.volume24h - a.volume24h)[0] || { symbol: '-', change24h: 0 };
            const trendingSwapsCount = trendingSwapsStats.count;
            const swapsChange = trendingSwapsStats.change;

            const ALL_TOKEN_IDS = ['ntc','asdc','edc','rdc','dmc','bdc','ydc','sdc','cdc','adc','sgdc'];
            const priceTrendKeys = Object.keys(priceTrends || {});
            const priceTrendLabels = priceTrendKeys.length > 0 ? (priceTrends[priceTrendKeys[0]] || []).map(p => p.label) : [];
            const priceTrendData = priceTrendLabels.map((label, idx) => {
              const point = { t: label };
              ALL_TOKEN_IDS.forEach(tid => {
                const series = (priceTrends || {})[tid] || [];
                point[tid] = series[idx] ? series[idx].price : 0;
              });
              return point;
            });

            const volumeChartData = volumeByToken.map(d => ({ name: d.name, vol: d.volume }));

            return (
            <div className="admin-overview">
              <div className="admin-stats-grid">
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Top Gainer</span>
                    <span className="admin-stat-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg></span>
                  </div>
                  <span className="admin-stat-value">{topGainer.symbol}</span>
                  <span className={`admin-stat-change ${topGainer.change24h >= 0 ? 'positive' : 'negative'}`}>{topGainer.change24h >= 0 ? '▲' : '▼'} {Math.abs(topGainer.change24h)}%</span>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Top Loser</span>
                    <span className="admin-stat-arrow"><TrendingDown size={14} /></span>
                  </div>
                  <span className="admin-stat-value">{topLoser.symbol}</span>
                  <span className={`admin-stat-change ${topLoser.change24h >= 0 ? 'positive' : 'negative'}`}>{topLoser.change24h >= 0 ? '▲' : '▼'} {Math.abs(topLoser.change24h)}%</span>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Most Traded</span>
                    <span className="admin-stat-arrow"><BarChartIcon size={14} /></span>
                  </div>
                  <span className="admin-stat-value">{mostTraded.symbol}</span>
                  <span className={`admin-stat-change ${mostTraded.change24h >= 0 ? 'positive' : 'negative'}`}>{mostTraded.change24h >= 0 ? '▲' : '▼'} {Math.abs(mostTraded.change24h)}%</span>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Trending Swaps</span>
                    <span className="admin-stat-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>
                  </div>
                  <span className="admin-stat-value">{trendingSwapsCount.toLocaleString()}</span>
                  <span className={`admin-stat-change ${swapsChange >= 0 ? 'positive' : 'negative'}`}>{swapsChange >= 0 ? '▲' : '▼'} {Math.abs(swapsChange)}%</span>
                </div>
              </div>

              <div className="admin-charts-row">
                <div className="admin-card admin-chart-card">
                  <div className="admin-chart-header">
                    <h3>Token Price Trends</h3>
                    <div className="admin-chart-legend">
                      {ALL_TOKEN_IDS.filter(tid => priceTrendKeys.includes(tid)).map(tid => (
                        <span key={tid} className="admin-legend-item"><span className="admin-legend-dot" style={{background: OVERVIEW_TOKEN_COLORS[tid.toUpperCase()] || '#6b7280'}}></span> {tid.toUpperCase()}</span>
                      ))}
                    </div>
                  </div>
                  <div className="admin-chart-container">
                    <ResponsiveContainer width="100%" height={230}>
                      <AreaChart data={priceTrendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="t" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                        <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12 }} />
                        {ALL_TOKEN_IDS.filter(tid => priceTrendKeys.includes(tid)).map(tid => (
                          <Area key={tid} type="monotone" dataKey={tid} stroke={OVERVIEW_TOKEN_COLORS[tid.toUpperCase()] || '#6b7280'} fill="none" strokeWidth={2} />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="admin-card admin-chart-card">
                  <div className="admin-chart-header">
                    <h3>Swap Volume by Token</h3>
                  </div>
                  <div className="admin-chart-container">
                    <ResponsiveContainer width="100%" height={230}>
                      <ComposedChart data={volumeChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12 }} formatter={(v) => fmtCurr(v)} />
                        <Bar dataKey="vol" fill="#a855f7" radius={[4, 4, 0, 0]} barSize={20} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="admin-card" style={{ marginTop: 16 }}>
                <h3 style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-primary)' }}>Trending Pairs (24h)</h3>
                <div className="admin-pool-table">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th><th>Pair</th><th>Price</th><th>24h Change</th><th>Volume</th><th>Swaps</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendingPairs.map((row, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td style={{ fontWeight: 600 }}>{row.pair}</td>
                          <td>{fmtCurr(row.price)}</td>
                          <td><span className={row.change >= 0 ? 'admin-status-active' : 'admin-status-paused'}>{row.change >= 0 ? '+' : ''}{row.change}%</span></td>
                          <td>{fmtCurr(row.volume || row.vol)}</td>
                          <td>{(row.swaps || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            );
          })()}

          {activeTab === 'overview' && activeAnalytics === 'most-visited' && canAccessTab('overview', adminRole) && (
            <div className="admin-overview">
              <div className="admin-stats-grid">
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Page Views</span>
                    <span className="admin-stat-arrow"><Eye size={14} /></span>
                  </div>
                  <span className="admin-stat-value">{fmtCount(visitStats.pageViews || 0)}</span>
                  <span className={`admin-stat-change ${(visitStats.pageViewsChange || 0) >= 0 ? 'positive' : 'negative'}`}>{(visitStats.pageViewsChange || 0) >= 0 ? '▲' : '▼'} {Math.abs(visitStats.pageViewsChange || 0)}%</span>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Unique Visitors</span>
                    <span className="admin-stat-arrow"><User size={14} /></span>
                  </div>
                  <span className="admin-stat-value">{fmtCount(visitStats.uniqueVisitors || 0)}</span>
                  <span className={`admin-stat-change ${(visitStats.uniqueVisitorsChange || 0) >= 0 ? 'positive' : 'negative'}`}>{(visitStats.uniqueVisitorsChange || 0) >= 0 ? '▲' : '▼'} {Math.abs(visitStats.uniqueVisitorsChange || 0)}%</span>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Avg. Session</span>
                    <span className="admin-stat-arrow"><Clock size={14} /></span>
                  </div>
                  <span className="admin-stat-value">{visitStats.avgSession || '0m 0s'}</span>
                  <span className={`admin-stat-change ${(visitStats.avgSessionChange || 0) >= 0 ? 'positive' : 'negative'}`}>{(visitStats.avgSessionChange || 0) >= 0 ? '▲' : '▼'} {Math.abs(visitStats.avgSessionChange || 0)}%</span>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Bounce Rate</span>
                    <span className="admin-stat-arrow">↩</span>
                  </div>
                  <span className="admin-stat-value">{visitStats.bounceRate || 0}%</span>
                  <span className={`admin-stat-change ${(visitStats.bounceRateChange || 0) >= 0 ? 'positive' : 'negative'}`}>{(visitStats.bounceRateChange || 0) >= 0 ? '▼' : '▲'} {Math.abs(visitStats.bounceRateChange || 0)}%</span>
                </div>
              </div>

              <div className="admin-charts-row">
                <div className="admin-card admin-chart-card">
                  <div className="admin-chart-header">
                    <h3>Page Views Over Time</h3>
                  </div>
                  <div className="admin-chart-container">
                    <ResponsiveContainer width="100%" height={230}>
                      <AreaChart data={pageViewsOverTime}>
                        <defs>
                          <linearGradient id="pvGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="d" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12 }} />
                        <Area type="monotone" dataKey="views" stroke="#22c55e" fill="url(#pvGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="admin-card admin-chart-card">
                  <div className="admin-chart-header">
                    <h3>Top Pages</h3>
                  </div>
                  <div className="admin-most-viewed-content" style={{ flexDirection: 'column', gap: 8 }}>
                    {topPages.map((p, i) => (
                      <div key={i} className="admin-most-viewed-item" style={{ width: '100%' }}>
                        <span style={{ width: 24, color: '#6b7280', fontSize: 12 }}>{i + 1}</span>
                        <span className="admin-mv-name" style={{ flex: 1 }}>{p.page}</span>
                        <span style={{ color: '#6b7280', fontSize: 12, marginRight: 12 }}>{(p.views || 0).toLocaleString()} views</span>
                        <div style={{ width: 80, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${p.pct}%`, height: '100%', background: '#a855f7', borderRadius: 3 }}></div>
                        </div>
                        <span style={{ color: '#a855f7', fontSize: 12, width: 40, textAlign: 'right' }}>{p.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}


          {activeTab === 'setup' && canAccessTab('setup', adminRole) && (
            <div className="admin-setup">
              {setupLoading && !setupStatus && (
                <div className="admin-card" style={{ textAlign: 'center', padding: '2rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Loading setup status...</span>
                </div>
              )}

              {setupError && (
                <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 13 }}>
                  {setupError}
                  <button onClick={() => setSetupError(null)} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 600 }}>Dismiss</button>
                </div>
              )}
              {setupSuccess && (
                <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16, background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {setupSuccess}
                  <button onClick={() => setSetupSuccess(null)} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#22c55e', cursor: 'pointer', fontWeight: 600 }}>Dismiss</button>
                </div>
              )}

              <div className="admin-card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ margin: 0 }}>Step 0: Program Configuration</h3>
                  {setupStatus?.programs?.configured && <span style={{ color: '#22c55e', fontWeight: 600 }}>Configured</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ width: 200, fontSize: 13, color: 'var(--text-secondary)' }}>Token Core Program ID</label>
                    <input type="text" value={programIds.token_core_program_id} onChange={e => setProgramIds(p => ({ ...p, token_core_program_id: e.target.value }))}
                      placeholder="ENUdgcb94W7eQbznGkTAuJ6DkjPFJpsruZGdVGhcoqXd" style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input, var(--bg-secondary))', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace' }} />
                  </div>
                  <button className="admin-btn admin-btn-save" onClick={handleSaveProgramIds}
                    disabled={setupActionLoading === 'programs' || !publicKey}
                    style={{ alignSelf: 'flex-end', marginTop: 8, padding: '8px 24px' }}>
                    {setupActionLoading === 'programs' ? 'Saving...' : 'Save Program IDs'}
                  </button>
                </div>
              </div>

              <div className="admin-card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ margin: 0 }}>Step 1: Multisig Owners</h3>
                  {setupStatus?.multisigOwners?.configured && <span style={{ color: '#22c55e', fontWeight: 600 }}>Saved</span>}
                </div>
                {setupStatus?.multisigOwners?.configured ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                    <div><strong>Owner 1:</strong> {setupStatus.multisigOwners.data?.owner1}</div>
                    <div><strong>Owner 2:</strong> {setupStatus.multisigOwners.data?.owner2}</div>
                    <div><strong>Owner 3:</strong> {setupStatus.multisigOwners.data?.owner3}</div>
                    <button className="admin-btn" onClick={() => {
                      setMultisigOwners({ owner1: setupStatus.multisigOwners.data?.owner1 || '', owner2: setupStatus.multisigOwners.data?.owner2 || '', owner3: setupStatus.multisigOwners.data?.owner3 || '' })
                      setSetupStatus(prev => ({ ...prev, multisigOwners: { configured: false, data: prev?.multisigOwners?.data } }))
                    }} style={{ alignSelf: 'flex-end', padding: '6px 16px', marginTop: 8, fontSize: 12, background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 6, color: '#a855f7', cursor: 'pointer' }}>
                      Edit Owners
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {['owner1', 'owner2', 'owner3'].map((key, i) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <label style={{ width: 100, fontSize: 13, color: 'var(--text-secondary)' }}>Owner {i + 1}</label>
                        <input type="text" value={multisigOwners[key]} onChange={e => setMultisigOwners(p => ({ ...p, [key]: e.target.value }))}
                          placeholder="Wallet address" style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input, var(--bg-secondary))', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace' }} />
                        {i === 0 && publicKey && !multisigOwners.owner1 && (
                          <button style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 6, color: '#a855f7', cursor: 'pointer' }}
                            onClick={() => setMultisigOwners(p => ({ ...p, owner1: publicKey.toBase58() }))}>Use Connected</button>
                        )}
                      </div>
                    ))}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>These wallet addresses will be used as owners for the Squads multisig vault</div>
                    <button className="admin-btn admin-btn-save" onClick={handleSaveMultisigOwners}
                      disabled={setupActionLoading === 'multisig-owners' || !publicKey || !multisigOwners.owner1 || !multisigOwners.owner2 || !multisigOwners.owner3}
                      style={{ alignSelf: 'flex-end', padding: '8px 24px' }}>
                      {setupActionLoading === 'multisig-owners' ? 'Saving...' : 'Save Owners'}
                    </button>
                  </div>
                )}
              </div>

              <div className="admin-card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ margin: 0 }}>Step 2: Create Squads Multisig</h3>
                  {treasuryMultisig?.initialized && <span style={{ color: '#22c55e', fontWeight: 600 }}>Created</span>}
                  {!treasuryMultisig?.initialized && <span style={{ color: '#a855f7', fontWeight: 600 }}>Squads v4</span>}
                </div>
                {treasuryMultisig?.initialized && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
                      <div style={{ background: 'rgba(34,197,94,0.05)', borderRadius: 8, padding: '10px 14px' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Vault Address</div>
                        <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => { navigator.clipboard.writeText(treasuryMultisig.vaultPda); const el = document.getElementById('vault-copy-msg'); if(el){ el.textContent='Copied!'; setTimeout(()=>el.textContent='',1500); } }} title="Click to copy full address">
                          {treasuryMultisig.vaultPda?.slice(0, 8)}...{treasuryMultisig.vaultPda?.slice(-4)}
                          <span id="vault-copy-msg" style={{ fontSize: 10, color: '#22c55e', fontWeight: 400 }}></span>
                        </div>
                      </div>
                      <div style={{ background: 'rgba(34,197,94,0.05)', borderRadius: 8, padding: '10px 14px' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Threshold</div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{treasuryMultisig.threshold}-of-{treasuryMultisig.members?.length || 0}</div>
                      </div>
                      <div style={{ background: 'rgba(34,197,94,0.05)', borderRadius: 8, padding: '10px 14px' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Transactions</div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{treasuryMultisig.transactionIndex ?? 0}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Manage vault balances, proposals, and approvals in the <strong style={{ color: '#a855f7', cursor: 'pointer' }} onClick={() => setActiveTab('treasury')}>Treasury tab</strong>.
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Create a Squads Protocol v4 multisig vault using the owner wallets saved above.
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                    <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Threshold:</label>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#a855f7' }}>2-of-3</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>2 approvals required out of 3 owners to execute transactions</span>
                  </div>
                  <button className="admin-btn admin-btn-save" onClick={handleSetupCreateSquadsMultisig}
                    disabled={setupActionLoading === 'create-squads' || !publicKey || !multisigOwners.owner1 || !multisigOwners.owner2}
                    style={{ alignSelf: 'flex-end', padding: '8px 24px' }}>
                    {setupActionLoading === 'create-squads' ? (multisigRetrying ? 'Creating Multisig... (retrying)' : 'Creating Multisig...') : 'Create Squads Multisig'}
                  </button>
                  {(!multisigOwners.owner1 || !multisigOwners.owner2) && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Save owner wallets in Step 1 first</span>
                  )}
                </div>
              </div>

              <div className="admin-card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ margin: 0 }}>Step 3: Initialize Tokens</h3>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {setupStatus?.tokens?.count || 0} / {setupStatus?.tokens?.total || 0} initialized
                  </span>
                </div>
                {!treasuryMultisig?.initialized && (
                  <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, color: '#ef4444', fontSize: 12, marginBottom: 12 }}>
                    Complete Step 2 (Create Squads Multisig) first. Tokens are minted to the treasury vault.
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(setupStatus?.tokens?.total > 0 ? [
                          { name: 'Nite Treasury Currency', symbol: 'NTC', supply: '120000000000000', decimals: 5 },
                          { name: 'America States Digital Currency', symbol: 'ASDC', supply: '5000000000000', decimals: 5 },
                          { name: 'Euro Digital Currency', symbol: 'EDC', supply: '5000000000000', decimals: 5 },
                          { name: 'Brazil Digital Currency', symbol: 'RDC', supply: '5000000000000', decimals: 5 },
                          { name: 'Yuan Digital Currency', symbol: 'YDC', supply: '5000000000000', decimals: 5 },
                          { name: 'Swiss Digital Currency', symbol: 'SDC', supply: '5000000000000', decimals: 5 },
                          { name: 'Canadian Digital Currency', symbol: 'CDC', supply: '5000000000000', decimals: 5 },
                          { name: 'Australian Digital Currency', symbol: 'ADC', supply: '5000000000000', decimals: 5 },
                          { name: 'Singapore Digital Currency', symbol: 'SGDC', supply: '5000000000000', decimals: 5 },
                          { name: 'Dome Coin', symbol: 'DMC', supply: '5000000000000', decimals: 5 },
                          { name: 'British Digital Currency', symbol: 'BDC', supply: '5000000000000', decimals: 5 },
                        ] : []).map(token => {
                    const initialized = (setupStatus?.tokens?.initialized || []).includes(token.symbol)
                    return (
                      <div key={token.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: initialized ? 'rgba(34,197,94,0.05)' : 'rgba(168,85,247,0.03)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {initialized
                            ? <span style={{ color: '#22c55e', fontSize: 16, fontWeight: 700 }}>&#10003;</span>
                            : <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>&#9675;</span>}
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{token.symbol}</span>
                          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{token.name}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Supply: {Number(token.supply).toLocaleString()}</span>
                        </div>
                        {!initialized && (
                          <button className="admin-btn admin-btn-save" onClick={() => handleInitToken(token)}
                            disabled={setupActionLoading === 'token-' + token.symbol || !publicKey || !treasuryMultisig?.initialized}
                            style={{ padding: '4px 14px', fontSize: 12 }}>
                            {setupActionLoading === 'token-' + token.symbol ? 'Creating...' : 'Init'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div style={{ padding: '10px 16px', borderRadius: 8, background: 'rgba(168,85,247,0.05)', fontSize: 12, color: 'var(--text-muted)' }}>
                Steps 4 (Create Pools) and 5 (Add Liquidity) are available in the Pools and Liquidity tabs.
              </div>
            </div>
          )}

          {activeTab === 'pools' && canAccessTab('pools', adminRole) && (
            <div className="admin-pools">
              <div className="admin-card">
                <div className="admin-pool-header">
                  <h3>{t('admin_pools_title')} {poolsLoading && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>Loading on-chain data...</span>}</h3>
                  <button className="admin-btn-primary" onClick={() => setShowCreatePool(!showCreatePool)}>
                    + {t('admin_create_pool')}
                  </button>
                </div>

                {showCreatePool && (
                  <div className="admin-pool-create-form">
                    <div className="admin-pool-form-row">
                      <div className="admin-pool-form-group">
                        <label>{t('admin_pool_token_a')}</label>
                        <select value={newPoolTokenA} onChange={e => setNewPoolTokenA(e.target.value)} className="admin-select">
                          <option value="">{t('admin_pool_select_token')}</option>
                          {TOKENS.map(tok => (
                            <option key={tok.id} value={tok.id}>{tok.symbol} - {tok.fullName}</option>
                          ))}
                        </select>
                      </div>
                      <div className="admin-pool-form-group">
                        <label>{t('admin_pool_token_b')}</label>
                        <select value={newPoolTokenB} onChange={e => setNewPoolTokenB(e.target.value)} className="admin-select">
                          <option value="">{t('admin_pool_select_token')}</option>
                          {TOKENS.filter(tok => tok.id !== newPoolTokenA).map(tok => (
                            <option key={tok.id} value={tok.id}>{tok.symbol} - {tok.fullName}</option>
                          ))}
                        </select>
                      </div>
                      <div className="admin-pool-form-group">
                        <label>{t('admin_pool_fee_tier')}</label>
                        <select value={newPoolFee} onChange={e => setNewPoolFee(parseFloat(e.target.value))} className="admin-select">
                          {FEE_TIERS.map(fee => (
                            <option key={fee.value} value={fee.value}>{fee.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="admin-pool-form-group admin-pool-form-actions">
                        <button className="admin-btn-primary" onClick={handleCreatePool} disabled={!newPoolTokenA || !newPoolTokenB || poolCreateLoading}>
                          {poolCreateLoading ? 'Creating...' : t('admin_pool_create')}
                        </button>
                        <button className="admin-btn admin-btn-cancel" onClick={() => { setShowCreatePool(false); setPoolCreateError(null); setPoolCreateErrorExpanded(false); setPoolCreateResult(null) }}>
                          {t('admin_cancel')}
                        </button>
                      </div>
                    </div>
                    {poolCreateError && (() => { const errText = String(poolCreateError || ''); return (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, color: '#ef4444', fontSize: 13, wordBreak: 'break-word', overflowWrap: 'anywhere', maxHeight: poolCreateErrorExpanded ? 'none' : 80, overflow: 'hidden', position: 'relative', cursor: errText.length > 120 ? 'pointer' : 'default' }}
                        onClick={() => { if (errText.length > 120) setPoolCreateErrorExpanded(v => !v) }}
                      >
                        {errText}
                        {errText.length > 120 && !poolCreateErrorExpanded && (
                          <span style={{ position: 'absolute', bottom: 0, right: 0, background: 'linear-gradient(90deg, transparent, rgba(30,20,20,0.95) 40%)', paddingLeft: 24, paddingRight: 4, color: '#f87171', fontSize: 11 }}>… click to expand</span>
                        )}
                      </div>
                    ); })()}
                    {poolCreateResult && (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(34, 211, 135, 0.1)', border: '1px solid rgba(34, 211, 135, 0.3)', borderRadius: 8, color: '#22d387', fontSize: 13 }}>
                        Pool {poolCreateResult.pair} created successfully!{' '}
                        <a href={explorerTxUrl(poolCreateResult.signature)} target="_blank" rel="noopener noreferrer" style={{ color: '#a855f7' }}>
                          View on Explorer
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <div className="admin-pool-table">
                  <div className="admin-pool-table-header">
                    <span>{t('admin_pool_pair')}</span>
                    <span>{t('admin_pool_fee_tier')}</span>
                    <span>{t('admin_pool_tvl')}</span>
                    <span>{t('admin_pool_volume_24h')}</span>
                    <span>{t('admin_pool_fees_earned')}</span>
                    <span>{t('admin_pool_apr')}</span>
                    <span>{t('admin_pool_status')}</span>
                    <span>{t('admin_actions')}</span>
                  </div>
                  {pools.length === 0 && !poolsLoading && (
                    <div className="admin-pool-table-row" style={{ justifyContent: 'center', padding: '24px', color: '#94a3b8', fontStyle: 'italic' }}>
                      No pools created yet. Use the "Create Pool" button above to create your first pool on-chain.
                    </div>
                  )}
                  {pools.map(pool => (
                    <div key={pool.id} className="admin-pool-table-row">
                      <span className="admin-pool-pair-cell">
                        <span className="admin-pool-pair-dots">
                          {getApiImage(pool.tokenA.id) ? (
                            <img src={getApiImage(pool.tokenA.id)} alt={pool.tokenA.symbol} style={{ width: 18, height: 18, borderRadius: '50%' }} />
                          ) : (
                            <span className="admin-token-dot" style={{ background: pool.tokenA.color }}></span>
                          )}
                          {getApiImage(pool.tokenB.id) ? (
                            <img src={getApiImage(pool.tokenB.id)} alt={pool.tokenB.symbol} style={{ width: 18, height: 18, borderRadius: '50%', marginLeft: -6 }} />
                          ) : (
                            <span className="admin-token-dot admin-token-dot-overlap" style={{ background: pool.tokenB.color }}></span>
                          )}
                        </span>
                        {pool.tokenA.symbol}/{pool.tokenB.symbol}
                      </span>
                      <span>{pool.feeTier}%</span>
                      <span>{pool.poolAddress ? fmtCurr(pool.tvl) : (poolsLoading ? '...' : '-')}</span>
                      <span>{pool.volume24h > 0 ? fmtCurr(pool.volume24h) : '-'}</span>
                      <span>
                        {(() => {
                          const fees = poolFees[pool.id]
                          if (!fees) return pool.poolAddress ? '...' : '-'
                          const feeA = parseFloat(fees.totalFeeOwedA || '0') / 1e5
                          const feeB = parseFloat(fees.totalFeeOwedB || '0') / 1e5
                          const total = feeA + feeB
                          if (total === 0) return '0'
                          return total.toFixed(2)
                        })()}
                      </span>
                      <span className="admin-pool-apr">{pool.apr > 0 ? `${pool.apr}%` : '-'}</span>
                      <span>
                        <span className={`admin-pool-status-badge ${pool.status}`}>
                          {pool.status === 'active' ? t('admin_pool_active') : t('admin_pool_paused')}
                        </span>
                      </span>
                      <span className="admin-action-btns">
                        <button
                          className="admin-btn admin-btn-edit"
                          onClick={() => handleCollectFees(pool)}
                          disabled={!pool.poolAddress || collectFeeLoading === pool.id}
                        >
                          {collectFeeLoading === pool.id ? 'Collecting...' : 'Collect Fee'}
                        </button>
                      </span>
                    </div>
                  ))}
                {collectFeeError && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>
                    {collectFeeError}
                  </div>
                )}
                {collectFeeResult && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(34, 211, 135, 0.1)', border: '1px solid rgba(34, 211, 135, 0.3)', borderRadius: 8, color: '#22d387', fontSize: 13 }}>
                    Fees collected from {collectFeeResult.pool}.{' '}
                    <a href={explorerTxUrl(collectFeeResult.signature)} target="_blank" rel="noopener noreferrer" style={{ color: '#a855f7' }}>
                      View on Explorer
                    </a>
                  </div>
                )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'liquidity' && canAccessTab('liquidity', adminRole) && (
            <div className="admin-liquidity">
              <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">{t('admin_liq_total_locked')}</span>
                    <span className="admin-stat-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
                  </div>
                  <span className="admin-stat-value">{fmtCurr(totalLockedValue)}</span>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">{t('admin_liq_pools_locked')}</span>
                    <span className="admin-stat-arrow"><Waves size={14} /></span>
                  </div>
                  <span className="admin-stat-value">{poolsWithLocks}</span>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">{t('admin_liq_avg_lock')}</span>
                    <span className="admin-stat-arrow"><Clock size={14} /></span>
                  </div>
                  <span className="admin-stat-value">
                    {lockedPositions.length > 0
                      ? (lockedPositions.filter(l => l.lockPeriod > 0).length > 0
                          ? Math.round(lockedPositions.filter(l => l.lockPeriod > 0).reduce((s, l) => s + l.lockPeriod, 0) / lockedPositions.filter(l => l.lockPeriod > 0).length) + 'd'
                          : '∞')
                      : '-'}
                  </span>
                </div>
              </div>

              <div className="admin-card" style={{ marginBottom: 20 }}>
                <div className="admin-pool-header">
                  <div>
                    <h3 style={{ margin: 0 }}>Add Liquidity</h3>
                    <div className="admin-tvl-ntc">
                      <span className="admin-tvl-ntc-label">Total Value Locked</span>
                      <span className="admin-tvl-ntc-value">{totalLockedValue >= 1e9 ? (totalLockedValue / 1e9).toFixed(2) + 'B' : totalLockedValue >= 1e6 ? (totalLockedValue / 1e6).toFixed(2) + 'M' : totalLockedValue >= 1e3 ? (totalLockedValue / 1e3).toFixed(2) + 'K' : totalLockedValue.toFixed(2)} NTC</span>
                      <span className="admin-tvl-ntc-usd">≈ {fmtCurr(totalLockedValue)}</span>
                    </div>
                  </div>
                  <button className="admin-btn-primary" onClick={() => { setShowAddLiquidity(!showAddLiquidity); setLiqError(null); setLiqResult(null) }}>
                    + Add Liquidity
                  </button>
                </div>

                {showAddLiquidity && (
                  <div className="admin-pool-create-form" style={{ marginTop: 16 }}>
                    <div className="admin-pool-form-row">
                      <div className="admin-pool-form-group">
                        <label>Select Pool</label>
                        <select value={liqPoolId} onChange={e => setLiqPoolId(e.target.value)} className="admin-select">
                          <option value="">Select a pool...</option>
                          {pools.filter(p => p.poolAddress && p.status === 'active').map(pool => (
                            <option key={pool.id} value={pool.id}>{pool.tokenA.symbol}/{pool.tokenB.symbol}</option>
                          ))}
                        </select>
                      </div>
                      <div className="admin-pool-form-group">
                        <label>Amount {liqPoolId ? pools.find(p => p.id === liqPoolId)?.tokenA?.symbol || 'Token A' : 'Token A'}</label>
                        <input type="number" value={liqAmountA} onChange={e => setLiqAmountA(e.target.value)} placeholder="0.00" className="admin-input" min="0" step="any" style={liqAmountAExceedsBalance ? { borderColor: '#ef4444' } : {}} />
                        {liqBalances && (
                          <div style={{ fontSize: 11, marginTop: 4, color: liqAmountAExceedsBalance ? '#ef4444' : '#888' }}>
                            Available: {liqBalances.tokenX.available.toFixed(5)} {liqBalances.tokenX.symbol}
                            {liqBalances.tokenX.withheld > 0 && <span style={{ color: '#f59e0b' }}> ({liqBalances.tokenX.withheld.toFixed(5)} withheld as fee)</span>}
                            {liqAmountA && !liqAmountAExceedsBalance && <span style={{ cursor: 'pointer', color: '#a855f7', marginLeft: 6 }} onClick={() => setLiqAmountA(String(liqBalances.tokenX.available))}>MAX</span>}
                          </div>
                        )}
                        {liqBalancesLoading && <div style={{ fontSize: 11, marginTop: 4, color: '#888' }}>Loading balance...</div>}
                      </div>
                      <div className="admin-pool-form-group">
                        <label>Amount {liqPoolId ? pools.find(p => p.id === liqPoolId)?.tokenB?.symbol || 'Token B' : 'Token B'}</label>
                        <input type="number" value={liqAmountB} onChange={e => setLiqAmountB(e.target.value)} placeholder="0.00" className="admin-input" min="0" step="any" style={liqAmountBExceedsBalance ? { borderColor: '#ef4444' } : {}} />
                        {liqBalances && (
                          <div style={{ fontSize: 11, marginTop: 4, color: liqAmountBExceedsBalance ? '#ef4444' : '#888' }}>
                            Available: {liqBalances.tokenY.available.toFixed(5)} {liqBalances.tokenY.symbol}
                            {liqBalances.tokenY.withheld > 0 && <span style={{ color: '#f59e0b' }}> ({liqBalances.tokenY.withheld.toFixed(5)} withheld as fee)</span>}
                            {liqAmountB && !liqAmountBExceedsBalance && <span style={{ cursor: 'pointer', color: '#a855f7', marginLeft: 6 }} onClick={() => setLiqAmountB(String(liqBalances.tokenY.available))}>MAX</span>}
                          </div>
                        )}
                        {liqBalancesLoading && <div style={{ fontSize: 11, marginTop: 4, color: '#888' }}>Loading balance...</div>}
                      </div>
                      <div className="admin-pool-form-group admin-pool-form-actions">
                        <button className="admin-btn-primary" onClick={handleAddLiquidity} disabled={!liqPoolId || !liqAmountA || !liqAmountB || liqLoading || liqAmountAExceedsBalance || liqAmountBExceedsBalance}>
                          {liqLoading ? 'Adding...' : 'Add Liquidity'}
                        </button>
                        <button className="admin-btn admin-btn-cancel" onClick={() => { setShowAddLiquidity(false); setLiqError(null); setLiqResult(null) }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                    {liqError && (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>
                        {liqError}
                      </div>
                    )}
                    {liqResult && (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(34, 211, 135, 0.1)', border: '1px solid rgba(34, 211, 135, 0.3)', borderRadius: 8, color: '#22d387', fontSize: 13 }}>
                        Liquidity added to {liqResult.pool}: {liqResult.amountA} + {liqResult.amountB} tokens.{' '}
                        <a href={explorerTxUrl(liqResult.signature)} target="_blank" rel="noopener noreferrer" style={{ color: '#a855f7' }}>
                          View on Explorer
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="admin-card">
                <h3>{t('admin_liq_locked_positions')}</h3>
                {poolsLoading && lockedPositions.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Loading pool data...</div>
                )}
                <div className="admin-pool-table">
                  <div className="admin-liq-table-header">
                    <span>{t('admin_pool_pair')}</span>
                    <span>Reserve A</span>
                    <span>Reserve B</span>
                    <span>Price</span>
                    <span>TVL</span>
                    <span>{t('admin_pool_status')}</span>
                  </div>
                  {lockedPositions.map(lock => {
                    const resA = parseFloat(lock.reserveA || '0')
                    const resB = parseFloat(lock.reserveB || '0')
                    const fmtReserve = (val) => {
                      if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B`
                      if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M`
                      if (val >= 1e3) return `${(val / 1e3).toFixed(2)}K`
                      return val.toFixed(2)
                    }
                    const pairParts = lock.pair.split('/')
                    return (
                      <div key={lock.id} className="admin-liq-table-row">
                        <span className="admin-pool-pair-cell">
                          <span className="admin-pool-pair-dots">
                            {pairParts[0] && getApiImage(pairParts[0].toLowerCase()) ? (
                              <img src={getApiImage(pairParts[0].toLowerCase())} alt={pairParts[0]} style={{ width: 18, height: 18, borderRadius: '50%' }} />
                            ) : (
                              <span className="admin-token-dot" style={{ background: '#a855f7' }}></span>
                            )}
                            {pairParts[1] && getApiImage(pairParts[1].toLowerCase()) ? (
                              <img src={getApiImage(pairParts[1].toLowerCase())} alt={pairParts[1]} style={{ width: 18, height: 18, borderRadius: '50%', marginLeft: -6 }} />
                            ) : (
                              <span className="admin-token-dot admin-token-dot-overlap" style={{ background: '#22d387' }}></span>
                            )}
                          </span>
                          {lock.pair}
                        </span>
                        <span>{fmtReserve(resA)} {pairParts[0]}</span>
                        <span>{fmtReserve(resB)} {pairParts[1]}</span>
                        <span>{lock.price ? lock.price.toFixed(4) : '-'}</span>
                        <span>{fmtCurr(lock.amount)}</span>
                        <span>
                          <span className={`admin-pool-status-badge active`}>
                            {t('admin_liq_status_locked')}
                          </span>
                        </span>
                        <span>
                          <button
                            className="admin-btn"
                            style={{ fontSize: 11, padding: '4px 8px', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', display: 'none' }}
                            onClick={() => handleRemoveLiquidity(lock)}
                            disabled={removeLiqLoading === lock.id}
                          >
                            {removeLiqLoading === lock.id ? 'Removing...' : 'Remove Liquidity'}
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </div>
                {removeLiqError && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>
                    {removeLiqError}
                  </div>
                )}
                {removeLiqResult && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(34, 211, 135, 0.1)', border: '1px solid rgba(34, 211, 135, 0.3)', borderRadius: 8, color: '#22d387', fontSize: 13 }}>
                    Liquidity removed from {removeLiqResult.pool} — tokens sent to Treasury Vault.{' '}
                    <a href={explorerTxUrl(removeLiqResult.signature)} target="_blank" rel="noopener noreferrer" style={{ color: '#a855f7' }}>
                      View on Explorer
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'contact' && (() => {
            const updateMsgStatus = (id, status) => {
              const prev = supportMessages
              setSupportMessages(msgs => msgs.map(m => m.id === id ? { ...m, status } : m))
              fetch(`/api/admin/support-messages/${id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-wallet-address': publicKey?.toBase58() || '' },
                body: JSON.stringify({ status }),
              }).then(r => r.json()).then(d => { if (!d.ok) setSupportMessages(prev) }).catch(() => setSupportMessages(prev))
            }
            const deleteMsg = (id) => {
              const prev = supportMessages
              setSupportMessages(msgs => msgs.filter(m => m.id !== id))
              if (selectedMessage?.id === id) setSelectedMessage(null)
              fetch(`/api/admin/support-messages/${id}`, {
                method: 'DELETE',
                headers: { 'x-wallet-address': publicKey?.toBase58() || '' },
              }).then(r => r.json()).then(d => { if (!d.ok) setSupportMessages(prev) }).catch(() => setSupportMessages(prev))
            }
            const filtered = contactFilter === 'all' ? supportMessages : supportMessages.filter(m => m.status === contactFilter)
            const newCount = supportMessages.filter(m => m.status === 'new').length
            const reviewedCount = supportMessages.filter(m => m.status === 'reviewed').length
            const resolvedCount = supportMessages.filter(m => m.status === 'resolved').length
            return (
              <div className="admin-contact">
                <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
                  <div className="admin-stat-card">
                    <div className="admin-stat-top">
                      <span className="admin-stat-label">Total Messages</span>
                      <span className="admin-stat-arrow"><Mail size={14} /></span>
                    </div>
                    <span className="admin-stat-value">{supportMessages.length}</span>
                  </div>
                  <div className="admin-stat-card">
                    <div className="admin-stat-top">
                      <span className="admin-stat-label">New</span>
                      <span className="admin-stat-arrow"><CircleDot size={14} /></span>
                    </div>
                    <span className="admin-stat-value">{newCount}</span>
                  </div>
                  <div className="admin-stat-card">
                    <div className="admin-stat-top">
                      <span className="admin-stat-label">Reviewed</span>
                      <span className="admin-stat-arrow"><Circle size={14} /></span>
                    </div>
                    <span className="admin-stat-value">{reviewedCount}</span>
                  </div>
                  <div className="admin-stat-card">
                    <div className="admin-stat-top">
                      <span className="admin-stat-label">Resolved</span>
                      <span className="admin-stat-arrow"><CheckCircle size={14} /></span>
                    </div>
                    <span className="admin-stat-value">{resolvedCount}</span>
                  </div>
                </div>

                <div className="admin-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <h3 style={{ margin: 0 }}>Customer Messages</h3>
                    <div className="admin-fees-period-tabs">
                      {[
                        { key: 'all', label: 'All' },
                        { key: 'new', label: `New (${newCount})` },
                        { key: 'reviewed', label: 'Reviewed' },
                        { key: 'resolved', label: 'Resolved' },
                      ].map(f => (
                        <button key={f.key} className={`admin-fees-period-btn ${contactFilter === f.key ? 'active' : ''}`} onClick={() => setContactFilter(f.key)}>{f.label}</button>
                      ))}
                    </div>
                  </div>

                  {filtered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}><MailOpen size={32} /></div>
                      <p>{contactFilter === 'all' ? 'No messages yet. Customer messages from the Support page will appear here.' : `No ${contactFilter} messages.`}</p>
                    </div>
                  ) : (
                    <div className="admin-contact-list">
                      {filtered.map(msg => (
                        <div key={msg.id} className={`admin-contact-row ${msg.status} ${selectedMessage?.id === msg.id ? 'selected' : ''}`} onClick={() => { setSelectedMessage(msg); if (msg.status === 'new') updateMsgStatus(msg.id, 'reviewed') }}>
                          <div className="admin-contact-row-left">
                            <div className="admin-contact-avatar">{(msg.name || '?')[0].toUpperCase()}</div>
                            <div className="admin-contact-info">
                              <div className="admin-contact-name">
                                {msg.name}
                                <span className={`admin-contact-status-dot ${msg.status}`}></span>
                              </div>
                              <div className="admin-contact-subject">{msg.subject || 'No Subject'}</div>
                              <div className="admin-contact-preview">{msg.message?.slice(0, 80)}{msg.message?.length > 80 ? '...' : ''}</div>
                            </div>
                          </div>
                          <div className="admin-contact-row-right">
                            <span className="admin-contact-date">{new Date(msg.created_at || msg.date).toLocaleDateString()}</span>
                            <span className={`admin-contact-badge ${msg.status}`}>{msg.status === 'new' ? 'New' : msg.status === 'reviewed' ? 'Reviewed' : 'Resolved'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedMessage && (
                  <div className="admin-card" style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div>
                        <h3 style={{ margin: 0 }}>{selectedMessage.subject || 'No Subject'}</h3>
                        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 13, color: 'var(--text-muted)' }}>
                          <span>From: <strong style={{ color: 'var(--text-secondary)' }}>{selectedMessage.name}</strong></span>
                          <span>Email: <strong style={{ color: 'var(--text-secondary)' }}>{selectedMessage.email}</strong></span>
                          <span>{new Date(selectedMessage.created_at || selectedMessage.date).toLocaleString()}</span>
                        </div>
                      </div>
                      <button className="modal-close" onClick={() => setSelectedMessage(null)}>✕</button>
                    </div>
                    <div className="admin-contact-message-body">{selectedMessage.message}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                      {selectedMessage.status !== 'reviewed' && (
                        <button className="admin-btn admin-btn-edit" onClick={() => updateMsgStatus(selectedMessage.id, 'reviewed')}>Mark Reviewed</button>
                      )}
                      {selectedMessage.status !== 'resolved' && (
                        <button className="admin-btn admin-btn-save" onClick={() => { updateMsgStatus(selectedMessage.id, 'resolved'); setSelectedMessage({ ...selectedMessage, status: 'resolved' }) }}>Mark Resolved</button>
                      )}
                      <button className="admin-btn admin-btn-cancel" onClick={() => deleteMsg(selectedMessage.id)}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {activeTab === 'treasury' && canAccessTab('treasury', adminRole) && (
            <div className="admin-settings">
              {treasuryLoading ? (
                <div className="admin-card" style={{ textAlign: 'center', padding: 40 }}>Loading treasury data...</div>
              ) : (
                <>
                  {treasuryActionError && (
                    <div className="admin-card" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#ef4444', marginBottom: 16 }}>
                      {treasuryActionError}
                      <button style={{ marginLeft: 12, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }} onClick={() => setTreasuryActionError(null)}>Dismiss</button>
                    </div>
                  )}
                  {treasuryActionResult && (
                    <div className="admin-card" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#22c55e', marginBottom: 16 }}>
                      {treasuryActionResult.type === 'approve' && `Transaction #${treasuryActionResult.transactionIndex} approved via Squads.`}
                      {treasuryActionResult.type === 'execute' && `Transaction #${treasuryActionResult.transactionIndex} executed via Squads.`}
                      {treasuryActionResult.type === 'collect' && `Pool fees collected: ${treasuryActionResult.harvested} tokens harvested.`}
                      {treasuryActionResult.type === 'withdraw' && `Transfer fees withdrawn: ${treasuryActionResult.succeeded} of ${treasuryActionResult.total} succeeded.`}
                      {treasuryActionResult.type === 'create-vault' && `Vault created at index ${treasuryActionResult.index}. PDA: ${treasuryActionResult.vaultPda}`}
                      {treasuryActionResult.type === 'propose' && `Vault transaction proposed! Transaction index: #${treasuryActionResult.transactionIndex}`}
                      {treasuryActionResult.signature && (
                        <a href={explorerTxUrl(treasuryActionResult.signature)} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: '#22c55e', textDecoration: 'underline' }}>View Tx</a>
                      )}
                      <button style={{ marginLeft: 12, background: 'none', border: 'none', color: '#22c55e', cursor: 'pointer' }} onClick={() => setTreasuryActionResult(null)}>Dismiss</button>
                    </div>
                  )}

                  <div className="admin-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <h3 style={{ margin: 0 }}>Squads Multisig Vault</h3>
                      <button className="admin-btn admin-btn-edit" onClick={invalidateTreasuryData} style={{ fontSize: 12 }}>Refresh</button>
                    </div>
                    {!treasuryMultisig?.initialized ? (
                      <div>
                        <div style={{ opacity: 0.6, marginBottom: 16 }}>No Squads multisig configured. Set up owner wallets and create one from the Setup tab.</div>
                        <button
                          className="admin-btn admin-btn-save"
                          onClick={() => setActiveTab('setup')}
                        >
                          Go to Setup Tab
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
                          <div className="admin-stat-card">
                            <div style={{ fontSize: 12, opacity: 0.7 }}>Vault Address</div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>
                              {treasuryMultisig.vaultPda ? (
                                <span style={{ cursor: 'pointer' }} onClick={() => navigator.clipboard.writeText(treasuryMultisig.vaultPda)} title={treasuryMultisig.vaultPda}>
                                  {treasuryMultisig.vaultPda.slice(0, 6) + '...' + treasuryMultisig.vaultPda.slice(-4)}
                                </span>
                              ) : 'N/A'}
                            </div>
                          </div>
                          <div className="admin-stat-card">
                            <div style={{ fontSize: 12, opacity: 0.7 }}>Threshold</div>
                            <div style={{ fontSize: 16, fontWeight: 600 }}>{treasuryMultisig.threshold}-of-{treasuryMultisig.members?.length || 0}</div>
                          </div>
                          <div className="admin-stat-card">
                            <div style={{ fontSize: 12, opacity: 0.7 }}>Transaction Index</div>
                            <div style={{ fontSize: 16, fontWeight: 600 }}>{treasuryMultisig.transactionIndex ?? 0}</div>
                          </div>
                          <div className="admin-stat-card">
                            <div style={{ fontSize: 12, opacity: 0.7 }}>Tokens with Balance</div>
                            <div style={{ fontSize: 16, fontWeight: 600 }}>{treasuryBalances.filter(b => parseFloat(b.balance) > 0).length}</div>
                          </div>
                        </div>
                        {treasuryMultisig.timeLock > 0 && (
                          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>Time Lock: {treasuryMultisig.timeLock}s</div>
                        )}
                        {treasuryMultisig.members && treasuryMultisig.members.length > 0 && (
                          <div>
                            <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8 }}>Members</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {treasuryMultisig.members.map((member, i) => {
                                const addr = typeof member === 'string' ? member : member.key || member.pubkey || ''
                                return (
                                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: 6, fontSize: 13 }}>
                                    <span>{addr.slice(0, 4) + '...' + addr.slice(-4)}</span>
                                    <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.6, fontSize: 12 }} onClick={() => navigator.clipboard.writeText(addr)}>Copy</button>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="admin-card" style={{ marginTop: 16 }}>
                    <h3>Vault Token Balances</h3>
                    <table className="admin-pool-table">
                      <thead>
                        <tr><th>Token</th><th>Balance</th><th>ATA Address</th></tr>
                      </thead>
                      <tbody>
                        {treasuryBalances.length === 0 ? (
                          <tr><td colSpan={3} style={{ textAlign: 'center', opacity: 0.5 }}>No balances found</td></tr>
                        ) : treasuryBalances.filter(b => b.mint !== 'SOL').map((b, i) => (
                          <tr key={i}>
                            <td>{b.symbol || b.mint?.slice(0, 4) + '...' + b.mint?.slice(-4)}</td>
                            <td>{parseFloat(b.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                            <td style={{ fontSize: 12 }}>{b.ata ? b.ata.slice(0, 6) + '...' + b.ata.slice(-4) : 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {treasuryBalances.find(b => b.mint === 'SOL') && (
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.7 }}>
                        SOL Balance: {parseFloat(treasuryBalances.find(b => b.mint === 'SOL')?.balance || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL
                      </div>
                    )}
                  </div>

                  {treasuryMultisig?.initialized && adminRole === 'owner' && (
                    <div className="admin-card" style={{ marginTop: 16 }}>
                      <h3>Transfer Tokens from Vault</h3>
                      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
                        Create a multisig proposal to transfer tokens from the Squads vault to a destination wallet (e.g. your admin wallet for adding liquidity).
                      </div>
                      {treasuryActionResult?.type === 'vault-transfer' && (
                        <div style={{ padding: '14px 16px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, marginBottom: 14 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#22c55e', marginBottom: 8 }}>Transfer Proposal Created</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13 }}>
                            <div><span style={{ opacity: 0.6 }}>Transaction Index:</span> <strong style={{ color: '#22c55e' }}>#{treasuryActionResult.transactionIndex}</strong></div>
                            <div><span style={{ opacity: 0.6 }}>Token:</span> <strong>{treasuryActionResult.token}</strong></div>
                            <div><span style={{ opacity: 0.6 }}>Amount:</span> <strong>{Number(treasuryActionResult.amount).toLocaleString()}</strong></div>
                            <div style={{ gridColumn: '1 / -1' }}><span style={{ opacity: 0.6 }}>Destination:</span> <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{treasuryActionResult.destination}</span></div>
                          </div>
                          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                            Requires <strong>{treasuryMultisig?.threshold || 2}</strong> of <strong>{treasuryMultisig?.members?.length || 3}</strong> owner approvals. Use Transaction Index <strong>#{treasuryActionResult.transactionIndex}</strong> below to Approve and then Execute.
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div>
                          <label style={{ fontSize: 12, opacity: 0.7, display: 'block', marginBottom: 4 }}>Token</label>
                          <select value={vaultTransferToken} onChange={e => setVaultTransferToken(e.target.value)} className="admin-select" style={{ minWidth: 140 }}>
                            <option value="">Select token</option>
                            {treasuryBalances.filter(b => b.mint !== 'SOL' && b.symbol).map(b => (
                              <option key={b.symbol} value={b.symbol}>{b.symbol} ({Number(b.balance).toLocaleString()})</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 12, opacity: 0.7, display: 'block', marginBottom: 4 }}>Amount</label>
                          <input type="number" value={vaultTransferAmount} onChange={e => setVaultTransferAmount(e.target.value)} placeholder="e.g. 1000000" className="admin-setting-input" style={{ width: 160 }} />
                          {vaultTransferToken && (() => {
                            const bal = treasuryBalances.find(b => b.symbol === vaultTransferToken)
                            return bal ? <div style={{ fontSize: 11, opacity: 0.5, marginTop: 3 }}>Available: {Number(bal.balance).toLocaleString()}</div> : null
                          })()}
                        </div>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <label style={{ fontSize: 12, opacity: 0.7, display: 'block', marginBottom: 4 }}>Destination Wallet</label>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input type="text" value={vaultTransferDest} onChange={e => setVaultTransferDest(e.target.value)} placeholder="Wallet address" className="admin-setting-input" style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
                            {publicKey && !vaultTransferDest && (
                              <button style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 6, color: '#a855f7', cursor: 'pointer', whiteSpace: 'nowrap' }}
                                onClick={() => setVaultTransferDest(publicKey.toBase58())}>My Wallet</button>
                            )}
                          </div>
                        </div>
                        <button className="admin-btn admin-btn-save"
                          disabled={!vaultTransferToken || !vaultTransferAmount || !vaultTransferDest || treasuryActionLoading === 'vault-transfer' || !publicKey}
                          onClick={handleVaultTransfer}
                          style={{ padding: '8px 20px' }}>
                          {treasuryActionLoading === 'vault-transfer' ? 'Creating Proposal...' : 'Propose Transfer'}
                        </button>
                      </div>
                      {vaultTransferToken && vaultTransferAmount && vaultTransferDest && (
                        <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 8, fontSize: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#a855f7' }}>Transfer Summary</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                            <div><span style={{ opacity: 0.6 }}>Token:</span> <strong>{vaultTransferToken}</strong></div>
                            <div><span style={{ opacity: 0.6 }}>Amount:</span> <strong>{Number(vaultTransferAmount).toLocaleString()}</strong></div>
                            <div style={{ gridColumn: '1 / -1' }}><span style={{ opacity: 0.6 }}>To:</span> <span style={{ fontFamily: 'monospace' }}>{vaultTransferDest}</span></div>
                            <div style={{ gridColumn: '1 / -1' }}><span style={{ opacity: 0.6 }}>Approvals Required:</span> <strong>{treasuryMultisig?.threshold || 2}</strong> of <strong>{treasuryMultisig?.members?.length || 3}</strong> owners must approve</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {treasuryMultisig?.initialized && (
                    <div className="admin-card" style={{ marginTop: 16 }}>
                      <h3>Transfer Proposals</h3>
                      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
                        All vault transfer proposals. Approve with {treasuryMultisig?.threshold || 2} of {treasuryMultisig?.members?.length || 3} owners, then execute.
                      </div>
                      {treasuryProposals.length === 0 ? (
                        <div style={{ padding: '20px 0', textAlign: 'center', opacity: 0.5, fontSize: 13 }}>No transfer proposals yet. Create one above.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {treasuryProposals.map(p => {
                            const isActive = p.status === 'active'
                            const isApproved = p.status === 'approved'
                            const isExecuted = p.status === 'executed'
                            const approvalsNeeded = (p.threshold || 2) - (p.approvals || 0)
                            let approvedBy = p.approved_by
                            if (typeof approvedBy === 'string') { try { approvedBy = JSON.parse(approvedBy) } catch { approvedBy = [] } }
                            if (!Array.isArray(approvedBy)) approvedBy = []
                            const currentWallet = publicKey?.toBase58() || ''
                            const alreadyApproved = approvedBy.includes(currentWallet)
                            const maxApprovalsReached = approvedBy.length >= 3
                            const canApprove = !isExecuted && !isApproved && !alreadyApproved && !maxApprovalsReached && publicKey && adminRole === 'owner'
                            const canExecute = isApproved && !isExecuted && publicKey && adminRole === 'owner'
                            return (
                              <div key={p.id} style={{
                                padding: '12px 16px',
                                background: isExecuted ? 'rgba(34,197,94,0.05)' : isApproved ? 'rgba(234,179,8,0.05)' : 'rgba(168,85,247,0.05)',
                                border: `1px solid ${isExecuted ? 'rgba(34,197,94,0.2)' : isApproved ? 'rgba(234,179,8,0.2)' : 'rgba(168,85,247,0.2)'}`,
                                borderRadius: 10,
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span style={{ fontSize: 14, fontWeight: 700 }}>#{p.transaction_index}</span>
                                    <span style={{
                                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                                      background: isExecuted ? 'rgba(34,197,94,0.15)' : isApproved ? 'rgba(234,179,8,0.15)' : 'rgba(168,85,247,0.15)',
                                      color: isExecuted ? '#22c55e' : isApproved ? '#eab308' : '#a855f7',
                                    }}>
                                      {isExecuted ? 'EXECUTED' : isApproved ? 'READY TO EXECUTE' : 'PENDING APPROVAL'}
                                    </span>
                                    {alreadyApproved && !isExecuted && (
                                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>YOUR VOTE: APPROVED</span>
                                    )}
                                  </div>
                                  <span style={{ fontSize: 11, opacity: 0.5 }}>{new Date(p.created_at).toLocaleString()}</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                                  <div><span style={{ opacity: 0.5 }}>Token:</span> <strong>{p.token_symbol || 'N/A'}</strong></div>
                                  <div><span style={{ opacity: 0.5 }}>Amount:</span> <strong>{Number(p.amount).toLocaleString()}</strong></div>
                                  <div><span style={{ opacity: 0.5 }}>Approvals:</span> <strong style={{ color: approvalsNeeded <= 0 ? '#22c55e' : '#eab308' }}>{p.approvals || 0}/{p.threshold || 2}</strong> <span style={{ opacity: 0.4, fontSize: 10 }}>(max 3)</span></div>
                                  <div><span style={{ opacity: 0.5 }}>Remaining:</span> <strong>{approvalsNeeded > 0 ? approvalsNeeded : 0}</strong></div>
                                  <div style={{ gridColumn: '1 / -1' }}><span style={{ opacity: 0.5 }}>Destination:</span> <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{p.destination}</span></div>
                                  {approvedBy.length > 0 && (
                                    <div style={{ gridColumn: '1 / -1' }}><span style={{ opacity: 0.5 }}>Approved by:</span> {approvedBy.map((w, i) => <span key={i} style={{ fontFamily: 'monospace', fontSize: 10, marginLeft: 4 }}>{w.slice(0, 4)}...{w.slice(-4)}{i < approvedBy.length - 1 ? ',' : ''}</span>)}</div>
                                  )}
                                  {p.execute_signature && (
                                    <div style={{ gridColumn: '1 / -1' }}>
                                      <span style={{ opacity: 0.5 }}>Execute Tx:</span>{' '}
                                      <a href={explorerTxUrl(p.execute_signature)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: 11, color: '#22c55e', textDecoration: 'underline' }}>{p.execute_signature.slice(0, 20)}...{p.execute_signature.slice(-8)}</a>
                                    </div>
                                  )}
                                </div>
                                {!isExecuted && (
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    {canApprove && (
                                      <button
                                        className="admin-btn admin-btn-edit"
                                        disabled={treasuryActionLoading === 'approve-' + p.transaction_index || treasuryActionLoading === 'confirming-approve-' + p.transaction_index}
                                        onClick={() => handleSquadsApprove(p.transaction_index)}
                                        style={{ padding: '5px 16px', fontSize: 12 }}
                                      >
                                        {treasuryActionLoading === 'confirming-approve-' + p.transaction_index ? 'Confirming transaction...' : treasuryActionLoading === 'approve-' + p.transaction_index ? 'Approving...' : `Approve (${p.approvals || 0}/${p.threshold || 2})`}
                                      </button>
                                    )}
                                    {canExecute && (
                                      <button
                                        className="admin-btn admin-btn-save"
                                        disabled={treasuryActionLoading === 'execute-' + p.transaction_index || treasuryActionLoading === 'confirming-execute-' + p.transaction_index}
                                        onClick={() => handleSquadsExecute(p.transaction_index)}
                                        style={{ padding: '5px 16px', fontSize: 12 }}
                                      >
                                        {treasuryActionLoading === 'confirming-execute-' + p.transaction_index ? 'Confirming transaction...' : treasuryActionLoading === 'execute-' + p.transaction_index ? 'Executing...' : 'Execute'}
                                      </button>
                                    )}
                                    {alreadyApproved && !isApproved && !maxApprovalsReached && (
                                      <span style={{ fontSize: 11, color: '#a855f7', background: 'rgba(168,85,247,0.08)', padding: '4px 10px', borderRadius: 6 }}>You already approved -- waiting for {approvalsNeeded} more owner{approvalsNeeded > 1 ? 's' : ''}</span>
                                    )}
                                    {maxApprovalsReached && !isApproved && (
                                      <span style={{ fontSize: 11, opacity: 0.5 }}>Max 3 approvals reached</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="admin-card" style={{ marginTop: 16 }}>
                    <h3>Fee History</h3>
                    <table className="admin-pool-table">
                      <thead>
                        <tr><th>Token</th><th>Amount</th><th>Type</th><th>Tx Signature</th><th>Date & Time</th></tr>
                      </thead>
                      <tbody>
                        {treasuryFeeHistory.length === 0 ? (
                          <tr><td colSpan={5} style={{ textAlign: 'center', opacity: 0.5 }}>No fee history</td></tr>
                        ) : (feeHistoryShowAll ? treasuryFeeHistory : treasuryFeeHistory.slice(0, 10)).map((ev, i) => (
                          <tr key={i}>
                            <td>{ev.token_symbol || 'N/A'}</td>
                            <td>{parseFloat(ev.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                            <td>{ev.fee_type}</td>
                            <td>
                              {ev.tx_signature ? (
                                <a href={explorerTxUrl(ev.tx_signature)} target="_blank" rel="noopener noreferrer" style={{ color: '#a855f7', textDecoration: 'underline', fontSize: 12 }}>
                                  {ev.tx_signature.slice(0, 4) + '...' + ev.tx_signature.slice(-4)}
                                </a>
                              ) : 'N/A'}
                            </td>
                            <td>{ev.created_at ? new Date(ev.created_at).toLocaleString() : 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {treasuryFeeHistory.length > 10 && (
                      <div style={{ textAlign: 'center', marginTop: 10 }}>
                        <button className="admin-btn" onClick={() => setFeeHistoryShowAll(!feeHistoryShowAll)} style={{ fontSize: 13 }}>
                          {feeHistoryShowAll ? 'Show Less' : `See More (${treasuryFeeHistory.length - 10} more)`}
                        </button>
                      </div>
                    )}
                  </div>


                  <div className="admin-card" style={{ marginTop: 16 }}>
                    <h3>Saved Multisig Owners</h3>
                    {treasuryOwners ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {treasuryOwners.owner1 && <div><strong>Owner 1:</strong> {treasuryOwners.owner1}</div>}
                        {treasuryOwners.owner2 && <div><strong>Owner 2:</strong> {treasuryOwners.owner2}</div>}
                        {treasuryOwners.owner3 && <div><strong>Owner 3:</strong> {treasuryOwners.owner3}</div>}
                        {!treasuryOwners.owner1 && !treasuryOwners.owner2 && !treasuryOwners.owner3 && (
                          <div style={{ opacity: 0.5 }}>No owners saved yet. Configure in Setup tab.</div>
                        )}
                      </div>
                    ) : (
                      <div style={{ opacity: 0.5, fontSize: 13 }}>No owners saved yet. Configure in the <strong style={{ color: '#a855f7', cursor: 'pointer' }} onClick={() => setActiveTab('setup')}>Setup tab</strong>.</div>
                    )}
                  </div>

                  <div className="admin-card" style={{ marginTop: 16 }}>
                    <h3>Treasury Wallets (ATAs)</h3>
                    {treasuryWallets.length > 0 ? (
                      <table className="admin-pool-table">
                        <thead>
                          <tr><th>Token</th><th>Mint Address</th><th>Treasury ATA</th></tr>
                        </thead>
                        <tbody>
                          {treasuryWallets.map((w, i) => (
                            <tr key={i}>
                              <td style={{ fontWeight: 600 }}>{w.token_symbol || 'N/A'}</td>
                              <td style={{ fontSize: 11, fontFamily: 'monospace' }}>
                                <span style={{ cursor: 'pointer' }} onClick={() => navigator.clipboard.writeText(w.mint_address)} title={w.mint_address}>
                                  {w.mint_address?.slice(0, 6)}...{w.mint_address?.slice(-4)}
                                </span>
                              </td>
                              <td style={{ fontSize: 11, fontFamily: 'monospace' }}>
                                <span style={{ cursor: 'pointer' }} onClick={() => navigator.clipboard.writeText(w.treasury_ata)} title={w.treasury_ata}>
                                  {w.treasury_ata?.slice(0, 6)}...{w.treasury_ata?.slice(-4)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ opacity: 0.5, fontSize: 13 }}>No treasury wallets created yet. Create ATAs from the <strong style={{ color: '#a855f7', cursor: 'pointer' }} onClick={() => setActiveTab('setup')}>Setup tab</strong>.</div>
                    )}
                  </div>

                </>
              )}
            </div>
          )}

          {activeTab === 'swap-limits' && canAccessTab('swap-limits', adminRole) && (
            <div className="admin-settings">
              {adminSwapLimitsLoading ? (
                <div className="admin-card" style={{ textAlign: 'center', padding: 40 }}>Loading swap limits data...</div>
              ) : (
                <>
                  <div className="admin-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <h3 style={{ margin: 0 }}>Swap Limits</h3>
                      <button className="admin-btn admin-btn-edit" onClick={invalidateAdminSwapLimits} style={{ fontSize: 12 }}>
                        {swapLimitLoading ? 'Loading...' : 'Refresh'}
                      </button>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
                      Per-wallet daily and monthly swap limits. Changes require multisig approval via Squads.
                    </div>

                    {swapLimitActionError && (
                      <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#ef4444', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                        {swapLimitActionError}
                        <button style={{ marginLeft: 12, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }} onClick={() => setSwapLimitActionError(null)}>Dismiss</button>
                      </div>
                    )}
                    {swapLimitActionResult && (
                      <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#22c55e', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                        {swapLimitActionResult.type === 'propose' && `Swap limit change proposed! Transaction #${swapLimitActionResult.transactionIndex} — Daily: ${swapLimitActionResult.daily}, Monthly: ${swapLimitActionResult.monthly}`}
                        {swapLimitActionResult.type === 'approve' && `Swap limit proposal #${swapLimitActionResult.transactionIndex} approved.`}
                        {swapLimitActionResult.type === 'execute' && `Swap limit proposal #${swapLimitActionResult.transactionIndex} executed. New limits are now active.`}
                        {swapLimitActionResult.signature && (
                          <a href={explorerTxUrl(swapLimitActionResult.signature)} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: '#22c55e', textDecoration: 'underline' }}>View Tx</a>
                        )}
                        <button style={{ marginLeft: 12, background: 'none', border: 'none', color: '#22c55e', cursor: 'pointer' }} onClick={() => setSwapLimitActionResult(null)}>Dismiss</button>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 16 }}>
                      <div className="admin-stat-card">
                        <div style={{ fontSize: 12, opacity: 0.7 }}>Daily Limit</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{swapLimitsData.daily.toLocaleString()} <span style={{ fontSize: 12, opacity: 0.5 }}>tokens/wallet</span></div>
                      </div>
                      <div className="admin-stat-card">
                        <div style={{ fontSize: 12, opacity: 0.7 }}>Monthly Limit</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{swapLimitsData.monthly.toLocaleString()} <span style={{ fontSize: 12, opacity: 0.5 }}>tokens/wallet</span></div>
                      </div>
                    </div>

                    {treasuryMultisig?.initialized && (
                      <>
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Propose New Limits</div>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div>
                              <label style={{ fontSize: 12, opacity: 0.7, display: 'block', marginBottom: 4 }}>Daily Limit</label>
                              <input type="number" value={proposedDailyLimit} onChange={e => setProposedDailyLimit(e.target.value)} placeholder={String(swapLimitsData.daily)} className="admin-setting-input" style={{ width: 140 }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 12, opacity: 0.7, display: 'block', marginBottom: 4 }}>Monthly Limit</label>
                              <input type="number" value={proposedMonthlyLimit} onChange={e => setProposedMonthlyLimit(e.target.value)} placeholder={String(swapLimitsData.monthly)} className="admin-setting-input" style={{ width: 140 }} />
                            </div>
                            <button className="admin-btn admin-btn-save"
                              disabled={!proposedDailyLimit || !proposedMonthlyLimit || swapLimitActionLoading === 'propose' || !publicKey}
                              onClick={handleProposeSwapLimitChange}
                              style={{ padding: '8px 20px' }}>
                              {swapLimitActionLoading === 'propose' ? 'Creating Proposal...' : 'Propose Change'}
                            </button>
                          </div>
                          {proposedDailyLimit && proposedMonthlyLimit && (
                            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 8, fontSize: 12 }}>
                              <span style={{ opacity: 0.6 }}>Change:</span> Daily {swapLimitsData.daily} → <strong>{proposedDailyLimit}</strong>, Monthly {swapLimitsData.monthly} → <strong>{proposedMonthlyLimit}</strong>
                              <span style={{ marginLeft: 12, opacity: 0.5 }}>Requires {treasuryMultisig?.threshold || 2} of {treasuryMultisig?.members?.length || 3} approvals</span>
                            </div>
                          )}
                        </div>

                        {swapLimitProposals.length > 0 && (
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Limit Change Proposals</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {swapLimitProposals.map(p => {
                                const isActive = p.status === 'active'
                                const isApproved = p.status === 'approved'
                                const isExecuted = p.status === 'executed'
                                const approvalsNeeded = (p.threshold || 2) - (p.approvals || 0)
                                let approvedBy = p.approved_by
                                if (typeof approvedBy === 'string') { try { approvedBy = JSON.parse(approvedBy) } catch { approvedBy = [] } }
                                if (!Array.isArray(approvedBy)) approvedBy = []
                                const currentWallet = publicKey?.toBase58() || ''
                                const alreadyApproved = approvedBy.includes(currentWallet)
                                const memberCount = treasuryMultisig?.members?.length || 3
                                const canApprove = !isExecuted && !isApproved && !alreadyApproved && approvedBy.length < memberCount && publicKey
                                const canExecute = isApproved && !isExecuted && publicKey
                                return (
                                  <div key={p.id} style={{
                                    padding: '12px 16px',
                                    background: isExecuted ? 'rgba(34,197,94,0.05)' : isApproved ? 'rgba(234,179,8,0.05)' : 'rgba(168,85,247,0.05)',
                                    border: `1px solid ${isExecuted ? 'rgba(34,197,94,0.2)' : isApproved ? 'rgba(234,179,8,0.2)' : 'rgba(168,85,247,0.2)'}`,
                                    borderRadius: 10,
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{ fontSize: 14, fontWeight: 700 }}>#{p.transaction_index}</span>
                                        <span style={{
                                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                                          background: isExecuted ? 'rgba(34,197,94,0.15)' : isApproved ? 'rgba(234,179,8,0.15)' : 'rgba(168,85,247,0.15)',
                                          color: isExecuted ? '#22c55e' : isApproved ? '#eab308' : '#a855f7',
                                        }}>
                                          {isExecuted ? 'EXECUTED' : isApproved ? 'READY TO EXECUTE' : 'PENDING APPROVAL'}
                                        </span>
                                        {alreadyApproved && !isExecuted && (
                                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>YOUR VOTE: APPROVED</span>
                                        )}
                                      </div>
                                      <span style={{ fontSize: 11, opacity: 0.5 }}>{new Date(p.created_at).toLocaleString()}</span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                                      <div><span style={{ opacity: 0.5 }}>Daily:</span> <strong>{p.current_daily}</strong> → <strong style={{ color: '#a855f7' }}>{p.proposed_daily}</strong></div>
                                      <div><span style={{ opacity: 0.5 }}>Monthly:</span> <strong>{p.current_monthly}</strong> → <strong style={{ color: '#a855f7' }}>{p.proposed_monthly}</strong></div>
                                      <div><span style={{ opacity: 0.5 }}>Approvals:</span> <strong style={{ color: approvalsNeeded <= 0 ? '#22c55e' : '#eab308' }}>{p.approvals || 0}/{p.threshold || 2}</strong></div>
                                      <div><span style={{ opacity: 0.5 }}>Creator:</span> <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{p.creator?.slice(0, 4)}...{p.creator?.slice(-4)}</span></div>
                                      {p.propose_signature && (
                                        <div style={{ gridColumn: '1 / -1' }}>
                                          <span style={{ opacity: 0.5 }}>Propose Tx:</span>{' '}
                                          <a href={explorerTxUrl(p.propose_signature)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: 11, color: '#a855f7', textDecoration: 'underline' }}>{p.propose_signature.slice(0, 20)}...{p.propose_signature.slice(-8)}</a>
                                        </div>
                                      )}
                                      {(() => {
                                        let approveSigs = p.approve_signatures
                                        if (typeof approveSigs === 'string') { try { approveSigs = JSON.parse(approveSigs) } catch { approveSigs = [] } }
                                        if (!Array.isArray(approveSigs)) approveSigs = []
                                        return approveSigs.length > 0 && (
                                          <div style={{ gridColumn: '1 / -1' }}>
                                            <span style={{ opacity: 0.5 }}>Approve Tx{approveSigs.length > 1 ? 's' : ''}:</span>{' '}
                                            {approveSigs.map((s, i) => (
                                              <span key={i} style={{ marginRight: 10 }}>
                                                <span style={{ fontFamily: 'monospace', fontSize: 10, opacity: 0.6 }}>{s.wallet?.slice(0, 4)}...{s.wallet?.slice(-4)}</span>{' '}
                                                <a href={explorerTxUrl(s.signature)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: 11, color: '#22c55e', textDecoration: 'underline' }}>{s.signature?.slice(0, 16)}...{s.signature?.slice(-8)}</a>
                                              </span>
                                            ))}
                                          </div>
                                        )
                                      })()}
                                      {approvedBy.length > 0 && (
                                        <div style={{ gridColumn: '1 / -1' }}><span style={{ opacity: 0.5 }}>Approved by:</span> {approvedBy.map((w, i) => <span key={i} style={{ fontFamily: 'monospace', fontSize: 10, marginLeft: 4 }}>{w.slice(0, 4)}...{w.slice(-4)}{i < approvedBy.length - 1 ? ',' : ''}</span>)}</div>
                                      )}
                                      {p.execute_signature && (
                                        <div style={{ gridColumn: '1 / -1' }}>
                                          <span style={{ opacity: 0.5 }}>Execute Tx:</span>{' '}
                                          <a href={explorerTxUrl(p.execute_signature)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: 11, color: '#22c55e', textDecoration: 'underline' }}>{p.execute_signature.slice(0, 20)}...{p.execute_signature.slice(-8)}</a>
                                        </div>
                                      )}
                                    </div>
                                    {!isExecuted && (
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        {canApprove && (
                                          <button
                                            className="admin-btn admin-btn-edit"
                                            disabled={swapLimitActionLoading === 'approve-' + p.transaction_index || swapLimitActionLoading === 'confirming-approve-' + p.transaction_index}
                                            onClick={() => handleSwapLimitApprove(p.transaction_index)}
                                            style={{ padding: '5px 16px', fontSize: 12 }}
                                          >
                                            {swapLimitActionLoading === 'confirming-approve-' + p.transaction_index ? 'Confirming transaction...' : swapLimitActionLoading === 'approve-' + p.transaction_index ? 'Approving...' : `Approve (${p.approvals || 0}/${p.threshold || 2})`}
                                          </button>
                                        )}
                                        {canExecute && (
                                          <button
                                            className="admin-btn admin-btn-save"
                                            disabled={swapLimitActionLoading === 'execute-' + p.transaction_index || swapLimitActionLoading === 'confirming-execute-' + p.transaction_index}
                                            onClick={() => handleSwapLimitExecute(p.transaction_index)}
                                            style={{ padding: '5px 16px', fontSize: 12 }}
                                          >
                                            {swapLimitActionLoading === 'confirming-execute-' + p.transaction_index ? 'Confirming transaction...' : swapLimitActionLoading === 'execute-' + p.transaction_index ? 'Executing...' : 'Execute'}
                                          </button>
                                        )}
                                        {alreadyApproved && !isApproved && (
                                          <span style={{ fontSize: 11, color: '#a855f7', background: 'rgba(168,85,247,0.08)', padding: '4px 10px', borderRadius: 6 }}>You already approved -- waiting for {approvalsNeeded} more owner{approvalsNeeded > 1 ? 's' : ''}</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {!treasuryMultisig?.initialized && (
                      <div style={{ opacity: 0.6, fontSize: 13 }}>
                        Multisig not configured. Set up a Squads multisig from the <strong style={{ color: '#a855f7', cursor: 'pointer' }} onClick={() => setActiveTab('setup')}>Setup tab</strong> to propose limit changes.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'referral-rewards' && (
            <div className="admin-settings">
              {adminReferralLoading ? (
                <div className="admin-card" style={{ textAlign: 'center', padding: 40 }}>Loading referral rewards data...</div>
              ) : (
                <>
                  <div className="admin-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <h3 style={{ margin: 0 }}>Referral Rewards</h3>
                      <button className="admin-btn admin-btn-edit" onClick={invalidateAdminReferralConfig} style={{ fontSize: 12 }}>
                        {referralLoading ? 'Loading...' : 'Refresh'}
                      </button>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
                      Referrer earns NTC when their code is used. Referee earns NTC on their first swap. Changes require multisig approval via Squads.
                    </div>

                    {referralActionError && (
                      <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#ef4444', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                        {referralActionError}
                        <button style={{ marginLeft: 12, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }} onClick={() => setReferralActionError(null)}>Dismiss</button>
                      </div>
                    )}
                    {referralActionResult && (
                      <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#22c55e', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                        {referralActionResult.type === 'propose' && `Referral config change proposed! Transaction #${referralActionResult.transactionIndex} — Referrer: ${referralActionResult.referrerReward} NTC, Referee: ${referralActionResult.refereeReward} NTC`}
                        {referralActionResult.type === 'approve' && `Referral config proposal #${referralActionResult.transactionIndex} approved.`}
                        {referralActionResult.type === 'execute' && `Referral config proposal #${referralActionResult.transactionIndex} executed. New rewards are now active.`}
                        {referralActionResult.signature && (
                          <a href={explorerTxUrl(referralActionResult.signature)} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: '#22c55e', textDecoration: 'underline' }}>View Tx</a>
                        )}
                        <button style={{ marginLeft: 12, background: 'none', border: 'none', color: '#22c55e', cursor: 'pointer' }} onClick={() => setReferralActionResult(null)}>Dismiss</button>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 16 }}>
                      <div className="admin-stat-card">
                        <div style={{ fontSize: 12, opacity: 0.7 }}>Referrer Reward</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{referralConfig.referrerReward} <span style={{ fontSize: 12, opacity: 0.5 }}>NTC</span></div>
                      </div>
                      <div className="admin-stat-card">
                        <div style={{ fontSize: 12, opacity: 0.7 }}>Referee Reward</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{referralConfig.refereeReward} <span style={{ fontSize: 12, opacity: 0.5 }}>NTC</span></div>
                      </div>
                    </div>

                    {referralAdminStats && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                        <div className="admin-stat-card" style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, opacity: 0.6 }}>Total Codes</div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{referralAdminStats.totalCodes}</div>
                        </div>
                        <div className="admin-stat-card" style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, opacity: 0.6 }}>Uses</div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{referralAdminStats.totalUses}</div>
                        </div>
                        <div className="admin-stat-card" style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, opacity: 0.6 }}>Swaps Done</div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{referralAdminStats.completedSwaps}</div>
                        </div>
                        <div className="admin-stat-card" style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, opacity: 0.6 }}>Rewards Paid</div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{(referralAdminStats.totalReferrerRewardsPaid + referralAdminStats.totalRefereeRewardsPaid).toFixed(2)}</div>
                        </div>
                      </div>
                    )}

                    {treasuryMultisig?.initialized && (
                      <>
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Propose New Rewards</div>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div>
                              <label style={{ fontSize: 12, opacity: 0.7, display: 'block', marginBottom: 4 }}>Referrer Reward (NTC)</label>
                              <input type="number" step="0.01" min="0" value={proposedReferrerReward} onChange={e => setProposedReferrerReward(e.target.value)} placeholder={String(referralConfig.referrerReward)} className="admin-setting-input" style={{ width: 140 }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 12, opacity: 0.7, display: 'block', marginBottom: 4 }}>Referee Reward (NTC)</label>
                              <input type="number" step="0.01" min="0" value={proposedRefereeReward} onChange={e => setProposedRefereeReward(e.target.value)} placeholder={String(referralConfig.refereeReward)} className="admin-setting-input" style={{ width: 140 }} />
                            </div>
                            <button className="admin-btn admin-btn-save"
                              disabled={!proposedReferrerReward && !proposedRefereeReward || referralActionLoading === 'propose' || !publicKey}
                              onClick={handleProposeReferralConfigChange}
                              style={{ padding: '8px 20px' }}>
                              {referralActionLoading === 'propose' ? 'Creating Proposal...' : 'Propose Change'}
                            </button>
                          </div>
                          {(proposedReferrerReward || proposedRefereeReward) && (
                            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 8, fontSize: 12 }}>
                              <span style={{ opacity: 0.6 }}>Change:</span> Referrer {referralConfig.referrerReward} → <strong>{proposedReferrerReward || referralConfig.referrerReward}</strong> NTC, Referee {referralConfig.refereeReward} → <strong>{proposedRefereeReward || referralConfig.refereeReward}</strong> NTC
                              <span style={{ marginLeft: 12, opacity: 0.5 }}>Requires {treasuryMultisig?.threshold || 2} of {treasuryMultisig?.members?.length || 3} approvals</span>
                            </div>
                          )}
                        </div>

                        {referralProposals.length > 0 && (
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Reward Change Proposals</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {referralProposals.map(p => {
                                const isActive = p.status === 'active'
                                const isApproved = p.status === 'approved'
                                const isExecuted = p.status === 'executed'
                                const approvalsNeeded = (p.threshold || 2) - (p.approvals || 0)
                                let approvedBy = p.approved_by
                                if (typeof approvedBy === 'string') { try { approvedBy = JSON.parse(approvedBy) } catch { approvedBy = [] } }
                                if (!Array.isArray(approvedBy)) approvedBy = []
                                const currentWallet = publicKey?.toBase58() || ''
                                const alreadyApproved = approvedBy.includes(currentWallet)
                                const memberCount = treasuryMultisig?.members?.length || 3
                                const canApprove = !isExecuted && !isApproved && !alreadyApproved && approvedBy.length < memberCount && publicKey
                                const canExecute = isApproved && !isExecuted && publicKey
                                return (
                                  <div key={p.id} style={{
                                    padding: '12px 16px',
                                    background: isExecuted ? 'rgba(34,197,94,0.05)' : isApproved ? 'rgba(234,179,8,0.05)' : 'rgba(168,85,247,0.05)',
                                    border: `1px solid ${isExecuted ? 'rgba(34,197,94,0.2)' : isApproved ? 'rgba(234,179,8,0.2)' : 'rgba(168,85,247,0.2)'}`,
                                    borderRadius: 10,
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{ fontSize: 14, fontWeight: 700 }}>#{p.transaction_index}</span>
                                        <span style={{
                                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                                          background: isExecuted ? 'rgba(34,197,94,0.15)' : isApproved ? 'rgba(234,179,8,0.15)' : 'rgba(168,85,247,0.15)',
                                          color: isExecuted ? '#22c55e' : isApproved ? '#eab308' : '#a855f7',
                                        }}>
                                          {isExecuted ? 'EXECUTED' : isApproved ? 'READY TO EXECUTE' : 'PENDING APPROVAL'}
                                        </span>
                                        {alreadyApproved && !isExecuted && (
                                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>YOUR VOTE: APPROVED</span>
                                        )}
                                      </div>
                                      <span style={{ fontSize: 11, opacity: 0.5 }}>{new Date(p.created_at).toLocaleString()}</span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                                      <div><span style={{ opacity: 0.5 }}>Referrer:</span> <strong>{p.current_referrer_reward}</strong> → <strong style={{ color: '#a855f7' }}>{p.proposed_referrer_reward}</strong> NTC</div>
                                      <div><span style={{ opacity: 0.5 }}>Referee:</span> <strong>{p.current_referee_reward}</strong> → <strong style={{ color: '#a855f7' }}>{p.proposed_referee_reward}</strong> NTC</div>
                                      <div><span style={{ opacity: 0.5 }}>Approvals:</span> <strong style={{ color: approvalsNeeded <= 0 ? '#22c55e' : '#eab308' }}>{p.approvals || 0}/{p.threshold || 2}</strong></div>
                                      <div><span style={{ opacity: 0.5 }}>Creator:</span> <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{p.creator?.slice(0, 4)}...{p.creator?.slice(-4)}</span></div>
                                      {approvedBy.length > 0 && (
                                        <div style={{ gridColumn: '1 / -1' }}><span style={{ opacity: 0.5 }}>Approved by:</span> {approvedBy.map((w, i) => <span key={i} style={{ fontFamily: 'monospace', fontSize: 10, marginLeft: 4 }}>{w.slice(0, 4)}...{w.slice(-4)}{i < approvedBy.length - 1 ? ',' : ''}</span>)}</div>
                                      )}
                                      {p.execute_signature && (
                                        <div style={{ gridColumn: '1 / -1' }}>
                                          <span style={{ opacity: 0.5 }}>Execute Tx:</span>{' '}
                                          <a href={explorerTxUrl(p.execute_signature)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: 11, color: '#22c55e', textDecoration: 'underline' }}>{p.execute_signature.slice(0, 20)}...{p.execute_signature.slice(-8)}</a>
                                        </div>
                                      )}
                                    </div>
                                    {!isExecuted && (
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        {canApprove && (
                                          <button
                                            className="admin-btn admin-btn-edit"
                                            disabled={referralActionLoading === 'approve-' + p.transaction_index || referralActionLoading === 'confirming-approve-' + p.transaction_index}
                                            onClick={() => handleReferralApprove(p.transaction_index)}
                                            style={{ padding: '5px 16px', fontSize: 12 }}
                                          >
                                            {referralActionLoading === 'confirming-approve-' + p.transaction_index ? 'Confirming transaction...' : referralActionLoading === 'approve-' + p.transaction_index ? 'Approving...' : `Approve (${p.approvals || 0}/${p.threshold || 2})`}
                                          </button>
                                        )}
                                        {canExecute && (
                                          <button
                                            className="admin-btn admin-btn-save"
                                            disabled={referralActionLoading === 'execute-' + p.transaction_index || referralActionLoading === 'confirming-execute-' + p.transaction_index}
                                            onClick={() => handleReferralExecute(p.transaction_index)}
                                            style={{ padding: '5px 16px', fontSize: 12 }}
                                          >
                                            {referralActionLoading === 'confirming-execute-' + p.transaction_index ? 'Confirming transaction...' : referralActionLoading === 'execute-' + p.transaction_index ? 'Executing...' : 'Execute'}
                                          </button>
                                        )}
                                        {alreadyApproved && !isApproved && (
                                          <span style={{ fontSize: 11, color: '#a855f7', background: 'rgba(168,85,247,0.08)', padding: '4px 10px', borderRadius: 6 }}>You already approved -- waiting for {approvalsNeeded} more owner{approvalsNeeded > 1 ? 's' : ''}</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {!treasuryMultisig?.initialized && (
                      <div style={{ opacity: 0.6, fontSize: 13 }}>
                        Multisig not configured. Set up a Squads multisig from the <strong style={{ color: '#a855f7', cursor: 'pointer' }} onClick={() => setActiveTab('setup')}>Setup tab</strong> to propose reward changes.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'token-prices' && (
            <div className="admin-settings">
              {tokenPricesLoading ? (
                <div className="admin-card" style={{ textAlign: 'center', padding: 40 }}>Loading token prices data...</div>
              ) : (
                <>
                  <div className="admin-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <h3 style={{ margin: 0 }}>Token Buy Prices</h3>
                      <button className="admin-btn admin-btn-edit" onClick={invalidateAdminTokenPrices} style={{ fontSize: 12 }}>
                        {tokenPricesLoading ? 'Loading...' : 'Refresh'}
                      </button>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
                      Admin-set buy prices (USD) for each token. The Buy tab only uses prices configured here — tokens without a set price cannot be purchased. Changes require multisig approval via Squads.
                    </div>

                    {tokenPriceActionError && (
                      <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#ef4444', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                        {tokenPriceActionError}
                        <button style={{ marginLeft: 12, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }} onClick={() => setTokenPriceActionError(null)}>Dismiss</button>
                      </div>
                    )}
                    {tokenPriceActionResult && (
                      <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#22c55e', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                        {tokenPriceActionResult.type === 'propose' && `Price change proposed! Transaction #${tokenPriceActionResult.transactionIndex} — ${tokenPriceActionResult.tokenSymbol}: $${tokenPriceActionResult.price}`}
                        {tokenPriceActionResult.type === 'approve' && `Token price proposal #${tokenPriceActionResult.transactionIndex} approved.`}
                        {tokenPriceActionResult.type === 'execute' && `Token price proposal #${tokenPriceActionResult.transactionIndex} executed. New price is now active.`}
                        {tokenPriceActionResult.signature && (
                          <a href={explorerTxUrl(tokenPriceActionResult.signature)} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: '#22c55e', textDecoration: 'underline' }}>View Tx</a>
                        )}
                        <button style={{ marginLeft: 12, background: 'none', border: 'none', color: '#22c55e', cursor: 'pointer' }} onClick={() => setTokenPriceActionResult(null)}>Dismiss</button>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
                      {(() => {
                        const TOKEN_META = {
                          NTC: { fullName: 'Nite Treasury Currency', fiatRef: '—', color: '#a855f7', basePrice: 1.00 },
                          ASDC: { fullName: 'America States Digital Currency', fiatRef: 'USD', color: '#3b82f6', basePrice: 1.00 },
                          EDC: { fullName: 'Euro Digital Currency', fiatRef: 'EUR', color: '#eab308', basePrice: 1.00 },
                          RDC: { fullName: 'Brazil Digital Currency', fiatRef: 'BRL', color: '#22c55e', basePrice: 1.00 },
                          DMC: { fullName: 'Dome Coin', fiatRef: 'BTC', color: '#f97316', basePrice: 1.00 },
                          BDC: { fullName: 'British Digital Currency', fiatRef: 'GBP', color: '#ef4444', basePrice: 1.00 },
                          YDC: { fullName: 'Yuan Digital Currency', fiatRef: 'CNY', color: '#dc2626', basePrice: 1.00 },
                          SDC: { fullName: 'Swiss Digital Currency', fiatRef: 'CHF', color: '#f43f5e', basePrice: 1.00 },
                          CDC: { fullName: 'Canadian Digital Currency', fiatRef: 'CAD', color: '#e11d48', basePrice: 1.00 },
                          ADC: { fullName: 'Australian Digital Currency', fiatRef: 'AUD', color: '#06b6d4', basePrice: 1.00 },
                          SGDC: { fullName: 'Singapore Digital Currency', fiatRef: 'SGD', color: '#8b5cf6', basePrice: 1.00 },
                        }
                        return ['NTC', 'ASDC', 'EDC', 'RDC', 'DMC', 'BDC', 'YDC', 'SDC', 'CDC', 'ADC', 'SGDC'].map(sym => {
                          const priceRow = tokenPrices.find(p => p.token_symbol === sym)
                          const hasAdminPrice = priceRow && priceRow.price_usd != null
                          const meta = TOKEN_META[sym] || {}
                          return (
                            <div key={sym} className="admin-stat-card" style={{ padding: '14px 16px', borderLeft: `3px solid ${meta.color || '#a855f7'}` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontSize: 15, fontWeight: 700, color: meta.color || '#a855f7' }}>{sym}</span>
                                <span style={{
                                  fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                                  background: hasAdminPrice ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.1)',
                                  color: hasAdminPrice ? '#22c55e' : '#ef4444',
                                }}>{hasAdminPrice ? 'ACTIVE' : 'BUY DISABLED'}</span>
                              </div>
                              <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8, lineHeight: 1.3 }}>{meta.fullName}</div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                                <span style={{ fontSize: 11, opacity: 0.5 }}>Buy Price:</span>
                                {hasAdminPrice ? (
                                  <span style={{ fontSize: 16, fontWeight: 700, color: '#22c55e' }}>${Number(priceRow.price_usd).toFixed(6)}</span>
                                ) : (
                                  <span style={{ fontSize: 12, color: '#ef4444', opacity: 0.7 }}>No price set</span>
                                )}
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                <span style={{ fontSize: 11, opacity: 0.5 }}>Default Price:</span>
                                <span style={{ fontSize: 12, opacity: 0.6 }}>${meta.basePrice?.toFixed(2)}</span>
                              </div>
                              {hasAdminPrice && priceRow.updated_at && (
                                <div style={{ fontSize: 10, opacity: 0.35, marginTop: 6, textAlign: 'right' }}>
                                  Updated: {new Date(priceRow.updated_at).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          )
                        })
                      })()}
                    </div>

                    {treasuryMultisig?.initialized && (
                      <>
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Propose New Price</div>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div>
                              <label style={{ fontSize: 12, opacity: 0.7, display: 'block', marginBottom: 4 }}>Token</label>
                              <select value={proposedTokenSymbol} onChange={e => setProposedTokenSymbol(e.target.value)} className="admin-setting-input" style={{ width: 120 }}>
                                {['NTC', 'ASDC', 'EDC', 'RDC', 'DMC', 'BDC', 'YDC', 'SDC', 'CDC', 'ADC', 'SGDC'].map(sym => (
                                  <option key={sym} value={sym}>{sym}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: 12, opacity: 0.7, display: 'block', marginBottom: 4 }}>New Price (USD)</label>
                              <input type="number" step="0.000001" min="0" value={proposedTokenPrice} onChange={e => setProposedTokenPrice(e.target.value)} placeholder="e.g. 1.00" className="admin-setting-input" style={{ width: 160 }} />
                            </div>
                            <button className="admin-btn admin-btn-save"
                              disabled={!proposedTokenPrice || tokenPriceActionLoading === 'propose' || !publicKey}
                              onClick={handleProposeTokenPriceChange}
                              style={{ padding: '8px 20px' }}>
                              {tokenPriceActionLoading === 'propose' ? 'Creating Proposal...' : 'Propose Change'}
                            </button>
                          </div>
                          {proposedTokenPrice && (
                            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 8, fontSize: 12 }}>
                              <span style={{ opacity: 0.6 }}>Change:</span> {proposedTokenSymbol} → <strong>${proposedTokenPrice}</strong> USD
                              <span style={{ marginLeft: 12, opacity: 0.5 }}>Requires {treasuryMultisig?.threshold || 2} of {treasuryMultisig?.members?.length || 3} approvals</span>
                            </div>
                          )}
                        </div>

                        {tokenPriceProposals.length > 0 && (
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Price Change Proposals</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {tokenPriceProposals.map(p => {
                                const isApproved = p.status === 'approved'
                                const isExecuted = p.status === 'executed'
                                const approvalsNeeded = (p.threshold || 2) - (p.approvals || 0)
                                let approvedBy = p.approved_by
                                if (typeof approvedBy === 'string') { try { approvedBy = JSON.parse(approvedBy) } catch { approvedBy = [] } }
                                if (!Array.isArray(approvedBy)) approvedBy = []
                                const currentWallet = publicKey?.toBase58() || ''
                                const alreadyApproved = approvedBy.includes(currentWallet)
                                const memberCount = treasuryMultisig?.members?.length || 3
                                const canApprove = !isExecuted && !isApproved && !alreadyApproved && approvedBy.length < memberCount && publicKey
                                const canExecute = isApproved && !isExecuted && publicKey
                                return (
                                  <div key={p.id} style={{
                                    padding: '12px 16px',
                                    background: isExecuted ? 'rgba(34,197,94,0.05)' : isApproved ? 'rgba(234,179,8,0.05)' : 'rgba(168,85,247,0.05)',
                                    border: `1px solid ${isExecuted ? 'rgba(34,197,94,0.2)' : isApproved ? 'rgba(234,179,8,0.2)' : 'rgba(168,85,247,0.2)'}`,
                                    borderRadius: 10,
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{ fontSize: 14, fontWeight: 700 }}>#{p.transaction_index}</span>
                                        <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>{p.token_symbol}</span>
                                        <span style={{
                                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                                          background: isExecuted ? 'rgba(34,197,94,0.15)' : isApproved ? 'rgba(234,179,8,0.15)' : 'rgba(168,85,247,0.15)',
                                          color: isExecuted ? '#22c55e' : isApproved ? '#eab308' : '#a855f7',
                                        }}>
                                          {isExecuted ? 'EXECUTED' : isApproved ? 'READY TO EXECUTE' : 'PENDING APPROVAL'}
                                        </span>
                                        {alreadyApproved && !isExecuted && (
                                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>YOUR VOTE: APPROVED</span>
                                        )}
                                      </div>
                                      <span style={{ fontSize: 11, opacity: 0.5 }}>{new Date(p.created_at).toLocaleString()}</span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                                      <div><span style={{ opacity: 0.5 }}>Current:</span> <strong>${Number(p.current_price).toFixed(6)}</strong></div>
                                      <div><span style={{ opacity: 0.5 }}>Proposed:</span> <strong style={{ color: '#a855f7' }}>${Number(p.proposed_price).toFixed(6)}</strong></div>
                                      <div><span style={{ opacity: 0.5 }}>Approvals:</span> <strong style={{ color: approvalsNeeded <= 0 ? '#22c55e' : '#eab308' }}>{p.approvals || 0}/{p.threshold || 2}</strong></div>
                                      <div><span style={{ opacity: 0.5 }}>Creator:</span> <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{p.creator?.slice(0, 4)}...{p.creator?.slice(-4)}</span></div>
                                      {p.propose_signature && (
                                        <div style={{ gridColumn: '1 / -1' }}>
                                          <span style={{ opacity: 0.5 }}>Propose Tx:</span>{' '}
                                          <a href={explorerTxUrl(p.propose_signature)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: 11, color: '#a855f7', textDecoration: 'underline' }}>{p.propose_signature.slice(0, 20)}...{p.propose_signature.slice(-8)}</a>
                                        </div>
                                      )}
                                      {(() => {
                                        let approveSigs = p.approve_signatures
                                        if (typeof approveSigs === 'string') { try { approveSigs = JSON.parse(approveSigs) } catch { approveSigs = [] } }
                                        if (!Array.isArray(approveSigs)) approveSigs = []
                                        return approveSigs.length > 0 && (
                                          <div style={{ gridColumn: '1 / -1' }}>
                                            <span style={{ opacity: 0.5 }}>Approve Tx{approveSigs.length > 1 ? 's' : ''}:</span>{' '}
                                            {approveSigs.map((s, i) => (
                                              <span key={i} style={{ marginRight: 10 }}>
                                                <span style={{ fontFamily: 'monospace', fontSize: 10, opacity: 0.6 }}>{s.wallet?.slice(0, 4)}...{s.wallet?.slice(-4)}</span>{' '}
                                                <a href={explorerTxUrl(s.signature)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: 11, color: '#22c55e', textDecoration: 'underline' }}>{s.signature?.slice(0, 16)}...{s.signature?.slice(-8)}</a>
                                              </span>
                                            ))}
                                          </div>
                                        )
                                      })()}
                                      {approvedBy.length > 0 && (
                                        <div style={{ gridColumn: '1 / -1' }}><span style={{ opacity: 0.5 }}>Approved by:</span> {approvedBy.map((w, i) => <span key={i} style={{ fontFamily: 'monospace', fontSize: 10, marginLeft: 4 }}>{w.slice(0, 4)}...{w.slice(-4)}{i < approvedBy.length - 1 ? ',' : ''}</span>)}</div>
                                      )}
                                      {p.execute_signature && (
                                        <div style={{ gridColumn: '1 / -1' }}>
                                          <span style={{ opacity: 0.5 }}>Execute Tx:</span>{' '}
                                          <a href={explorerTxUrl(p.execute_signature)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: 11, color: '#22c55e', textDecoration: 'underline' }}>{p.execute_signature.slice(0, 20)}...{p.execute_signature.slice(-8)}</a>
                                        </div>
                                      )}
                                    </div>
                                    {!isExecuted && (
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        {canApprove && (
                                          <button
                                            className="admin-btn admin-btn-edit"
                                            disabled={tokenPriceActionLoading === 'approve-' + p.transaction_index || tokenPriceActionLoading === 'confirming-approve-' + p.transaction_index}
                                            onClick={() => handleTokenPriceApprove(p.transaction_index)}
                                            style={{ padding: '5px 16px', fontSize: 12 }}
                                          >
                                            {tokenPriceActionLoading === 'confirming-approve-' + p.transaction_index ? 'Confirming transaction...' : tokenPriceActionLoading === 'approve-' + p.transaction_index ? 'Approving...' : `Approve (${p.approvals || 0}/${p.threshold || 2})`}
                                          </button>
                                        )}
                                        {canExecute && (
                                          <button
                                            className="admin-btn admin-btn-save"
                                            disabled={tokenPriceActionLoading === 'execute-' + p.transaction_index || tokenPriceActionLoading === 'confirming-execute-' + p.transaction_index}
                                            onClick={() => handleTokenPriceExecute(p.transaction_index)}
                                            style={{ padding: '5px 16px', fontSize: 12 }}
                                          >
                                            {tokenPriceActionLoading === 'confirming-execute-' + p.transaction_index ? 'Confirming transaction...' : tokenPriceActionLoading === 'execute-' + p.transaction_index ? 'Executing...' : 'Execute'}
                                          </button>
                                        )}
                                        {alreadyApproved && !isApproved && (
                                          <span style={{ fontSize: 11, color: '#a855f7', background: 'rgba(168,85,247,0.08)', padding: '4px 10px', borderRadius: 6 }}>You already approved -- waiting for {approvalsNeeded} more owner{approvalsNeeded > 1 ? 's' : ''}</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {!treasuryMultisig?.initialized && (
                      <div style={{ opacity: 0.6, fontSize: 13 }}>
                        Multisig not configured. Set up a Squads multisig from the <strong style={{ color: '#a855f7', cursor: 'pointer' }} onClick={() => setActiveTab('setup')}>Setup tab</strong> to propose price changes.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'purchases' && canAccessTab('purchases', adminRole) && (
            <PurchasesTab />
          )}

          {activeTab === 'performance' && (
            <div className="oracle-perf">
              {!perfData ? (
                <div className="oracle-loading">Loading performance data...</div>
              ) : (
                <>
                  <div className="oracle-grid-top">
                    <div className="oracle-card">
                      <div className="oracle-card-header">
                        <span className="oracle-card-title">System Uptime</span>
                      </div>
                      <div className="oracle-big-price">{perfData.uptime?.formatted || '--'}</div>
                      <div className="oracle-meta-row" style={{marginTop: 8}}>
                        <span>Started: <strong>{perfData.uptime?.startedAt ? new Date(perfData.uptime.startedAt).toLocaleString() : '--'}</strong></span>
                      </div>
                    </div>

                    <div className="oracle-card">
                      <div className="oracle-card-header">
                        <span className="oracle-card-title">Request Throughput</span>
                      </div>
                      <div className="oracle-perf-stats-row">
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value">{perfData.requests?.total?.toLocaleString() || '0'}</span>
                          <span className="oracle-perf-stat-label">Total Requests</span>
                        </div>
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value">{perfData.requests?.perMinute || '0'}</span>
                          <span className="oracle-perf-stat-label">Req/Min</span>
                        </div>
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value" style={{ color: (perfData.requests?.errorRate || 0) > 5 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                            {perfData.requests?.errorRate || '0'}%
                          </span>
                          <span className="oracle-perf-stat-label">Error Rate</span>
                        </div>
                      </div>
                      <div className="oracle-meta-row" style={{marginTop: 8, flexWrap: 'wrap', gap: 8}}>
                        {Object.entries(perfData.requests?.statusCodes || {}).map(([code, count]) => (
                          <span key={code} className={`oracle-status-code oracle-status-code-${code}`}>{code}: {count}</span>
                        ))}
                      </div>
                    </div>

                    <div className="oracle-card">
                      <div className="oracle-card-header">
                        <span className="oracle-card-title">Cache Performance</span>
                      </div>
                      <div className="oracle-perf-stats-row">
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value" style={{ color: 'var(--accent-green)' }}>{perfData.cache?.hitRate || 0}%</span>
                          <span className="oracle-perf-stat-label">Hit Rate</span>
                        </div>
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value">{perfData.cache?.hits?.toLocaleString() || '0'}</span>
                          <span className="oracle-perf-stat-label">Hits</span>
                        </div>
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value">{perfData.cache?.misses?.toLocaleString() || '0'}</span>
                          <span className="oracle-perf-stat-label">Misses</span>
                        </div>
                      </div>
                      <div className="oracle-cache-bar">
                        <div className="oracle-cache-bar-fill" style={{ width: `${perfData.cache?.hitRate || 0}%` }} />
                      </div>
                    </div>
                  </div>

                  <div className="oracle-grid-mid">
                    <div className="oracle-card">
                      <div className="oracle-card-header">
                        <span className="oracle-card-title">Memory Usage</span>
                      </div>
                      <div className="oracle-perf-stats-row">
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value">{perfData.memory?.heapUsed || '--'}</span>
                          <span className="oracle-perf-stat-label">Heap Used</span>
                        </div>
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value">{perfData.memory?.heapTotal || '--'}</span>
                          <span className="oracle-perf-stat-label">Heap Total</span>
                        </div>
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value">{perfData.memory?.rss || '--'}</span>
                          <span className="oracle-perf-stat-label">RSS</span>
                        </div>
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value">{perfData.memory?.external || '--'}</span>
                          <span className="oracle-perf-stat-label">External</span>
                        </div>
                      </div>
                      {perfData.memory?.heapUsedRaw && perfData.memory?.heapTotalRaw && (
                        <div className="oracle-cache-bar" style={{marginTop: 12}}>
                          <div className="oracle-cache-bar-fill oracle-mem-bar-fill" style={{ width: `${((perfData.memory.heapUsedRaw / perfData.memory.heapTotalRaw) * 100).toFixed(1)}%` }} />
                        </div>
                      )}
                    </div>

                    <div className="oracle-card">
                      <div className="oracle-card-header">
                        <span className="oracle-card-title">Oracle Feed Health</span>
                      </div>
                      <div className="oracle-perf-stats-row">
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value">{perfData.oracle?.totalFeeds || 0}</span>
                          <span className="oracle-perf-stat-label">Total Feeds</span>
                        </div>
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value" style={{ color: 'var(--accent-green)' }}>{perfData.oracle?.freshFeeds || 0}</span>
                          <span className="oracle-perf-stat-label">Fresh (&lt;5m)</span>
                        </div>
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value" style={{ color: (perfData.oracle?.staleFeeds || 0) > 0 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
                            {perfData.oracle?.staleFeeds || 0}
                          </span>
                          <span className="oracle-perf-stat-label">Stale</span>
                        </div>
                        <div className="oracle-perf-stat">
                          <span className="oracle-perf-stat-value" style={{ color: (perfData.oracle?.freshnessRate || 0) >= 80 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {perfData.oracle?.freshnessRate || 0}%
                          </span>
                          <span className="oracle-perf-stat-label">Freshness</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="oracle-card" style={{marginBottom: 16}}>
                    <div className="oracle-card-header">
                      <span className="oracle-card-title">Slowest Endpoints (P95)</span>
                    </div>
                    {perfData.endpoints?.topSlowest?.length > 0 ? (
                      <div className="oracle-history-table-wrap">
                        <table className="oracle-history-table">
                          <thead>
                            <tr>
                              <th>Endpoint</th>
                              <th>P95</th>
                              <th>Avg</th>
                              <th>Min</th>
                              <th>Max</th>
                              <th>Calls</th>
                            </tr>
                          </thead>
                          <tbody>
                            {perfData.endpoints.topSlowest.map((ep, i) => (
                              <tr key={i}>
                                <td><code style={{fontSize: 12}}>{ep.route}</code></td>
                                <td style={{ color: ep.p95 > 500 ? 'var(--accent-red)' : ep.p95 > 100 ? 'orange' : 'var(--accent-green)' }}>
                                  <strong>{ep.p95.toFixed(1)}ms</strong>
                                </td>
                                <td>{ep.avg.toFixed(1)}ms</td>
                                <td>{ep.min.toFixed(1)}ms</td>
                                <td>{ep.max.toFixed(1)}ms</td>
                                <td>{ep.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="oracle-history-empty">No endpoint data yet — try refreshing after some API activity</div>
                    )}
                  </div>

                  <div className="oracle-card" style={{marginBottom: 16}}>
                    <div className="oracle-card-header">
                      <span className="oracle-card-title">Busiest Endpoints</span>
                    </div>
                    {perfData.endpoints?.topBusiest?.length > 0 ? (
                      <div className="oracle-history-table-wrap">
                        <table className="oracle-history-table">
                          <thead>
                            <tr>
                              <th>Endpoint</th>
                              <th>Calls</th>
                              <th>Avg</th>
                              <th>P95</th>
                            </tr>
                          </thead>
                          <tbody>
                            {perfData.endpoints.topBusiest.map((ep, i) => (
                              <tr key={i}>
                                <td><code style={{fontSize: 12}}>{ep.route}</code></td>
                                <td><strong>{ep.count}</strong></td>
                                <td>{ep.avg.toFixed(1)}ms</td>
                                <td style={{ color: ep.p95 > 500 ? 'var(--accent-red)' : 'var(--accent-green)' }}>{ep.p95.toFixed(1)}ms</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="oracle-history-empty">No endpoint data yet</div>
                    )}
                  </div>

                  {perfData.oracle?.feeds?.length > 0 && (
                    <div className="oracle-card" style={{marginBottom: 16}}>
                      <div className="oracle-card-header">
                        <span className="oracle-card-title">Oracle Feed Details</span>
                      </div>
                      <div className="oracle-history-table-wrap">
                        <table className="oracle-history-table">
                          <thead>
                            <tr>
                              <th>Token</th>
                              <th>Pair</th>
                              <th>Price</th>
                              <th>Source</th>
                              <th>Age</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {perfData.oracle.feeds.map((f, i) => (
                              <tr key={i}>
                                <td><strong>{f.token}</strong></td>
                                <td>{f.pair || '--'}</td>
                                <td className="oracle-history-price">{formatPerfPrice(f.price)}</td>
                                <td><span className={`oracle-source-badge oracle-source-${f.source}`}>{f.source}</span></td>
                                <td>{f.ageSeconds != null ? formatPerfAge(f.ageSeconds) : '--'}</td>
                                <td>
                                  <span className="oracle-feed-status" style={{ color: f.fresh ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                    {f.fresh ? 'Fresh' : 'Stale'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {perfData.recentErrors?.length > 0 && (
                    <div className="oracle-card">
                      <div className="oracle-card-header">
                        <span className="oracle-card-title">Recent Errors</span>
                      </div>
                      <div className="oracle-history-table-wrap">
                        <table className="oracle-history-table">
                          <thead><tr><th>Time</th><th>Route</th><th>Status</th></tr></thead>
                          <tbody>
                            {perfData.recentErrors.map((err, i) => (
                              <tr key={i}>
                                <td>{new Date(err.time).toLocaleString()}</td>
                                <td><code style={{fontSize: 12}}>{err.route}</code></td>
                                <td style={{ color: 'var(--accent-red)' }}><strong>{err.status}</strong></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'settings' && canAccessTab('settings', adminRole) && (
            <div className="admin-settings">
              <div className="admin-card">
                <h3>{t('admin_platform_settings')}</h3>
                <div className="admin-settings-list">
                  <div className="admin-setting-item">
                    <div className="admin-setting-info">
                      <span className="admin-setting-label">{t('admin_swap_fee')}</span>
                      <span className="admin-setting-desc">{t('admin_swap_fee_desc')}</span>
                    </div>
                    {editingSwapFee ? (
                      <div className="admin-setting-edit">
                        <input
                          type="number"
                          step="0.05"
                          min="0.01"
                          max="5"
                          value={tempSwapFee}
                          onChange={(e) => setTempSwapFee(e.target.value)}
                          className="admin-setting-input"
                        />
                        <span className="admin-setting-unit">%</span>
                        <button className="admin-setting-save" onClick={() => {
                          const val = parseFloat(tempSwapFee)
                          if (val > 0 && val <= 5) { setSwapFee(val); setEditingSwapFee(false) }
                        }}>✓</button>
                        <button className="admin-setting-cancel" onClick={() => { setTempSwapFee(String(swapFee)); setEditingSwapFee(false) }}>✕</button>
                      </div>
                    ) : (
                      <span className="admin-setting-value admin-setting-editable" onClick={() => { setTempSwapFee(String(swapFee)); setEditingSwapFee(true) }}>{swapFee}%</span>
                    )}
                  </div>
                  <div className="admin-setting-item">
                    <div className="admin-setting-info">
                      <span className="admin-setting-label">{t('admin_max_slippage')}</span>
                      <span className="admin-setting-desc">{t('admin_max_slippage_desc')}</span>
                    </div>
                    {editingSlippage ? (
                      <div className="admin-setting-edit">
                        <input
                          type="number"
                          step="0.5"
                          min="0.1"
                          max="50"
                          value={tempSlippage}
                          onChange={(e) => setTempSlippage(e.target.value)}
                          className="admin-setting-input"
                        />
                        <span className="admin-setting-unit">%</span>
                        <button className="admin-setting-save" onClick={() => {
                          const val = parseFloat(tempSlippage)
                          if (val > 0 && val <= 50) { setMaxSlippage(val); setEditingSlippage(false) }
                        }}>✓</button>
                        <button className="admin-setting-cancel" onClick={() => { setTempSlippage(String(maxSlippage)); setEditingSlippage(false) }}>✕</button>
                      </div>
                    ) : (
                      <span className="admin-setting-value admin-setting-editable" onClick={() => { setTempSlippage(String(maxSlippage)); setEditingSlippage(true) }}>{maxSlippage}%</span>
                    )}
                  </div>
                  <div className="admin-setting-item">
                    <div className="admin-setting-info">
                      <span className="admin-setting-label">{t('admin_maintenance')}</span>
                      <span className="admin-setting-desc">{t('admin_maintenance_desc')}</span>
                    </div>
                    <label className="admin-toggle">
                      <input type="checkbox" checked={maintenanceMode} onChange={(e) => setMaintenanceMode(e.target.checked)} />
                      <span className="admin-toggle-slider"></span>
                      <span className={`admin-toggle-label ${maintenanceMode ? 'admin-status-paused' : 'admin-status-active'}`}>
                        {maintenanceMode ? t('admin_status_on') || 'On' : t('admin_status_off')}
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="admin-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0 }}>{t('admin_admin_wallets')}</h3>
                  {(adminRole === 'owner' || adminRole === 'super_admin') && (
                    <button className="admin-btn admin-btn-save" onClick={() => setShowAddAdmin(true)}>+ Add Admin</button>
                  )}
                </div>
                <div className="admin-wallets-list">
                  {adminList.map(admin => {
                    const isSelf = publicKey && admin.wallet === publicKey.toBase58()
                    return (
                      <div key={admin.wallet} className="admin-wallet-row">
                        <span className="admin-wallet-addr">{admin.wallet}</span>
                        <div className="admin-wallet-actions">
                          <span className={`admin-wallet-role ${admin.role}`}>
                            {admin.role === 'owner' ? 'Owner' : admin.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                          </span>
                          {!isSelf && admin.role !== 'owner' && (adminRole === 'owner' || (adminRole === 'super_admin' && admin.role === 'admin')) && (
                            <button className="admin-btn admin-btn-cancel" style={{ padding: '4px 10px', fontSize: 11 }} onClick={async () => { try { await removeAdmin(admin.wallet) } catch (e) { alert('Failed to remove admin: ' + (e.message || 'Unknown error')) } }}>Remove</button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {showAddAdmin && (
                <div className="modal-overlay" onClick={() => setShowAddAdmin(false)}>
                  <div className="admin-confirm-modal" onClick={e => e.stopPropagation()} style={{ textAlign: 'left', gap: 16 }}>
                    <h3 style={{ margin: 0, width: '100%' }}>Add New Admin</h3>
                    <div className="admin-add-token-field" style={{ width: '100%' }}>
                      <label>Wallet Address *</label>
                      <input type="text" placeholder="Enter Solana wallet address" value={newAdminWallet} onChange={e => setNewAdminWallet(e.target.value)} />
                    </div>
                    <div className="admin-add-token-field" style={{ width: '100%' }}>
                      <label>Admin Level *</label>
                      <select className="admin-select" value={newAdminRole} onChange={e => setNewAdminRole(e.target.value)} style={{ width: '100%' }}>
                        <option value="admin">Regular Admin</option>
                        {adminRole === 'owner' && <option value="super_admin">Super Admin</option>}
                      </select>
                    </div>
                    <div className="admin-add-admin-info">
                      <div className="admin-add-admin-info-row">
                        <strong>Super Admin</strong>
                        <span>Full access to all settings, can add/remove other admins</span>
                      </div>
                      <div className="admin-add-admin-info-row">
                        <strong>Regular Admin</strong>
                        <span>Can manage tokens, pools, and liquidity. Cannot manage other admins</span>
                      </div>
                    </div>
                    {addAdminError && <div style={{ color: '#ef4444', fontSize: 13 }}>{addAdminError}</div>}
                    <div className="admin-confirm-actions">
                      <button className="admin-confirm-cancel" onClick={() => { setShowAddAdmin(false); setNewAdminWallet(''); setNewAdminRole('admin'); setAddAdminError('') }}>Cancel</button>
                      <button className="admin-btn admin-btn-save" style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 14 }} disabled={!newAdminWallet.trim()} onClick={async () => {
                        setAddAdminError('')
                        try {
                          await addAdmin(newAdminWallet.trim(), newAdminRole)
                          setNewAdminWallet('')
                          setNewAdminRole('admin')
                          setShowAddAdmin(false)
                        } catch (e) {
                          setAddAdminError(e.message || 'Failed to add admin')
                        }
                      }}>Add Admin</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'net-permissions' && (
            <div className="admin-settings">
              <div className="admin-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0 }}>Network Post Permissions</h3>
                  <button className="admin-btn admin-btn-save" onClick={() => { setShowAddNetPerm(true); setNetPermError('') }}>+ Add Wallet</button>
                </div>
                <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: '1rem' }}>
                  Wallets listed here can create, edit, and delete their own posts on the Networks page. They do not gain any other admin access.
                </p>
                {netPermError && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{netPermError}</div>}
                {netPermLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}><div className="dash-loading-spinner" /></div>
                ) : netPermissions.length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>No wallets have been granted network posting permission yet.</div>
                ) : (
                  <div className="admin-wallets-list">
                    {netPermissions.map(perm => (
                      <div key={perm.wallet} className="admin-wallet-row">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span className="admin-wallet-addr">{perm.wallet}</span>
                          {perm.granted_by && (
                            <span style={{ fontSize: 11, color: '#64748b' }}>Granted by: {perm.granted_by.slice(0, 8)}...{perm.granted_by.slice(-4)}</span>
                          )}
                        </div>
                        <button
                          className="admin-btn admin-btn-cancel"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => removeNetPermission(perm.wallet)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {showAddNetPerm && (
                <div className="modal-overlay" onClick={() => setShowAddNetPerm(false)}>
                  <div className="admin-confirm-modal" onClick={e => e.stopPropagation()} style={{ textAlign: 'left', gap: 16 }}>
                    <h3 style={{ margin: 0, width: '100%' }}>Grant Network Posting Permission</h3>
                    <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
                      This wallet will be able to create, edit, and delete their own network posts. No other admin access is granted.
                    </p>
                    {netPermError && <div style={{ color: '#ef4444', fontSize: 13 }}>{netPermError}</div>}
                    <div className="admin-add-token-field" style={{ width: '100%' }}>
                      <label>Wallet Address *</label>
                      <input
                        type="text"
                        placeholder="Enter Solana wallet address"
                        value={newNetPermWallet}
                        onChange={e => setNewNetPermWallet(e.target.value)}
                      />
                    </div>
                    <div className="admin-confirm-actions">
                      <button className="admin-confirm-cancel" onClick={() => { setShowAddNetPerm(false); setNewNetPermWallet(''); setNetPermError('') }}>Cancel</button>
                      <button
                        className="admin-btn admin-btn-save"
                        style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 14 }}
                        disabled={!newNetPermWallet.trim() || netPermSaving}
                        onClick={addNetPermission}
                      >
                        {netPermSaving ? 'Saving...' : 'Grant Permission'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>


      {showFeesPopup && (
        <div className="modal-overlay" onClick={() => setShowFeesPopup(false)}>
          <div className="admin-fees-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-fees-modal-header">
              <h3>Fee Earnings by Pool</h3>
              <div className="admin-fees-period-tabs">
                {[
                  { key: 'day', label: 'Day' },
                  { key: 'week', label: 'Week' },
                  { key: 'month', label: 'Month' },
                  { key: 'year', label: 'Year' },
                  { key: 'all', label: 'All Time' },
                ].map(p => (
                  <button
                    key={p.key}
                    className={`admin-fees-period-btn ${feesPeriod === p.key ? 'active' : ''}`}
                    onClick={() => setFeesPeriod(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button className="modal-close" onClick={() => setShowFeesPopup(false)}>✕</button>
            </div>
            {(() => {
              const periodPools = pools.map(p => {
                const aSymbol = (p.tokenA.symbol || '').toUpperCase()
                const bSymbol = (p.tokenB.symbol || '').toUpperCase()
                const match = feesBreakdown.find(f => f.tokenA === aSymbol && f.tokenB === bSymbol) || feesBreakdown.find(f => f.tokenA === bSymbol && f.tokenB === aSymbol)
                return {
                  ...p,
                  volume: match ? Math.round(match.volume) : 0,
                  feesEarned: match ? Math.round(match.fees) : 0,
                }
              })
              const totalFees = periodPools.reduce((sum, p) => sum + p.feesEarned, 0)
              const activePools = periodPools.filter(p => p.status === 'active')
              const avgFee = activePools.length > 0 ? Math.round(totalFees / activePools.length) : 0
              return (
                <>
                  <div className="admin-fees-modal-summary">
                    <div className="admin-fees-summary-item">
                      <span className="admin-fees-summary-label">Total Fees Earned</span>
                      <span className="admin-fees-summary-value">${totalFees.toLocaleString()}</span>
                    </div>
                    <div className="admin-fees-summary-item">
                      <span className="admin-fees-summary-label">Active Pools</span>
                      <span className="admin-fees-summary-value">{activePools.length}</span>
                    </div>
                    <div className="admin-fees-summary-item">
                      <span className="admin-fees-summary-label">Avg Fee/Pool</span>
                      <span className="admin-fees-summary-value">${avgFee.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="admin-fees-modal-table-wrap">
                    <table className="admin-fees-table">
                      <thead>
                        <tr>
                          <th>Pool</th>
                          <th>Fee Tier</th>
                          <th>Volume</th>
                          <th>Fees Earned</th>
                          <th>Share</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...periodPools].sort((a, b) => b.feesEarned - a.feesEarned).map(pool => {
                          const share = totalFees > 0 ? ((pool.feesEarned / totalFees) * 100).toFixed(1) : '0.0'
                          return (
                            <tr key={pool.id}>
                              <td>
                                <div className="admin-fees-pool-pair">
                                  {getApiImage(pool.tokenA.id) ? (
                                    <img src={getApiImage(pool.tokenA.id)} alt={pool.tokenA.symbol} style={{ width: 24, height: 24, borderRadius: '50%' }} />
                                  ) : (
                                    <div
                                      className="coin-icon-badge"
                                      style={{ background: `linear-gradient(135deg, ${pool.tokenA.color}, ${pool.tokenA.color}88)`, width: 24, height: 24, fontSize: 9 }}
                                    >
                                      {pool.tokenA.symbol.slice(0, 2)}
                                    </div>
                                  )}
                                  {getApiImage(pool.tokenB.id) ? (
                                    <img src={getApiImage(pool.tokenB.id)} alt={pool.tokenB.symbol} style={{ width: 24, height: 24, borderRadius: '50%', marginLeft: -8 }} />
                                  ) : (
                                    <div
                                      className="coin-icon-badge"
                                      style={{ background: `linear-gradient(135deg, ${pool.tokenB.color}, ${pool.tokenB.color}88)`, width: 24, height: 24, fontSize: 9, marginLeft: -8 }}
                                    >
                                      {pool.tokenB.symbol.slice(0, 2)}
                                    </div>
                                  )}
                                  <span>{pool.tokenA.symbol}/{pool.tokenB.symbol}</span>
                                </div>
                              </td>
                              <td>{pool.feeTier}%</td>
                              <td>${pool.volume.toLocaleString()}</td>
                              <td className="admin-fees-earned">${pool.feesEarned.toLocaleString()}</td>
                              <td>{share}%</td>
                              <td>
                                <span className={`admin-pool-status-badge ${pool.status}`}>{pool.status}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

export default Admin
