import { useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useTokenListStore } from '../stores/useTokenListStore'
import { useTokenPriceStore } from '../stores/useTokenPriceStore'
import { useAdminStore } from '../stores/useAdminStore'
import { useTokenListQuery, useInvalidateTokenList } from '../hooks/queries/useTokenListQuery'
import { usePoolPricesQuery, useInvalidatePoolPrices } from '../hooks/queries/usePoolPricesQuery'
import { useAdminOwnersQuery, useInvalidateAdminOwners } from '../hooks/queries/useAdminOwnersQuery'
import { useInvalidateTokenSupply } from '../hooks/queries/useTokenSupplyQuery'
import { useInvalidateAdminPools } from '../hooks/queries/useAdminPoolsQuery'
import { useInvalidatePoolReserves } from '../hooks/queries/usePoolReservesQuery'
import { useInvalidateSetupStatus } from '../hooks/queries/useSetupStatusQuery'
import { useInvalidateTreasuryData } from '../hooks/queries/useTreasuryDataQuery'
import { useInvalidateAdminSwapLimits } from '../hooks/queries/useSwapLimitsQuery'
import { useInvalidateAdminReferralConfig } from '../hooks/queries/useReferralQuery'
import { useOraclePricesQuery, useInvalidateOraclePrices } from '../hooks/queries/useOraclePricesQuery'
import { useSSERefresh } from '../hooks/useSSEEvent'

export default function StoreInitializer() {
  const { publicKey } = useWallet()
  const { tokens, loading: tokenListLoading } = useTokenListQuery()
  const { poolPrices, poolPricesLoaded } = usePoolPricesQuery()
  const { oraclePrices, oraclePricesLoaded } = useOraclePricesQuery()
  const { ownerWallets } = useAdminOwnersQuery()

  const setTokens = useTokenListStore(s => s.setTokens)
  const setTokenListLoading = useTokenListStore(s => s.setLoading)
  const syncPoolPrices = useTokenPriceStore(s => s.syncPoolPrices)
  const syncOraclePrices = useTokenPriceStore(s => s.syncOraclePrices)
  const setOwnerWallets = useAdminStore(s => s.setOwnerWallets)
  const loadAdminsFromApi = useAdminStore(s => s.loadAdminsFromApi)

  const invalidateTokenList = useInvalidateTokenList()
  const invalidatePoolPrices = useInvalidatePoolPrices()
  const invalidateOraclePrices = useInvalidateOraclePrices()
  const invalidateAdminOwners = useInvalidateAdminOwners()
  const invalidateTokenSupply = useInvalidateTokenSupply()
  const invalidateAdminPools = useInvalidateAdminPools()
  const invalidatePoolReserves = useInvalidatePoolReserves()
  const invalidateSetupStatus = useInvalidateSetupStatus()
  const invalidateTreasuryData = useInvalidateTreasuryData()
  const invalidateAdminSwapLimits = useInvalidateAdminSwapLimits()
  const invalidateAdminReferralConfig = useInvalidateAdminReferralConfig()

  useSSERefresh('tokens:update', invalidateTokenList, 1000)
  useSSERefresh('tokens:update', invalidateTokenSupply, 1000)
  useSSERefresh('prices:update', invalidatePoolPrices, 2000)
  useSSERefresh('prices:update', invalidateOraclePrices, 2000)
  useSSERefresh('pools:update', invalidatePoolPrices, 2000)
  useSSERefresh('pools:update', invalidateAdminPools, 2000)
  useSSERefresh('pools:update', invalidatePoolReserves, 2000)
  useSSERefresh('admin:update', invalidateAdminOwners, 1000)
  useSSERefresh('admin:update', invalidateSetupStatus, 1500)
  useSSERefresh('treasury:update', invalidateTreasuryData, 1500)
  useSSERefresh('balances:update', invalidateTreasuryData, 2000)
  useSSERefresh('swap_limits_update', invalidateAdminSwapLimits, 1500)
  useSSERefresh('referral_config_update', invalidateAdminReferralConfig, 1500)

  useEffect(() => {
    if (tokens && tokens.length > 0) {
      setTokens(tokens)
    }
    setTokenListLoading(tokenListLoading)
  }, [tokens, tokenListLoading, setTokens, setTokenListLoading])

  useEffect(() => {
    if (oraclePricesLoaded) {
      syncOraclePrices(oraclePrices)
    }
  }, [oraclePrices, oraclePricesLoaded, syncOraclePrices])

  useEffect(() => {
    if (poolPricesLoaded) {
      syncPoolPrices(poolPrices)
    }
  }, [poolPrices, poolPricesLoaded, syncPoolPrices])

  useEffect(() => {
    setOwnerWallets(ownerWallets)
  }, [ownerWallets, setOwnerWallets])

  useEffect(() => {
    if (publicKey) {
      window.__adminWalletAddress = publicKey.toBase58()
      loadAdminsFromApi()
    }
  }, [publicKey, loadAdminsFromApi])

  return null
}
