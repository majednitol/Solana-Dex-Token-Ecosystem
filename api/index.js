'use strict';

console.log('[API] Process starting, pid:', process.pid);

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise);
  console.error('[FATAL] Reason:', reason instanceof Error ? reason.stack : reason);
});

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(process.cwd(), 'api/.env') });
if (!process.env.SOLANA_RPC_URL) {
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env') }); 
}   

console.log('[API] Environment loaded, PORT:', process.env.PORT, 'API_PORT:', process.env.API_PORT);

const { Connection, Keypair, PublicKey } = require('@solana/web3.js');

const orca = require('./orca');
const { TokensService } = require('./services/tokens.service');
const { LiquidityService } = require('./services/liquidity.service');
const { SwapService } = require('./services/swap.service');
const { PoolService } = require('./services/pool.service');
const AdminService = require('./services/admin.service');
const OverviewService = require('./services/overview.service');
const { BuildService } = require('./services/build.service');
const { requireWallet, optionalWallet, isValidSolanaPublicKey } = require('./middleware/wallet');
const { initDatabase, shutdown: dbShutdown } = require('./db/init');
const { CacheService } = require('./services/cache.service');
const { TradeService } = require('./services/trade.service');
const { TreasuryService } = require('./services/treasury.service');
const { TokenCreationService } = require('./services/token-creation.service');
const { AdminSetupService } = require('./services/admin-setup.service');
const { SquadsService } = require('./services/squads.service');
const { PriceService } = require('./services/price.service');
const { MetricsService } = require('./services/metrics.service');
const { registerOracleRoutes } = require('./routes/oracle.routes');
const { registerNetworkPostRoutes } = require('./routes/network-posts.routes');
const { ReferralDbService } = require('./services/referral-db.service');
const { NowPaymentsService } = require('./services/nowpayments.service');

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const { getWalletBytes, getWalletKeypair: loadWalletKeypair } = require('./utils/wallet');
const { decodeSolanaError } = require('./utils/solana-error-decoder');

class RouteCache {
  constructor() {
    this.store = new Map();
    this._metricsService = null;
    this._inflight = new Map();
  }
  setMetricsService(ms) { this._metricsService = ms; }
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      if (this._metricsService) this._metricsService.recordCacheMiss();
      return null;
    }
    if (Date.now() > entry.exp) {
      this.store.delete(key);
      if (this._metricsService) this._metricsService.recordCacheMiss();
      return null;
    }
    if (this._metricsService) this._metricsService.recordCacheHit();
    return entry.value;
  }
  set(key, value, ttlMs) {
    this.store.set(key, { value, exp: Date.now() + ttlMs });
  }
  deleteByPrefix(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
    for (const key of this._inflight.keys()) {
      if (key.startsWith(prefix)) this._inflight.delete(key);
    }
  }
  async coalesce(key, ttlMs, fetchFn) {
    const cached = this.get(key);
    if (cached) return cached;
    if (this._inflight.has(key)) return this._inflight.get(key);
    const promise = fetchFn().then(result => {
      this._inflight.delete(key);
      this.set(key, result, ttlMs);
      return result;
    }).catch(err => {
      this._inflight.delete(key);
      throw err;
    });
    this._inflight.set(key, promise);
    return promise;
  }
  getSize() { return this.store.size; }
}
const routeCache = new RouteCache();

function jsonSafe(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

async function main() {
  const RPC_URL = mustEnv('SOLANA_RPC_URL');
  const COMMITMENT = process.env.SOLANA_COMMITMENT || 'confirmed';
  const PORT = Number(process.env.API_PORT || process.env.PORT || 5000);
  const DEBUG_REQUESTS = process.env.DEBUG_REQUESTS === 'true';

  const wallet = loadWalletKeypair();
  const connection = new Connection(RPC_URL, COMMITMENT); 

  const registrySeed = process.env.TOKEN_REGISTRY_SEED || 'token_registry';

  const deps = {
    connection,
    wallet,
    orcaCtx: null,
    programIds: {
      tokenCore: null,
    },
  };

  console.log('RPC:', RPC_URL);
  console.log('Commitment:', COMMITMENT);
  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('Port:', PORT);
  console.log('TOKEN_REGISTRY_SEED:', registrySeed);

  let orcaCtx;
  if (typeof orca.client.create === 'function') {
    orcaCtx = await orca.client.create({ connection, walletKeypair: wallet });
  } else if (typeof orca.client.init === 'function') {
    orcaCtx = await orca.client.init(connection, wallet);
  } else if (typeof orca.client.getContext === 'function') {
    orcaCtx = await orca.client.getContext();
  } else {
    throw new Error('orca.client is missing create/init/getContext. Implement one in api/orca/client.js');
  }
  deps.orcaCtx = orcaCtx;
  console.log('Orca context ready:', !!orcaCtx);

  const walletPubkey = wallet.publicKey.toBase58();

  try {
    const { query: dbQuery } = require('./db/init');
    const pgResult = await dbQuery('SELECT key, value FROM program_config ORDER BY key');
    for (const row of pgResult.rows) {
      if (row.key === 'token_core_program_id' && row.value) {
        deps.programIds.tokenCore = new PublicKey(row.value);
      }
    }
    if (deps.programIds.tokenCore) console.log('TOKEN_CORE_PROGRAM_ID (from DB):', deps.programIds.tokenCore.toBase58());
    if (!deps.programIds.tokenCore) {
      console.warn('No program IDs in database — configure them via Admin Panel Setup tab');
    }
  } catch (e) {
    console.warn('Could not load program IDs from DB:', e.message);
  }

  let treasuryPubkey = walletPubkey;
  try {
    const { query: dbQuery } = require('./db/init');
    const vaultResult = await dbQuery('SELECT multisig_pda, treasury_authority_pda FROM multisig_config ORDER BY id DESC LIMIT 1');
    if (vaultResult.rows.length > 0 && vaultResult.rows[0].treasury_authority_pda) {
      new PublicKey(vaultResult.rows[0].treasury_authority_pda);
      treasuryPubkey = vaultResult.rows[0].treasury_authority_pda;
      console.log('Treasury Vault PDA (from Squads):', treasuryPubkey);
      deps._startupMultisigPda = vaultResult.rows[0].multisig_pda || null;
    } else {
      console.warn('No treasury config — falling back to wallet as treasury:', walletPubkey);
    }
  } catch (e) {
    console.warn('No treasury config — falling back to wallet as treasury:', walletPubkey);
  }

  const tokensService = new TokensService({
    connection,
    treasuryPubkey,
    tokensConfig: {},
  });
  let registryInfo = { count: 0, registryPda: 'not-initialized' };
  try {
    registryInfo = await tokensService.loadFromRegistry({
      tokenCoreProgramId: deps.programIds.tokenCore,
      registrySeed,
      populateNamesFromMetaplex: true,
    });
  } catch (e) {
    console.warn('Registry not found — starting with 0 tokens. Run setup-all.sh to initialize.');
    console.warn('  Detail:', e.message);
  }

  console.log('Tokens loaded from registry:', registryInfo.count);
  console.log('Registry PDA:', registryInfo.registryPda);

  try {
    const dbTokenInfo = await tokensService.loadFromDatabase();
    if (dbTokenInfo.count > 0) {
      console.log('Tokens loaded from database:', dbTokenInfo.count);
    }
  } catch (e) {
    console.warn('DB token load skipped:', e.message);
  }

  const liquidityService = new LiquidityService({
    connection,    
    tokensService,  
  });

  const swapService = new SwapService({
    connection,
    orca,
    tokensService,
  });

  const poolService = new PoolService({
    connection,
    tokensService,
  });

  const buildService = new BuildService({
    tokensService,
  });

  deps.tokensService = tokensService;
  deps.liquidityService = liquidityService; 
  deps.swapService = swapService;
  deps.poolService = poolService;
  deps.buildService = buildService;

  const dbReady = await initDatabase();
  console.log('[DB] Ready:', dbReady);

  const cacheService = new CacheService();
  const cacheReady = await cacheService.init();
  console.log('[Cache] Ready:', cacheReady);

  const tradeService = new TradeService({ cacheService });
  tradeService.startBackgroundJobs();
  const adminService = new AdminService({ cacheService });
  const overviewService = new OverviewService();
  const treasuryService = new TreasuryService({
    connection,
    cacheService,
    tokensService,
  });
  const publicDomain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || '';
  const apiBaseUrl = publicDomain ? `https://${publicDomain}` : '';
  const tokenCreationService = new TokenCreationService({
    connection,
    wallet,
    tokenCoreProgramId: deps.programIds.tokenCore?.toBase58(),
    apiBaseUrl,
  });

  const adminSetupService = new AdminSetupService({
    connection,
    wallet,
    tokenCreationService,
  });

  const squadsService = new SquadsService({ connection, wallet });
  treasuryService.squadsService = squadsService;

  const priceService = new PriceService({
    cacheService,
    minVolumeThreshold: Number(process.env.ORACLE_MIN_VOLUME || 1),
  });

  const referralDbService = new ReferralDbService();
  referralDbService.setDeps({ connection, wallet });

  const isSandbox = process.env.NOWPAYMENTS_SANDBOX === 'true';
  const nowPaymentsService = new NowPaymentsService({
    apiKey: isSandbox
      ? (process.env.NOWPAYMENTS_SANDBOX_API_KEY || '')
      : (process.env.NOWPAYMENTS_API_KEY || ''),
    ipnSecret: isSandbox
      ? (process.env.NOWPAYMENTS_SANDBOX_IPN_SECRET || '')
      : (process.env.NOWPAYMENTS_IPN_SECRET || ''),
    priceService,
  });

  deps.tradeService = tradeService;
  deps.adminService = adminService;
  deps.overviewService = overviewService;
  deps.cacheService = cacheService;
  deps.treasuryService = treasuryService;
  deps.tokenCreationService = tokenCreationService;
  deps.adminSetupService = adminSetupService;
  deps.squadsService = squadsService;
  deps.priceService = priceService;
  deps.referralDbService = referralDbService;
  deps.nowPaymentsService = nowPaymentsService;

  if (deps._startupMultisigPda) {
    try {
      squadsService.setMultisig(deps._startupMultisigPda);
      console.log('Squads multisig initialized from DB:', deps._startupMultisigPda);
      const vaultAddr = squadsService.getVaultAddress();
      if (vaultAddr) {
        treasuryService.setSquadsVault(vaultAddr.toBase58(), squadsService);
      }
    } catch (e) {
      console.warn('Failed to set startup multisig:', e.message);
    }
  }

  let _cachedAdminWallets = null;
  let _adminCacheTime = 0;
  async function getDbAdminWallets() {
    try {
      const s = require('./db/init').getSql();
      if (!s) return [];
      const rows = await s`SELECT wallet FROM admin_wallets`;
      return rows.map(r => r.wallet);
    } catch { return []; }
  }
  async function getAdminWallets() {
    const now = Date.now();
    if (_cachedAdminWallets && now - _adminCacheTime < 300_000) return _cachedAdminWallets;
    const dbAdmins = await getDbAdminWallets();
    const allOwners = new Set(dbAdmins);
    try {
      const state = await treasuryService.getMultisigState();
      if (state.initialized && state.members && state.members.length > 0) {
        state.members.forEach(m => allOwners.add(typeof m === 'string' ? m : m.key));
      }
    } catch {}
    try {
      const dbVault = await deps.adminSetupService.getVaultConfig();
      if (dbVault && dbVault.owners) {
        const owners = typeof dbVault.owners === 'string' ? JSON.parse(dbVault.owners) : dbVault.owners;
        if (Array.isArray(owners)) owners.forEach(o => allOwners.add(o));
      }
    } catch {}
    const fallback = process.env.FALLBACK_ADMIN_WALLET;
    if (fallback) allOwners.add(fallback);
    if (allOwners.size > 0) {
      _cachedAdminWallets = [...allOwners];
      _adminCacheTime = now;
      return _cachedAdminWallets;
    }
    return _cachedAdminWallets || [];
  }
  deps.getAdminWallets = getAdminWallets;
  getAdminWallets().catch(() => {});

  const sseClients = [];

  function broadcastSSE(payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (let i = sseClients.length - 1; i >= 0; i--) {
      try {
        sseClients[i].write(data);
      } catch {
        sseClients.splice(i, 1);
      }
    }
  }

  if (cacheService.enabled) {
    cacheService.subscribe('trades:all', (trade) => {
      broadcastSSE(trade);
    });

    cacheService.subscribe('fees:collected', (feeEvent) => {
      broadcastSSE({ ...feeEvent, eventType: 'fee_event' });
    });

    const updateChannels = ['treasury:update', 'tokens:update', 'pools:update', 'admin:update', 'balances:update', 'prices:update'];
    for (const ch of updateChannels) {
      cacheService.subscribe(ch, (evt) => { broadcastSSE(evt); });
    }
  }

  setInterval(() => {
    if (sseClients.length === 0) return;
    const heartbeat = `:heartbeat ${Date.now()}\n\n`;
    for (let i = sseClients.length - 1; i >= 0; i--) {
      try {
        sseClients[i].write(heartbeat);
      } catch {
        sseClients.splice(i, 1);
      }
    }
  }, 15000);

  const ENABLE_MONITOR = String(process.env.ENABLE_MONITOR || 'false').toLowerCase() === 'true';
  let monitorHandle = null;

  if (ENABLE_MONITOR) {
    const pollMs = Number(process.env.MONITOR_POLL_MS || 15000);
    const lookbackSlots = Number(process.env.MONITOR_LOOKBACK_SLOTS || 200);

    if (typeof orca.monitor.start === 'function') {
      monitorHandle = await orca.monitor.start({
        connection,
        pollMs,
        lookbackSlots,
        onSwap: async (swapEvent) => {
          try {
            if (swapEvent && swapEvent.signature) {
              const txDetail = await connection.getParsedTransaction(swapEvent.signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
              });
              if (txDetail?.meta) {
                const pre = txDetail.meta.preTokenBalances || [];
                const post = txDetail.meta.postTokenBalances || [];
                const tokens = tokensService.listTokens();
                const diffs = [];
                for (const postBal of post) {
                  const preBal = pre.find(p => p.accountIndex === postBal.accountIndex && p.mint === postBal.mint);
                  if (preBal) {
                    const diff = (parseFloat(postBal.uiTokenAmount?.uiAmountString || '0')) -
                      (parseFloat(preBal.uiTokenAmount?.uiAmountString || '0'));
                    if (Math.abs(diff) > 0) {
                      const token = tokens.find(t => t.mint.toBase58() === postBal.mint);
                      diffs.push({ mint: postBal.mint, symbol: token?.symbol || '', diff });
                    }
                  }
                }
                const inToken = diffs.find(d => d.diff < 0);
                const outToken = diffs.find(d => d.diff > 0);
                if (inToken && outToken && inToken.symbol && outToken.symbol) {
                  const amountIn = Math.abs(inToken.diff);
                  const amountOut = Math.abs(outToken.diff);
                  if (amountIn > 0 && amountOut > 0) {
                    const swapPrice = amountOut / amountIn;
                    await priceService.savePrice({
                      tokenSymbol: inToken.symbol,
                      tokenMint: inToken.mint,
                      pairSymbol: outToken.symbol,
                      pairMint: outToken.mint,
                      poolAddress: '',
                      price: swapPrice,
                      liquidity: '0',
                      source: 'swap',
                      volume: amountIn,
                    });
                  }
                }
              }
            }
          } catch (_) {}
        },
      });
      console.log('Monitor started');
    } else {
      console.warn('Monitor disabled: orca.monitor.start not found in api/orca/monitor.js');
    }
  } else {
    console.log('Monitor disabled by env (ENABLE_MONITOR=false)');
  }

  const state = {
    startedAt: new Date().toISOString(),
    rpc: RPC_URL,
    commitment: COMMITMENT,
    wallet: wallet.publicKey.toBase58(),
    monitor: !!monitorHandle,
    tokenCoreProgramId: deps.programIds.tokenCore?.toBase58() || null,
    registrySeed,
    registryPda: tokensService.getRegistryState()?.registryPda?.toBase58?.() || null,
  };

  const Fastify = require('fastify');
  const app = Fastify({
    logger: false,
    bodyLimit: 5 * 1024 * 1024,
    rewriteUrl: (req) => {
      if (req.url && req.url.startsWith('/api/')) {
        req._wasApiRoute = true;
        const rewritten = req.url.replace(/^\/api/, '');
        if (DEBUG_REQUESTS) console.log(`[REQ] ${req.method} ${req.url} → rewritten to ${rewritten} (apiRoute=true)`);
        return rewritten;
      }
      if (DEBUG_REQUESTS) console.log(`[REQ] ${req.method} ${req.url} → ${req.url} (apiRoute=false)`);
      return req.url;
    },
  });

  await app.register(require('@fastify/cors'), {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-wallet-address', 'x-token-symbol', 'Accept-Encoding'],
  });

  await app.register(require('@fastify/compress'), {
    threshold: 1024,
  });

  await app.register(require('@fastify/static'), {
    root: path.resolve(__dirname, 'uploads'),
    prefix: '/uploads/',
    decorateReply: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  });

  const frontendDist = path.resolve(__dirname, '..', 'frontend', 'dist');
  const isProduction = fs.existsSync(frontendDist);
  console.log(`[API] Production mode: ${isProduction} (frontendDist: ${frontendDist})`);
  console.log(`[API] DEBUG_REQUESTS: ${DEBUG_REQUESTS}`);
  if (isProduction) {
    await app.register(require('@fastify/static'), {
      root: frontendDist,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      },
    });
  }

  await app.register(require('@fastify/multipart'), {
    limits: {
      fileSize: 5 * 1024 * 1024,
    },
  });

  const metricsService = new MetricsService();
  deps.metricsService = metricsService;
  routeCache.setMetricsService(metricsService);

  app.addHook('onRequest', (request, reply, done) => {
    request._metricsStart = process.hrtime.bigint();
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    if (request._metricsStart) {
      const durationNs = Number(process.hrtime.bigint() - request._metricsStart);
      const durationMs = durationNs / 1e6;
      const route = request.routeOptions?.url || request.url.split('?')[0];
      metricsService.recordRequest(route, request.method, reply.statusCode, durationMs);
      if (DEBUG_REQUESTS) {
        const ct = reply.getHeader('content-type') || 'unknown';
        console.log(`[RES] ${request.method} ${request.url} → ${reply.statusCode} (${ct}) ${durationMs.toFixed(1)}ms`);
      }
    }
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;
    console.error(`[ERR] ${request.method} ${request.url} → ${statusCode}: ${error.message}`);
    console.error(error.stack);
    reply.status(statusCode).send({ ok: false, error: error.message });
  });

  // ---- CoinGecko proxy ----
  app.all('/coingecko/*', async (request, reply) => {
    const cgPath = request.url.replace(/^\/coingecko/, '').split('?')[0];
    const qs = request.url.includes('?') ? '?' + request.url.split('?')[1] : '';
    try {
      const cgRes = await fetch(`https://api.coingecko.com${cgPath}${qs}`, {
        headers: { 'Accept': 'application/json' },
      });
      reply.status(cgRes.status).header('Content-Type', cgRes.headers.get('content-type') || 'application/json');
      const body = await cgRes.text();
      return reply.send(body);
    } catch (e) {
      return reply.status(502).send({ ok: false, error: 'CoinGecko proxy error: ' + e.message });
    }
  });

  app.get('/ntc-balance', async (request, reply) => {
    try {
      const { wallet } = request.query;
      if (!wallet || !isValidSolanaPublicKey(wallet)) {
        return reply.status(400).send({ ok: false, error: 'Invalid wallet address' });
      }
      const ntcMintAddr = await getNtcMint();
      if (!ntcMintAddr) {
        return reply.send({ ok: true, balance: 0 });
      }
      const splToken = require('@solana/spl-token');
      const mintPk = new PublicKey(ntcMintAddr);
      const walletPk = new PublicKey(wallet);
      const mintAcct = await connection.getAccountInfo(mintPk);
      const tokenProgram = mintAcct && mintAcct.owner.toBase58() === splToken.TOKEN_2022_PROGRAM_ID.toBase58()
        ? splToken.TOKEN_2022_PROGRAM_ID
        : splToken.TOKEN_PROGRAM_ID;
      const ata = splToken.getAssociatedTokenAddressSync(mintPk, walletPk, false, tokenProgram);
      const ataInfo = await connection.getAccountInfo(ata);
      if (!ataInfo) {
        return reply.send({ ok: true, balance: 0 });
      }
      const tokenAccount = splToken.unpackAccount(ata, ataInfo, tokenProgram);
      return reply.send({ ok: true, balance: Number(tokenAccount.amount) });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  let _cachedNtcMint = null;
  const _mintCache = {};
  async function getTokenMint(symbol) {
    if (_mintCache[symbol]) return _mintCache[symbol];
    try {
      const { query: dbQ } = require('./db/init');
      const result = await dbQ('SELECT mint_address FROM tokens WHERE symbol = $1', [symbol]);
      if (result.rows.length > 0) {
        _mintCache[symbol] = result.rows[0].mint_address;
        return _mintCache[symbol];
      }
    } catch (e) {
      console.warn(`[API] Could not fetch ${symbol} mint from DB:`, e.message);
    }
    return null;
  }

  async function getNtcMint() {
    return getTokenMint('NTC');
  }

  async function sendTokenToUser(conn, serverWallet, recipientWalletStr, amount, tokenSymbol) {
    const splToken = require('@solana/spl-token');
    const { TransactionMessage, VersionedTransaction: VTx, ComputeBudgetProgram } = require('@solana/web3.js');

    const sym = tokenSymbol || 'NTC';
    const mintAddr = await getTokenMint(sym);
    if (!mintAddr) {
      console.warn(`[API] ${sym} mint not found in database — skipping token send`);
      return null;
    }
    const mintPk = new PublicKey(mintAddr);
    const recipientPk = new PublicKey(recipientWalletStr);

    const mintAcct = await conn.getAccountInfo(mintPk);
    if (!mintAcct) throw new Error(`${sym} mint account not found`);

    const tokenProgram = mintAcct.owner.toBase58() === splToken.TOKEN_2022_PROGRAM_ID.toBase58()
      ? splToken.TOKEN_2022_PROGRAM_ID
      : splToken.TOKEN_PROGRAM_ID;

    const mintInfo = splToken.MintLayout.decode(mintAcct.data);
    const decimals = mintInfo.decimals;
    const rawAmount = BigInt(Math.round(amount * Math.pow(10, decimals)));

    const serverAta = splToken.getAssociatedTokenAddressSync(mintPk, serverWallet.publicKey, false, tokenProgram);
    const recipientAta = splToken.getAssociatedTokenAddressSync(mintPk, recipientPk, false, tokenProgram);

    const serverAtaInfo = await conn.getAccountInfo(serverAta);
    if (!serverAtaInfo) throw new Error(`Server wallet ATA not found — server may not hold ${sym} tokens`);

    const serverAtaParsed = await conn.getParsedAccountInfo(serverAta);
    const serverBalance = serverAtaParsed?.value?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    if (serverBalance < amount) {
      throw new Error(`Server wallet has insufficient ${sym} balance: ${serverBalance} available, ${amount} required`);
    }

    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ];

    const recipientAtaInfo = await conn.getAccountInfo(recipientAta);
    if (!recipientAtaInfo) {
      instructions.push(
        splToken.createAssociatedTokenAccountIdempotentInstruction(
          serverWallet.publicKey, recipientAta, recipientPk, mintPk, tokenProgram
        )
      );
    }

    instructions.push(
      splToken.createTransferCheckedInstruction(
        serverAta, mintPk, recipientAta, serverWallet.publicKey, rawAmount, decimals, [], tokenProgram
      )
    );

    const MAX_RETRIES = 3;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
        const messageV0 = new TransactionMessage({
          payerKey: serverWallet.publicKey,
          recentBlockhash: blockhash,
          instructions,
        }).compileToV0Message();

        const tx = new VTx(messageV0);
        tx.sign([serverWallet]);

        const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        const POLL_INTERVAL = 2000;
        const MAX_POLLS = 30;
        for (let p = 0; p < MAX_POLLS; p++) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL));
          const { value } = await conn.getSignatureStatuses([sig]);
          const st = value && value[0];
          if (st && st.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
          if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
            return sig;
          }
          const currentHeight = await conn.getBlockHeight('confirmed');
          if (currentHeight > lastValidBlockHeight) {
            throw new Error('Transaction expired: block height exceeded');
          }
        }
        throw new Error('Transaction confirmation timeout after polling');
      } catch (err) {
        lastError = err;
        console.warn(`[API] sendTokenToUser attempt ${attempt} failed:`, err.message);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }
    }
    throw lastError;
  }

  async function sendNtcToUser(conn, serverWallet, recipientWalletStr, ntcAmount) {
    return sendTokenToUser(conn, serverWallet, recipientWalletStr, ntcAmount, 'NTC');
  }

  // ---- GET /health ----
  app.get('/health', async (request, reply) => {
    return reply.send({ ok: true, uptime: process.uptime() });
  });

  // ---- POST /track/wallet ----
  app.post('/track/wallet', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.wallet || '';
      if (!walletAddr || walletAddr.length < 32) return reply.status(400).send({ ok: false, error: 'Invalid wallet' });
      await deps.overviewService.registerWallet(walletAddr);
      return reply.send({ ok: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /track/visit ----
  app.post('/track/visit', async (request, reply) => {
    try {
      const body = request.body || {};
      await deps.overviewService.recordVisit({
        sessionId: body.sessionId || '',
        wallet: body.wallet || '',
        page: body.page || '/',
        source: body.source || 'direct',
      });
      return reply.send({ ok: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /support/contact ----
  app.post('/support/contact', async (request, reply) => {
    try {
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const body = request.body || {};
      if (!body.name || !body.email || !body.message) {
        return reply.status(400).send({ ok: false, error: 'name, email, and message are required' });
      }
      const [row] = await s`INSERT INTO support_messages (name, email, subject, message) VALUES (${body.name}, ${body.email}, ${body.subject || ''}, ${body.message}) RETURNING *`;
      return reply.send({ ok: true, message: row });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/support-messages ----
  app.get('/admin/support-messages', async (request, reply) => {
    try {
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const walletAddr = request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS = await getAdminWallets();
      if (ADMIN_WALLETS.length > 0 && !ADMIN_WALLETS.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const rows = await s`SELECT * FROM support_messages ORDER BY created_at DESC`;
      return reply.send({ ok: true, messages: rows });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- PUT /admin/support-messages/:id/status ----
  app.put('/admin/support-messages/:id/status', async (request, reply) => {
    try {
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const walletAddr = request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS = await getAdminWallets();
      if (ADMIN_WALLETS.length > 0 && !ADMIN_WALLETS.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const body = request.body || {};
      if (!body.status || !['new', 'reviewed', 'resolved'].includes(body.status)) {
        return reply.status(400).send({ ok: false, error: 'Valid status required (new, reviewed, resolved)' });
      }
      const [row] = await s`UPDATE support_messages SET status = ${body.status}, updated_at = NOW() WHERE id = ${request.params.id} RETURNING *`;
      if (!row) return reply.status(404).send({ ok: false, error: 'Message not found' });
      return reply.send({ ok: true, message: row });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- DELETE /admin/support-messages/:id ----
  app.delete('/admin/support-messages/:id', async (request, reply) => {
    try {
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const walletAddr = request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS = await getAdminWallets();
      if (ADMIN_WALLETS.length > 0 && !ADMIN_WALLETS.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const result = await s`DELETE FROM support_messages WHERE id = ${request.params.id}`;
      if (result.count === 0) return reply.status(404).send({ ok: false, error: 'Message not found' });
      return reply.send({ ok: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/wallets ----
  app.get('/admin/wallets', async (request, reply) => {
    try {
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const walletAddr = request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS = await getAdminWallets();
      if (ADMIN_WALLETS.length > 0 && !ADMIN_WALLETS.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const rows = await s`SELECT wallet, role, added_by, created_at FROM admin_wallets ORDER BY created_at ASC`;
      return reply.send({ ok: true, wallets: rows });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  async function isOwnerOrSuperAdmin(walletAddr) {
    if (!walletAddr) return false;
    try {
      const state = await treasuryService.getMultisigState();
      if (state.initialized && state.members && state.members.length > 0) {
        const onChainOwners = state.members.map(m => typeof m === 'string' ? m : m.key);
        if (onChainOwners.includes(walletAddr)) return true;
      }
    } catch {}
    try {
      const dbVault = await deps.adminSetupService.getVaultConfig();
      if (dbVault && dbVault.owners) {
        const owners = typeof dbVault.owners === 'string' ? JSON.parse(dbVault.owners) : dbVault.owners;
        if (Array.isArray(owners) && owners.includes(walletAddr)) return true;
      }
    } catch {}
    try {
      const s = require('./db/init').getSql();
      if (s) {
        const rows = await s`SELECT role FROM admin_wallets WHERE wallet = ${walletAddr} LIMIT 1`;
        if (rows.length > 0 && rows[0].role === 'super_admin') return true;
      }
    } catch {}
    return false;
  }

  // ---- POST /admin/wallets ----
  app.post('/admin/wallets', async (request, reply) => {
    try {
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const walletAddr = request.headers['x-wallet-address'] || '';
      if (!(await isOwnerOrSuperAdmin(walletAddr))) {
        return reply.status(403).send({ ok: false, error: 'Owner or super admin required' });
      }
      const body = request.body || {};
      const { wallet, role } = body;
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet is required' });
      const validRoles = ['admin', 'super_admin'];
      const resolvedRole = validRoles.includes(role) ? role : 'admin';
      if (resolvedRole === 'super_admin') {
        const isOwner = await (async () => {
          try {
            const state = await treasuryService.getMultisigState();
            if (state.initialized && state.members && state.members.length > 0) {
              const onChainOwners = state.members.map(m => typeof m === 'string' ? m : m.key);
              if (onChainOwners.includes(walletAddr)) return true;
            }
          } catch {}
          try {
            const dbVault = await deps.adminSetupService.getVaultConfig();
            if (dbVault && dbVault.owners) {
              const owners = typeof dbVault.owners === 'string' ? JSON.parse(dbVault.owners) : dbVault.owners;
              if (Array.isArray(owners) && owners.includes(walletAddr)) return true;
            }
          } catch {}
          return false;
        })();
        if (!isOwner) {
          return reply.status(403).send({ ok: false, error: 'Only owners can assign the super_admin role' });
        }
      }
      const [row] = await s`
        INSERT INTO admin_wallets (wallet, role, added_by)
        VALUES (${wallet}, ${resolvedRole}, ${walletAddr})
        ON CONFLICT (wallet) DO UPDATE SET role = ${resolvedRole}, added_by = ${walletAddr}
        RETURNING wallet, role, added_by, created_at
      `;
      _cachedAdminWallets = null;
      return reply.send({ ok: true, wallet: row });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- DELETE /admin/wallets/:wallet ----
  app.delete('/admin/wallets/:wallet', async (request, reply) => {
    try {
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const walletAddr = request.headers['x-wallet-address'] || '';
      if (!(await isOwnerOrSuperAdmin(walletAddr))) {
        return reply.status(403).send({ ok: false, error: 'Owner or super admin required' });
      }
      const targetWallet = request.params.wallet;
      const callerRows = await s`SELECT role FROM admin_wallets WHERE wallet = ${walletAddr} LIMIT 1`;
      const callerRole = callerRows.length > 0 ? callerRows[0].role : null;
      if (callerRole === 'super_admin') {
        const targetRows = await s`SELECT role FROM admin_wallets WHERE wallet = ${targetWallet} LIMIT 1`;
        const targetRole = targetRows.length > 0 ? targetRows[0].role : null;
        if (targetRole !== 'admin') {
          return reply.status(403).send({ ok: false, error: 'Super admins can only remove regular admins' });
        }
      }
      await s`DELETE FROM admin_wallets WHERE wallet = ${targetWallet}`;
      _cachedAdminWallets = null;
      return reply.send({ ok: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /tokens ----
  app.get('/tokens', async (request, reply) => {
    const walletResult = optionalWallet(request.raw, request.query, treasuryPubkey);
    if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);

    const cacheKey = `tokens:${walletResult.walletAddress}`;
    const cached = routeCache.get(cacheKey);
    if (cached) return reply.send(cached);

    const tokens = tokensService.listTokens().map((t) => ({
      key: t.key,
      mint: t.mint.toBase58(),
      decimals: t.decimals,
      symbol: t.symbol,
      name: t.name,
      uri: t.uri,
      treasuryAta: tokensService.getTreasuryAta(t.key).toBase58(),
    }));

    const result = { ok: true, source: 'registry', owner: walletResult.walletAddress, tokens };
    routeCache.set(cacheKey, result, 30000);
    return reply.send(result);
  });

  // ---- GET /tokens/refresh ----
  app.get('/tokens/refresh', async (request, reply) => {
    const walletResult = optionalWallet(request.raw, request.query, treasuryPubkey);
    if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);

    const info = await tokensService.refreshFromChain({
      tokenCoreProgramId: deps.programIds.tokenCore,
      registrySeed,
      populateNamesFromMetaplex: true,
    });
    return reply.send({ ok: true, refreshed: true, owner: walletResult.walletAddress, info });
  });

  // ---- POST /tokens/create/build (multipart file upload) ----
  app.post('/tokens/create/build', async (request, reply) => {
    try {
      const UPLOADS_DIR = path.resolve(__dirname, 'uploads', 'tokens');
      if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

      const parts = request.parts();
      let fileData = null;
      let fileMimetype = '';
      let fileOriginalName = '';
      const fields = {};

      for await (const part of parts) {
        if (part.file) {
          fileMimetype = part.mimetype || '';
          fileOriginalName = part.filename || '';
          if (!fileMimetype.startsWith('image/')) {
            return reply.status(400).send({ ok: false, error: 'Only image files are allowed' });
          }
          fileData = await part.toBuffer();
        } else {
          fields[part.fieldname] = part.value;
        }
      }

      const body = fields;
      const walletAddr = body.userPubkey || '';
      const ADMIN_WALLETS = await getAdminWallets();
      if (!isValidSolanaPublicKey(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Valid wallet address required' });
      }
      if (ADMIN_WALLETS.length > 0 && !ADMIN_WALLETS.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.name || !body.symbol) {
        return reply.status(400).send({ ok: false, error: 'name and symbol are required' });
      }

      const symbolUpper = (body.symbol || '').toUpperCase();
      const supplyVal = parseInt(body.supply) || 5000000000000;
      const decimalsVal = Number.isFinite(parseInt(body.decimals)) ? parseInt(body.decimals) : 5;

      let savedFilePath = null;
      if (fileData) {
        const ext = path.extname(fileOriginalName).toLowerCase() || '.png';
        const symbol = (request.headers['x-token-symbol'] || body.symbol || 'TOKEN').toUpperCase().replace(/[^A-Z0-9]/g, '');
        savedFilePath = path.join(UPLOADS_DIR, `${symbol}${ext}`);
        fs.writeFileSync(savedFilePath, fileData);
      }

      let logoIrysUrl = '';
      console.log(`[POST /tokens/create/build] symbol=${symbolUpper}, fileUploaded=${!!fileData}, savedFilePath=${savedFilePath}`);
      if (savedFilePath) {
        console.log(`[POST /tokens/create/build] Uploading user logo to Irys: ${savedFilePath}`);
        logoIrysUrl = await deps.tokenCreationService.uploadLogoToIrys(savedFilePath, symbolUpper);
        console.log(`[POST /tokens/create/build] Logo on Irys: ${logoIrysUrl}`);
      } else {
        const predefinedLogoPath = path.resolve(__dirname, '../contract/logos', `${symbolUpper}.png`);
        console.log(`[POST /tokens/create/build] Checking predefined logo: ${predefinedLogoPath} exists=${fs.existsSync(predefinedLogoPath)}`);
        if (fs.existsSync(predefinedLogoPath)) {
          console.log(`[POST /tokens/create/build] Using predefined logo: ${predefinedLogoPath}`);
          logoIrysUrl = await deps.tokenCreationService.uploadLogoToIrys(predefinedLogoPath, symbolUpper);
          console.log(`[POST /tokens/create/build] Logo on Irys: ${logoIrysUrl}`);
        } else {
          console.log(`[POST /tokens/create/build] No logo found for ${symbolUpper} — metadata will have empty image`);
        }
      }

      let vaultConfig = null;
      try {
        vaultConfig = await deps.adminSetupService.getVaultConfig();
      } catch (_) {}

      let treasuryVaultPda = null;
      if (vaultConfig?.treasury_authority_pda) {
        treasuryVaultPda = vaultConfig.treasury_authority_pda;
      }

      const result = await deps.tokenCreationService.buildCreateTokenTransaction({
        userPubkey: walletAddr,
        name: body.name,
        symbol: symbolUpper,
        supply: supplyVal,
        decimals: decimalsVal,
        logoIrysUrl,
        treasuryVaultPda,
      });
      return reply.send(jsonSafe(result));
    } catch (e) {
      console.error('[POST /tokens/create/build]', e);
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /tokens/update-metadata/build ----
  app.post('/tokens/update-metadata/build', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || '';
      if (!isValidSolanaPublicKey(walletAddr)) {
        return reply.status(400).send({ ok: false, error: 'Valid userPubkey required' });
      }
      const ADMIN_WALLETS_UM = await getAdminWallets();
      if (ADMIN_WALLETS_UM.length > 0 && !ADMIN_WALLETS_UM.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.mintAddress || !body.symbol || !body.name) {
        return reply.status(400).send({ ok: false, error: 'mintAddress, symbol, and name required' });
      }
      let logoFilePath = body.logoFilePath;
      if (!logoFilePath) {
        const predefinedPath = path.resolve(__dirname, '../contract/logos', `${body.symbol.toUpperCase()}.png`);
        if (fs.existsSync(predefinedPath)) {
          logoFilePath = predefinedPath;
        }
      }
      if (!logoFilePath) {
        return reply.status(400).send({ ok: false, error: `No logo file found for ${body.symbol}` });
      }
      const result = await deps.tokenCreationService.buildUpdateMetadataTransaction({
        userPubkey: walletAddr,
        mintAddress: body.mintAddress,
        name: body.name,
        symbol: body.symbol,
        logoFilePath,
      });
      return reply.send(jsonSafe(result));
    } catch (e) {
      console.error('[POST /tokens/update-metadata/build]', e);
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /tokens/register ----
  app.post('/tokens/register', async (request, reply) => {
    try {
      const body = request.body || {};
      if (!body.mint || !isValidSolanaPublicKey(body.mint)) {
        return reply.status(400).send({ ok: false, error: 'Valid mint address required' });
      }
      const regResult = await deps.tokenCreationService.registerMintInRegistry(body.mint);
      await tokensService.refreshFromChain({
        tokenCoreProgramId: deps.programIds.tokenCore,
        registrySeed,
        populateNamesFromMetaplex: true,
      });
      return reply.send({ ok: true, ...regResult });
    } catch (e) {
      console.error('[POST /tokens/register]', e);
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /pools ----
  app.get('/pools', async (request, reply) => {
    const walletResult = optionalWallet(request.raw, request.query, treasuryPubkey);
    if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);

    const tokenA = request.query.tokenA;
    const tokenB = request.query.tokenB;

    if (!tokenA || !tokenB) {
      return reply.status(400).send({ 
        ok: false, 
        error: 'Query parameters tokenA and tokenB are required (symbol or mint).' 
      });
    }

    const poolAddress = request.query.poolAddress || null;
    const poolCacheKey = poolAddress
      ? `pools:${[tokenA,tokenB].sort().join(':')}:${poolAddress}`
      : `pools:${[tokenA,tokenB].sort().join(':')}`;

    try {
      const out = await routeCache.coalesce(poolCacheKey, 30000, async () => {
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await deps.poolService.getPool({ tokenA, tokenB, poolAddress });
          } catch (e) {
            lastErr = e;
            if (e.message && e.message.includes('429') && attempt < 2) {
              await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
              continue;
            }
            throw e;
          }
        }
        throw lastErr;
      });
      return reply.send({ ...out, owner: walletResult.walletAddress });
    } catch (e) {
      if (e.message && e.message.includes('429')) {
        return reply.status(429).send({ ok: false, error: 'RPC rate limit — please try again shortly' });
      }
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /pools ----
  app.post('/pools', async (request, reply) => {
    try {
      const payload = request.body || {};
      const tokenX = payload.tokenX;
      const tokenY = payload.tokenY;
      if (!tokenX || !tokenY) {
        return reply.status(400).send({ ok: false, error: 'tokenX and tokenY are required' });
      }
      const out = await deps.poolService.createPool({
        tokenX,
        tokenY,
        tickSpacing: payload.tickSpacing,
        priceXUsd: payload.priceXUsd ?? 1,
        priceYUsd: payload.priceYUsd ?? 1,
      });
      return reply.status(out.ok ? 200 : 400).send(out);
    } catch (e) {
      const statusCode = e.statusCode || 400;
      return reply.status(statusCode).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/pools ----
  app.get('/admin/pools', async (request, reply) => {
    try {
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const rows = await s`SELECT * FROM pools ORDER BY created_at ASC`;
      return reply.send({ ok: true, pools: rows });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/pools ----
  app.post('/admin/pools', async (request, reply) => {
    try {
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const p = request.body || {};
      if (!p.token_a_symbol || !p.token_b_symbol || !p.pool_address) {
        return reply.status(400).send({ ok: false, error: 'token_a_symbol, token_b_symbol, and pool_address are required' });
      }
      if (!isValidSolanaPublicKey(p.pool_address)) {
        return reply.status(400).send({ ok: false, error: 'Invalid pool_address format' });
      }
      const VALID_FEES = [0.25, 0.30, 0.50, 1.00];
      const feeTier = VALID_FEES.includes(p.fee_tier) ? p.fee_tier : 0.30;
      const VALID_TICKS = [8, 64, 128, 256];
      const tickSpacing = VALID_TICKS.includes(p.tick_spacing) ? p.tick_spacing : 64;
      const existing = await s`SELECT id FROM pools WHERE pool_address = ${p.pool_address}`;
      if (existing.length > 0) {
        return reply.send({ ok: true, pool: existing[0], existed: true });
      }
      const [row] = await s`INSERT INTO pools (token_a_symbol, token_b_symbol, token_a_mint, token_b_mint, pool_address, tick_spacing, fee_tier, tx_signature) VALUES (${p.token_a_symbol.toUpperCase()}, ${p.token_b_symbol.toUpperCase()}, ${p.token_a_mint || ''}, ${p.token_b_mint || ''}, ${p.pool_address}, ${tickSpacing}, ${feeTier}, ${p.tx_signature || ''}) RETURNING *`;
      cacheService.publishPoolsUpdate('pool_created');
      cacheService.publishPricesUpdate('pool_created');
      return reply.status(201).send({ ok: true, pool: row });
    } catch (e) {
      const statusCode = e.statusCode || 400;
      return reply.status(statusCode).send({ ok: false, error: e.message });
    }
  });

  // ---- DELETE /admin/pools/:id ----
  app.delete('/admin/pools/:id', async (request, reply) => {
    try {
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const poolId = parseInt(request.params.id, 10);
      if (isNaN(poolId) || poolId <= 0) return reply.status(400).send({ ok: false, error: 'Invalid pool id' });
      const deleted = await s`DELETE FROM pools WHERE id = ${poolId} RETURNING id`;
      if (deleted.length === 0) return reply.status(404).send({ ok: false, error: 'Pool not found' });
      cacheService.publishPoolsUpdate('pool_deleted');
      return reply.send({ ok: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /liquidity ----
  app.post('/liquidity', async (request, reply) => {
    try {
      const payload = request.body || {};

      if (!payload.poolAddress) {
        return reply.status(400).send({ ok: false, error: 'poolAddress is required' });
      }
      if (!payload.tokenX || !payload.tokenY) {
        return reply.status(400).send({ ok: false, error: 'tokenX and tokenY are required' });
      }

      const out = await deps.liquidityService.addLiquidity({
        poolAddress: payload.poolAddress,
        tokenX: payload.tokenX,
        tokenY: payload.tokenY,
        amountXUi: payload.amountXUi,
        amountYUi: payload.amountYUi,
        decimalsX: payload.decimalsX,
        decimalsY: payload.decimalsY,
        tokenMaxX: payload.tokenMaxX,
        tokenMaxY: payload.tokenMaxY,
        slippageBps: payload.slippageBps ?? 50,
        withTokenMetadataExtension: payload.withTokenMetadataExtension ?? false,
        lockPosition: payload.lockPosition ?? true,
        useTokenY: payload.useTokenY ?? true,
      });

      cacheService.publishPoolsUpdate('liquidity_added');
      cacheService.publishBalancesUpdate('liquidity_added');
      cacheService.publishPricesUpdate('liquidity_added');
      return reply.send(jsonSafe(out));
    } catch (e) {
      console.error("API Error:", e); 
      const errMsg = e?.message || e?.toString() || "Unknown error";
      const logs = e?.logs ? { logs: e.logs } : {};
      const statusCode = e.statusCode || 400;
      return reply.status(statusCode).send({ ok: false, error: errMsg, ...logs });
    }
  });

  // ---- GET /balances/treasury ----
  app.get('/balances/treasury', async (request, reply) => {
    const walletResult = optionalWallet(request.raw, request.query, treasuryPubkey);
    if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);

    const targetOwner = walletResult.walletAddress;
    const treasuryCacheKey = `treasury:${targetOwner}`;
    const result = await routeCache.coalesce(treasuryCacheKey, 30000, async () => {
      const balances = await tokensService.getOwnerBalances(targetOwner);
      return { ok: true, treasury: treasuryPubkey, owner: targetOwner, balances };
    });
    return reply.send(result);
  });

  // ---- GET /balances/owner ----
  app.get('/balances/owner', async (request, reply) => {
    const walletResult = requireWallet(request.raw, request.query);
    if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);

    const balances = await tokensService.getOwnerBalances(walletResult.walletAddress);
    return reply.send({ ok: true, owner: walletResult.walletAddress, balances });
  });

  // ---- GET /quote ----
  app.get('/quote', async (request, reply) => {
    const walletResult = optionalWallet(request.raw, request.query, treasuryPubkey);
    if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);

    const mintIn = request.query.mintIn;
    const mintOut = request.query.mintOut;
    const amountIn = request.query.amountIn;
    const slippageBps = request.query.slippageBps || '50';

    if (!mintIn || !mintOut || !amountIn) {
      return reply.status(400).send({
        ok: false,
        error: 'Missing query params: mintIn, mintOut, amountIn',
      });
    }

    try {
      const quote = await swapService.getQuote({
        mintOut: new PublicKey(mintOut),
        mintIn: new PublicKey(mintIn),
        amountIn: BigInt(amountIn),
        slippageBps,
      });
      const quoteData = jsonSafe({ ok: true, quote });
      return reply.send({ ...quoteData, owner: walletResult.walletAddress });
    } catch (e) {
      if (e.message && e.message.includes('429')) {
        return reply.status(429).send({ ok: false, error: 'RPC rate limit — please try again shortly' });
      }
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /swap ----
  app.post('/swap', async (request, reply) => {
    try {
      const payload = request.body || {};

      const swapWallet = payload.userPubkey || '';
      const swapAmountIn = parseFloat(payload.amountIn) || 0;
      if (swapWallet && swapAmountIn > 0) {
        const usage = await deps.tradeService.getWalletSwapUsage(swapWallet);
        const humanAmount = swapAmountIn / 1e5;
        const swapLimitConfig = await deps.tradeService.getSwapLimits();
        const limits = deps.tradeService.checkSwapLimits(usage, humanAmount, swapLimitConfig);
        if (!limits.allowed) {
          const which = limits.reason === 'daily' ? 'Daily' : 'Monthly';
          const cap = limits.reason === 'daily' ? limits.daily.limit : limits.monthly.limit;
          const remaining = limits.reason === 'daily' ? limits.daily.remaining : limits.monthly.remaining;
          return reply.status(429).send({
            ok: false,
            error: `${which} swap limit exceeded. Limit: ${cap} tokens, remaining: ${remaining.toFixed(2)} tokens.`,
            limitExceeded: true,
            daily: limits.daily,
            monthly: limits.monthly,
          });
        }
      }

      const result = await swapService.swapExactIn(payload);
      let referralBonus = null;

      if (result && result.signature) {
        try {
          await deps.tradeService.recordTrade({
            eventType: 'swap',
            tokenA: payload.tokenA || payload.mintIn || '',
            tokenB: payload.tokenB || payload.mintOut || '',
            tokenAMint: payload.mintIn || '',
            tokenBMint: payload.mintOut || '',
            amountIn: parseFloat(payload.amountIn) || 0,
            amountOut: parseFloat(result.amountOut || result.tokenEstOutNet) || 0,
            price: parseFloat(result.price) || 0,
            poolAddress: result.pool || '',
            txSignature: result.signature,
            wallet: payload.userPubkey || wallet.publicKey.toBase58(),
          });
        } catch (tradeErr) {
          console.error('[Trade] Record after /swap failed:', tradeErr.message);
        }

        const swapUserWallet = payload.userPubkey || '';
        if (swapUserWallet && deps.referralDbService) {
          try {
            const referralResult = await deps.referralDbService.onSwapComplete(swapUserWallet);
            if (referralResult) {
              console.log(`[Referral] First swap by ${swapUserWallet.slice(0,8)}... via /swap — referrer paid=${referralResult.referrerPaid}, referee paid=${referralResult.refereePaid}`);
              if (referralResult.errors?.length) {
                referralResult.errors.forEach(e => console.error(`[Referral] ${e}`));
              }
              referralBonus = {
                refereeReward: referralResult.refereeReward,
                referrerReward: referralResult.referrerReward,
                refereePaid: referralResult.refereePaid,
                referrerPaid: referralResult.referrerPaid,
                refereeTx: referralResult.refereeTx,
                referrerTx: referralResult.referrerTx,
              };
            }
          } catch (refErr) {
            console.error('[Referral] onSwapComplete failed in /swap:', refErr.message);
          }
        }

        routeCache.deleteByPrefix('pools:');
        routeCache.deleteByPrefix('treasury:');
        routeCache.deleteByPrefix('quote:');
        deps.poolService.clearPoolCache();
      }

      return reply.send({ ok: true, result, ...(referralBonus ? { referralBonus } : {}) });
    } catch (e) {
      const statusCode = e.statusCode || 400;
      return reply.status(statusCode).send({ ok: false, error: e.message });
    }
  });

  app.post('/buy/build', async (request, reply) => {
    try {
      const { recipientPubkey, tokenMint, moonpayTxId, updateToken } = request.body || {};
      if (!recipientPubkey || !tokenMint || !moonpayTxId || !updateToken) {
        return reply.status(400).send({ ok: false, error: 'recipientPubkey, tokenMint, moonpayTxId, and updateToken are required' });
      }

      const s = require('./db/init').getSql();
      const [record] = await s`SELECT id, user_wallet, type, status, moonpay_status, moonpay_transaction_id, tx_signature, amount_fiat, amount_crypto, crypto_currency, token_price FROM moonpay_transactions WHERE id = ${moonpayTxId} AND update_token = ${updateToken}`;
      if (!record) {
        return reply.status(403).send({ ok: false, error: 'Invalid transaction record' });
      }
      if (record.type !== 'buy') {
        return reply.status(403).send({ ok: false, error: 'Transaction is not a buy order' });
      }
      if (record.user_wallet !== recipientPubkey) {
        return reply.status(403).send({ ok: false, error: 'Wallet mismatch' });
      }
      if (record.tx_signature) {
        return reply.status(409).send({ ok: false, error: 'Transfer already completed for this transaction' });
      }
      if (record.status === 'processing') {
        return reply.status(409).send({ ok: false, error: 'Transfer is already being processed' });
      }
      const validMoonpayStatuses = ['completed', 'waitingAuthorization'];
      if (!validMoonpayStatuses.includes(record.moonpay_status)) {
        return reply.status(403).send({ ok: false, error: `Payment not verified (status: ${record.moonpay_status || 'unknown'})` });
      }
      if (!record.moonpay_transaction_id) {
        return reply.status(403).send({ ok: false, error: 'No MoonPay transaction ID — payment not processed' });
      }

      const recordSymbol = (record.crypto_currency || '').toUpperCase();
      const registeredTokens = deps.tokensService ? await deps.tokensService.getTokens() : [];
      const matchedToken = registeredTokens.find(t => t.symbol?.toUpperCase() === recordSymbol);
      if (!matchedToken || !matchedToken.mint) {
        return reply.status(400).send({ ok: false, error: `Token "${recordSymbol}" not found in registry` });
      }
      if (tokenMint !== matchedToken.mint) {
        return reply.status(403).send({ ok: false, error: 'Token mint does not match purchased asset' });
      }

      const [locked] = await s`UPDATE moonpay_transactions SET status = 'processing', updated_at = NOW() WHERE id = ${moonpayTxId} AND tx_signature IS NULL AND status != 'processing' RETURNING id`;
      if (!locked) {
        return reply.status(409).send({ ok: false, error: 'Transfer already in progress or completed' });
      }

      let tokenAmount;
      const tokenSymbol = recordSymbol;
      const priceRow = await deps.priceService.getLatestPrice(tokenSymbol);
      const poolPrice = priceRow?.price || parseFloat(record.token_price) || 0;

      if (poolPrice > 0 && parseFloat(record.amount_fiat) > 0) {
        tokenAmount = parseFloat(record.amount_fiat) / poolPrice;
      } else if (parseFloat(record.amount_crypto) > 0) {
        tokenAmount = parseFloat(record.amount_crypto);
      } else {
        return reply.status(400).send({ ok: false, error: 'Cannot determine token amount: no price data or fiat amount' });
      }

      if (tokenAmount <= 0) {
        return reply.status(400).send({ ok: false, error: 'Computed token amount is zero' });
      }

      const splToken = require('@solana/spl-token');
      const { TransactionMessage, VersionedTransaction: VTx, ComputeBudgetProgram } = require('@solana/web3.js');

      const recipientPk = new PublicKey(recipientPubkey);
      const mintPk = new PublicKey(tokenMint);

      const mintAcct = await connection.getAccountInfo(mintPk);
      if (!mintAcct) return reply.status(400).send({ ok: false, error: 'Invalid token mint' });
      const tokenProgram = mintAcct.owner.toBase58() === splToken.TOKEN_2022_PROGRAM_ID.toBase58()
        ? splToken.TOKEN_2022_PROGRAM_ID
        : splToken.TOKEN_PROGRAM_ID;

      const mintInfo = splToken.MintLayout.decode(mintAcct.data);
      const tokenDecimals = mintInfo.decimals;
      const rawAmount = BigInt(Math.round(tokenAmount * Math.pow(10, tokenDecimals)));

      const serverAta = splToken.getAssociatedTokenAddressSync(mintPk, wallet.publicKey, false, tokenProgram);
      const recipientAta = splToken.getAssociatedTokenAddressSync(mintPk, recipientPk, false, tokenProgram);

      const instructions = [];
      instructions.push(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      );

      const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
      if (!recipientAtaInfo) {
        instructions.push(
          splToken.createAssociatedTokenAccountIdempotentInstruction(
            recipientPk, recipientAta, recipientPk, mintPk, tokenProgram
          )
        );
      }

      instructions.push(
        splToken.createTransferCheckedInstruction(
          serverAta, mintPk, recipientAta, wallet.publicKey, rawAmount, tokenDecimals, [], tokenProgram
        )
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const messageV0 = new TransactionMessage({
        payerKey: recipientPk,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();
      const tx = new VTx(messageV0);

      tx.sign([wallet]);

      const base64 = Buffer.from(tx.serialize()).toString('base64');

      console.log(`[Buy] Built transfer: ${tokenAmount.toFixed(5)} tokens to ${recipientPubkey} (fiat=$${record.amount_fiat}, price=${poolPrice}, moonpayTx=${moonpayTxId})`);

      return reply.send({
        ok: true,
        transaction: base64,
        blockhash,
        lastValidBlockHeight,
        summary: {
          type: 'buyTransfer',
          tokenMint,
          tokenAmount,
          fiatAmount: parseFloat(record.amount_fiat) || 0,
          poolPrice,
          serverWallet: wallet.publicKey.toBase58(),
        },
      });
    } catch (e) {
      console.error('[Buy] build error:', e.message);
      const statusCode = e.statusCode || 400;
      return reply.status(statusCode).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /pools/build ----
  app.post('/pools/build', async (request, reply) => {
    try {
      const payload = request.body || {};
      if (!payload.userPubkey) return reply.status(400).send({ ok: false, error: 'userPubkey is required' });
      const result = await deps.buildService.buildPool(payload);
      return reply.send(result);
    } catch (e) {
      const friendly = decodeSolanaError(e.message) || e.message;
      const statusCode = e.statusCode || 400;
      return reply.status(statusCode).send({ ok: false, error: friendly });
    }
  });

  // ---- POST /liquidity/build ----
  app.post('/liquidity/build', async (request, reply) => {
    try {
      const payload = request.body || {};
      if (!payload.userPubkey) return reply.status(400).send({ ok: false, error: 'userPubkey is required' });
      const result = await deps.buildService.buildLiquidity(payload);
      return reply.send(result);
    } catch (e) {
      const statusCode = e.statusCode || 400;
      const friendly = e.code === 'INSUFFICIENT_BALANCE'
        ? e.message
        : (decodeSolanaError(e.message) || e.message);
      const resp = { ok: false, error: friendly };
      if (e.code === 'INSUFFICIENT_BALANCE' && e.balances) resp.balances = e.balances;
      return reply.status(statusCode).send(resp);
    }
  });

  // ---- GET /liquidity/balances ----
  app.get('/liquidity/balances', async (request, reply) => {
    try {
      const { userPubkey, tokenX, tokenY } = request.query || {};
      if (!userPubkey || !tokenX || !tokenY) {
        return reply.status(400).send({ ok: false, error: 'userPubkey, tokenX, tokenY required' });
      }
      const mintX = deps.buildService.resolveMint(tokenX);
      const mintY = deps.buildService.resolveMint(tokenY);
      let dX = 5, dY = 5;
      try { dX = tokensService.getToken(tokenX)?.decimals ?? 5; } catch {}
      try { dY = tokensService.getToken(tokenY)?.decimals ?? 5; } catch {}
      const connection = deps.connection;
      const [balX, balY] = await Promise.all([
        deps.buildService._getAvailableTokenBalance(connection, userPubkey, mintX),
        deps.buildService._getAvailableTokenBalance(connection, userPubkey, mintY),
      ]);
      return reply.send({
        ok: true,
        tokenX: {
          symbol: tokenX,
          mint: mintX,
          decimals: dX,
          available: Number(balX.available) / Math.pow(10, dX),
          total: Number(balX.total) / Math.pow(10, dX),
          withheld: Number(balX.withheld) / Math.pow(10, dX),
        },
        tokenY: {
          symbol: tokenY,
          mint: mintY,
          decimals: dY,
          available: Number(balY.available) / Math.pow(10, dY),
          total: Number(balY.total) / Math.pow(10, dY),
          withheld: Number(balY.withheld) / Math.pow(10, dY),
        },
      });
    } catch (e) {
      return reply.status(400).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /fees ----
  app.get('/fees', async (request, reply) => {
    const poolAddress = request.query.poolAddress;
    const userPubkey = request.query.userPubkey;
    if (!poolAddress) return reply.status(400).send({ ok: false, error: 'poolAddress query param required' });
    if (!isValidSolanaPublicKey(poolAddress)) return reply.status(400).send({ ok: false, error: 'Invalid poolAddress' });
    try {
      const cacheKey = `pool_fees:${poolAddress}${userPubkey ? ':' + userPubkey : ''}`;
      if (deps.cacheService?.enabled) {
        const cached = await deps.cacheService.get(cacheKey);
        if (cached) return reply.send(cached);
      }
      const result = await deps.buildService.getPositionFees({ poolAddress, userPubkey });
      if (deps.cacheService?.enabled && result.ok) {
        await deps.cacheService.set(cacheKey, result, 120).catch(() => {});
      }
      return reply.send(result);
    } catch (e) {
      const cacheKey = `pool_fees:${poolAddress}${userPubkey ? ':' + userPubkey : ''}`;
      if (deps.cacheService?.enabled) {
        const cached = await deps.cacheService.get(cacheKey).catch(() => null);
        if (cached) return reply.send(cached);
      }
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /fees/summary ----
  app.get('/fees/summary', async (request, reply) => {
    try {
      const { query: feeQ } = require('./db/init');
      const result = await feeQ(
        `SELECT token_symbol, token_mint, fee_type, SUM(amount) as total_earned, COUNT(*) as event_count
         FROM fee_events
         GROUP BY token_symbol, token_mint, fee_type
         ORDER BY fee_type, token_symbol`
      );
      return reply.send({ ok: true, fees: result.rows });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /pool/price ----
  app.get('/pool/price', async (request, reply) => {
    const poolAddress = request.query.poolAddress;
    if (!poolAddress) return reply.status(400).send({ ok: false, error: 'poolAddress query param required' });
    if (!isValidSolanaPublicKey(poolAddress)) return reply.status(400).send({ ok: false, error: 'Invalid poolAddress' });
    const decimalsA = parseInt(request.query.decimalsA || '5', 10);
    const decimalsB = parseInt(request.query.decimalsB || '5', 10);
    if (isNaN(decimalsA) || isNaN(decimalsB)) return reply.status(400).send({ ok: false, error: 'decimalsA and decimalsB must be integers' });
    try {
      const result = await deps.poolService.getPoolPrice(poolAddress, decimalsA, decimalsB);
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /fees/collect/build ----
  app.post('/fees/collect/build', async (request, reply) => {
    try {
      const payload = request.body || {};
      if (!payload.userPubkey) return reply.status(400).send({ ok: false, error: 'userPubkey is required' });
      if (!payload.positionMint) return reply.status(400).send({ ok: false, error: 'positionMint is required' });
      const result = await deps.buildService.buildCollectFees(payload);
      return reply.send(result);
    } catch (e) {
      const statusCode = e.statusCode || 400;
      return reply.status(statusCode).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /liquidity/remove/build ----
  app.post('/liquidity/remove/build', async (request, reply) => {
    try {
      const payload = request.body || {};
      if (!payload.userPubkey) return reply.status(400).send({ ok: false, error: 'userPubkey is required' });
      if (!payload.positionMint) return reply.status(400).send({ ok: false, error: 'positionMint is required' });
      payload.vaultAddress = treasuryPubkey;
      const result = await deps.buildService.buildRemoveLiquidity(payload);
      return reply.send(result);
    } catch (e) {
      const statusCode = e.statusCode || 400;
      return reply.status(statusCode).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /positions ----
  app.get('/positions', async (request, reply) => {
    const poolAddress = request.query.poolAddress;
    const userPubkey = request.query.userPubkey;
    if (!poolAddress) return reply.status(400).send({ ok: false, error: 'poolAddress query param required' });
    try {
      const result = await deps.buildService.getPositionsForPool({ poolAddress, userPubkey });
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /swap/limits ----
  app.get('/swap/limits', async (request, reply) => {
    try {
      const wallet = request.query.wallet;
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet query param is required' });
      const usage = await deps.tradeService.getWalletSwapUsage(wallet);
      const swapLimitConfig = await deps.tradeService.getSwapLimits();
      const limits = deps.tradeService.checkSwapLimits(usage, 0, swapLimitConfig);
      return reply.send({ ok: true, daily: limits.daily, monthly: limits.monthly });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /swap/build ----
  app.post('/swap/build', async (request, reply) => {
    try {
      const payload = request.body || {};
      if (!payload.userPubkey) return reply.status(400).send({ ok: false, error: 'userPubkey is required' });

      const amountIn = parseFloat(payload.amountIn) || 0;
      if (amountIn > 0) {
        const usage = await deps.tradeService.getWalletSwapUsage(payload.userPubkey);
        const humanAmount = amountIn / 1e5;
        const swapLimitConfig = await deps.tradeService.getSwapLimits();
        const limits = deps.tradeService.checkSwapLimits(usage, humanAmount, swapLimitConfig);
        if (!limits.allowed) {
          const which = limits.reason === 'daily' ? 'Daily' : 'Monthly';
          const cap = limits.reason === 'daily' ? limits.daily.limit : limits.monthly.limit;
          const remaining = limits.reason === 'daily' ? limits.daily.remaining : limits.monthly.remaining;
          return reply.status(429).send({
            ok: false,
            error: `${which} swap limit exceeded. Limit: ${cap} tokens, remaining: ${remaining.toFixed(2)} tokens.`,
            limitExceeded: true,
            daily: limits.daily,
            monthly: limits.monthly,
          });
        }
      }

      const result = await deps.buildService.buildSwap(payload);
      return reply.send(result);
    } catch (e) {
      const statusCode = e.statusCode || 400;
      return reply.status(statusCode).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /send ----
  app.post('/send', async (request, reply) => {
    try {
      const payload = request.body || {};
      if (!payload.transaction) return reply.status(400).send({ ok: false, error: 'transaction (base64) is required' });
      const txBuf = Buffer.from(payload.transaction, 'base64');
      const signature = await deps.connection.sendRawTransaction(txBuf, {
        skipPreflight: true,
        maxRetries: 5,
      });
      let confirmed = false;
      let txError = null;
      try {
        const bh = payload.blockhash
          ? { blockhash: payload.blockhash, lastValidBlockHeight: payload.lastValidBlockHeight || 0 }
          : await deps.connection.getLatestBlockhash('confirmed');
        const POLL_MS = 2000;
        const MAX_P = 15;
        for (let p = 0; p < MAX_P; p++) {
          await new Promise(r => setTimeout(r, POLL_MS));
          const { value } = await deps.connection.getSignatureStatuses([signature]);
          const st = value && value[0];
          if (st && st.err) { txError = JSON.stringify(st.err); confirmed = true; break; }
          if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
            confirmed = true; break;
          }
          if (bh.lastValidBlockHeight) {
            const h = await deps.connection.getBlockHeight('confirmed');
            if (h > bh.lastValidBlockHeight) break;
          }
        }
      } catch (_) {}

      let referralBonus = null;
      if (confirmed && !txError && payload.tradeMeta) {
        try {
          const m = payload.tradeMeta;
          await deps.tradeService.recordTrade({
            eventType: m.eventType || 'swap',
            tokenA: m.tokenA || '',
            tokenB: m.tokenB || '',
            tokenAMint: m.tokenAMint || '',
            tokenBMint: m.tokenBMint || '',
            amountIn: parseFloat(m.amountIn) || 0,
            amountOut: parseFloat(m.amountOut) || 0,
            price: parseFloat(m.price) || 0,
            poolAddress: m.poolAddress || '',
            txSignature: signature,
            wallet: m.wallet || '',
          });
        } catch (tradeErr) {
          console.error('[Trade] Record after /send failed:', tradeErr.message);
        }
        const tradeEventType = (payload.tradeMeta.eventType || '').toLowerCase();
        if (tradeEventType === 'swap') {
          try {
            let swapWallet = null;
            try {
              const { VersionedTransaction } = require('@solana/web3.js');
              const decodedTx = VersionedTransaction.deserialize(txBuf);
              const signerKey = decodedTx.message.staticAccountKeys?.[0];
              if (signerKey) swapWallet = signerKey.toBase58();
            } catch {
              swapWallet = payload.tradeMeta.wallet;
            }
            if (swapWallet) {
              const referralResult = await deps.referralDbService.onSwapComplete(swapWallet);
              if (referralResult) {
                console.log(`[Referral] First swap by ${swapWallet.slice(0,8)}... via /send — referrer paid=${referralResult.referrerPaid}, referee paid=${referralResult.refereePaid}`);
                if (referralResult.errors?.length) {
                  referralResult.errors.forEach(e => console.error(`[Referral] ${e}`));
                }
                referralBonus = {
                  refereeReward: referralResult.refereeReward,
                  referrerReward: referralResult.referrerReward,
                  refereePaid: referralResult.refereePaid,
                  referrerPaid: referralResult.referrerPaid,
                  refereeTx: referralResult.refereeTx,
                  referrerTx: referralResult.referrerTx,
                };
              }
            }
          } catch (refErr) {
            console.error('[Referral] onSwapComplete failed:', refErr.message);
          }
        }
        routeCache.deleteByPrefix('pools:');
        routeCache.deleteByPrefix('treasury:');
        routeCache.deleteByPrefix('quote:');
        deps.poolService.clearPoolCache();
      }

      if (confirmed && !txError) {
        const validChannels = ['pools:update', 'balances:update', 'prices:update', 'treasury:update', 'tokens:update', 'admin:update'];
        const baseChannels = ['balances:update', 'prices:update'];
        const requested = Array.isArray(payload.updateChannels) ? payload.updateChannels.filter(c => validChannels.includes(c)) : [];
        const channelsToPublish = [...new Set([...baseChannels, ...requested])];
        for (const ch of channelsToPublish) {
          cacheService.publishUpdate(ch, payload.updateDetail || 'tx_confirmed');
        }
      }

      const txErrorFriendly = txError ? (decodeSolanaError(txError) || txError) : null;
      if (txErrorFriendly) {
        return reply.send({ ok: false, signature, confirmed, error: txErrorFriendly, txError: txErrorFriendly });
      }
      return reply.send({ ok: true, signature, confirmed, ...(referralBonus ? { referralBonus } : {}) });
    } catch (e) {
      const friendly = decodeSolanaError(e.message) || e.message;
      const statusCode = e.statusCode || 400;
      return reply.status(statusCode).send({ ok: false, error: friendly });
    }
  });

  // ---- GET /chart/candles ----
  app.get('/chart/candles', async (request, reply) => {
    const tokenId = request.query.tokenId;
    const interval = request.query.interval || '1h';
    const from = request.query.from;
    const to = request.query.to;
    if (!tokenId) return reply.status(400).send({ ok: false, error: 'tokenId is required' });
    try {
      const pairTokenId = request.query.pairTokenId || undefined;
      const candles = await deps.tradeService.getCandles({ tokenId, interval, from, to, pairTokenId });
      return reply.send({ ok: true, tokenId, interval, count: candles.length, candles });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /chart/sparkline ----
  app.get('/chart/sparkline', async (request, reply) => {
    const tokenId = request.query.tokenId;
    const hours = parseInt(request.query.hours || '168', 10);
    if (!tokenId) return reply.status(400).send({ ok: false, error: 'tokenId is required' });
    try {
      const pairTokenId = request.query.pairTokenId || undefined;
      const sparkData = await deps.tradeService.getSparkline({ tokenId, hours, pairTokenId });
      if (sparkData && sparkData.prices) {
        return reply.send({ ok: true, tokenId, hours, count: sparkData.prices.length, prices: sparkData.prices, min: sparkData.min, max: sparkData.max, start: sparkData.start, end: sparkData.end, trend: sparkData.trend });
      }
      return reply.send({ ok: true, tokenId, hours, count: 0, prices: [] });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /chart/trades ----
  app.get('/chart/trades', async (request, reply) => {
    const tokenId = request.query.tokenId;
    const limit = parseInt(request.query.limit || '50', 10);
    if (!tokenId) return reply.status(400).send({ ok: false, error: 'tokenId is required' });
    try {
      const pairTokenId = request.query.pairTokenId || undefined;
      const wallet = request.query.wallet || undefined;
      const trades = await deps.tradeService.getRecentTrades({ tokenId, limit, pairTokenId, wallet });
      return reply.send({ ok: true, tokenId, count: trades.length, trades });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /chart/stats ----
  app.get('/chart/stats', async (request, reply) => {
    try {
      const tokenIdsParam = request.query.tokenIds || '';
      const tokenIds = tokenIdsParam.split(',').filter(Boolean);
      if (tokenIds.length === 0) return reply.status(400).send({ ok: false, error: 'tokenIds required' });
      const cacheKey = `stats:${tokenIds.sort().join(',')}`;
      const cached = routeCache.get(cacheKey);
      if (cached) return reply.send(cached);
      const stats = await deps.tradeService.getAllTokenStats(tokenIds);
      const result = { ok: true, stats };
      routeCache.set(cacheKey, result, 60000);
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/aggregated ----
  app.get('/admin/aggregated', async (request, reply) => {
    try {
      const period = request.query.period || 'all';
      const data = await deps.overviewService.getAggregated(period);
      return reply.send({ ok: true, ...data });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /platform/stats ----
  app.get('/platform/stats', async (request, reply) => {
    try {
      const data = await routeCache.coalesce('platform:topbar:stats', 120_000, () =>
        deps.overviewService.getTopBarStats()
      );
      return reply.send({ ok: true, ...data });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/stats ----
  app.get('/admin/stats', async (request, reply) => {
    try {
      const period = request.query.period || 'all';
      const data = await deps.adminService.getFullAdminData(period);
      return reply.send({ ok: true, ...data });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/fees ----
  app.get('/admin/fees', async (request, reply) => {
    try {
      const period = request.query.period || 'all';
      const data = await deps.adminService.getFeesBreakdown(period);
      return reply.send({ ok: true, fees: data });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/price-trends ----
  app.get('/admin/price-trends', async (request, reply) => {
    try {
      const tokenIds = (request.query.tokenIds || 'asdc,edc,dmc').split(',');
      const period = request.query.period || 'week';
      const data = await deps.adminService.getPriceTrends(tokenIds, period);
      return reply.send({ ok: true, trends: data });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /treasury/multisig ----
  app.get('/treasury/multisig', async (request, reply) => {
    try {
      const msState = await deps.treasuryService.getMultisigState();
      if (!msState.initialized || !msState.members || msState.members.length === 0) {
        const fallback = process.env.FALLBACK_ADMIN_WALLET;
        if (fallback) {
          return reply.send({ ok: true, initialized: false, members: [{ key: fallback }], owners: [fallback], fallbackAdmin: true });
        }
      }
      return reply.send({ ok: true, ...msState });
    } catch (e) {
      const fallback = process.env.FALLBACK_ADMIN_WALLET;
      if (fallback) {
        return reply.send({ ok: true, initialized: false, members: [{ key: fallback }], owners: [fallback], fallbackAdmin: true });
      }
      return reply.status(e.statusCode || 500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /treasury/balances ----
  app.get('/treasury/balances', async (request, reply) => {
    try {
      const balances = await deps.treasuryService.getBalances();
      const target = deps.treasuryService.getDepositTarget();
      return reply.send({ ok: true, vaultAuthority: target ? target.toBase58() : null, balances });
    } catch (e) {
      return reply.status(e.statusCode || 500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /treasury/fees/history ----
  app.get('/treasury/fees/history', async (request, reply) => {
    try {
      const filters = {
        token: request.query.token || undefined,
        feeType: request.query.type || undefined,
        from: request.query.from || undefined,
        to: request.query.to || undefined,
        limit: request.query.limit || 100,
        offset: request.query.offset || 0,
      };
      const events = await deps.treasuryService.getFeeHistory(filters);
      return reply.send({ ok: true, events });
    } catch (e) {
      return reply.status(e.statusCode || 500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /oracle/price ----
  app.get('/oracle/price', async (request, reply) => {
    try {
      const token = request.query.token || request.query.symbol;
      const pair = request.query.pair || undefined;
      if (!token) return reply.status(400).send({ ok: false, error: 'token query param required' });

      const cacheKey = `oracle:price:${token}:${pair || 'any'}`;
      const cached = routeCache.get(cacheKey);
      if (cached) return reply.send(cached);

      const latest = await deps.priceService.getLatestPrice(token.toUpperCase(), pair ? pair.toUpperCase() : undefined);
      const result = { ok: true, price: latest };
      routeCache.set(cacheKey, result, 15000);
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /oracle/prices ----
  app.get('/oracle/prices', async (request, reply) => {
    try {
      const cached = routeCache.get('oracle:prices:all');
      if (cached) return reply.send(cached);

      const prices = await deps.priceService.getLatestPrices();
      const result = { ok: true, prices };
      routeCache.set('oracle:prices:all', result, 15000);
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /oracle/history ----
  app.get('/oracle/history', async (request, reply) => {
    try {
      const token = request.query.token || request.query.symbol;
      if (!token) return reply.status(400).send({ ok: false, error: 'token query param required' });

      const pair = request.query.pair ? request.query.pair.toUpperCase() : undefined;
      const days = request.query.days;
      const cacheKey = `oracle:history:${token}:${pair || 'any'}:${days || ''}:${request.query.from || ''}:${request.query.to || ''}:${request.query.limit || ''}:${request.query.offset || ''}`;
      const cached = routeCache.get(cacheKey);
      if (cached) return reply.send(cached);

      let prices;
      if (days) {
        prices = await deps.priceService.getHistoricalPrices(token.toUpperCase(), Number(days));
      } else {
        prices = await deps.priceService.getHistoricalPricesFiltered({
          tokenSymbol: token.toUpperCase(),
          pairSymbol: pair,
          from: request.query.from,
          to: request.query.to,
          limit: request.query.limit,
          offset: request.query.offset,
        });
      }
      const result = { ok: true, token: token.toUpperCase(), count: prices.length, prices };
      routeCache.set(cacheKey, result, 60000);
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /oracle/vwap ----
  app.get('/oracle/vwap', async (request, reply) => {
    try {
      const token = request.query.token || request.query.symbol;
      if (!token) return reply.status(400).send({ ok: false, error: 'token query param required' });

      const cacheKey = `oracle:vwap:${token}:${request.query.pair || 'any'}:${request.query.days || 365}`;
      const cached = routeCache.get(cacheKey);
      if (cached) return reply.send(cached);

      const vwap = await deps.priceService.getVwap({
        tokenSymbol: token.toUpperCase(),
        pairSymbol: request.query.pair ? request.query.pair.toUpperCase() : undefined,
        days: request.query.days,
      });
      const result = { ok: true, token: token.toUpperCase(), ...vwap };
      routeCache.set(cacheKey, result, 60000);
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /oracle/valuation ----
  app.get('/oracle/valuation', async (request, reply) => {
    try {
      const cached = routeCache.get('oracle:valuation');
      if (cached) return reply.send(cached);

      const valuation = await deps.treasuryService.getVaultValuation(deps.priceService);
      const result = { ok: true, ...valuation };
      routeCache.set('oracle:valuation', result, 30000);
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  registerOracleRoutes(app, deps, routeCache);
  registerNetworkPostRoutes(app, getAdminWallets);

  // ---- POST /treasury/fees/collect ----
  app.post('/treasury/fees/collect', async (request, reply) => {
    try {
      const walletAddr = request.headers['x-wallet-address'] || '';
      const TREASURY_ADMIN_WALLETS = await getAdminWallets();
      if (!isValidSolanaPublicKey(walletAddr) || !TREASURY_ADMIN_WALLETS.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Authorized treasury owner wallet required' });
      }
      const result = await deps.treasuryService.collectPoolFees();
      cacheService.publishTreasuryUpdate('fees_collected');
      cacheService.publishBalancesUpdate('fees_collected');
      return reply.send(result);
    } catch (e) {
      return reply.status(e.statusCode || 500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /treasury/fees/withdraw ----
  app.post('/treasury/fees/withdraw', async (request, reply) => {
    try {
      const walletAddr = request.headers['x-wallet-address'] || '';
      const TREASURY_ADMIN_WALLETS = await getAdminWallets();
      if (!isValidSolanaPublicKey(walletAddr) || !TREASURY_ADMIN_WALLETS.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Authorized treasury owner wallet required' });
      }
      const result = await deps.treasuryService.withdrawAllTransferFees();
      cacheService.publishTreasuryUpdate('fees_withdrawn');
      cacheService.publishBalancesUpdate('fees_withdrawn');
      return reply.send(result);
    } catch (e) {
      return reply.status(e.statusCode || 500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/setup/status ----
  app.get('/admin/setup/status', async (request, reply) => {
    try {
      const status = await deps.adminSetupService.getSetupStatus();
      return reply.send({ ok: true, ...status });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/programs ----
  app.get('/admin/programs', async (request, reply) => {
    try {
      const config = await deps.adminSetupService.getProgramConfig();
      return reply.send({ ok: true, ...config });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/programs/register ----
  app.post('/admin/programs/register', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || '';
      const ADMIN_WALLETS = await getAdminWallets();
      if (ADMIN_WALLETS.length > 0 && !ADMIN_WALLETS.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const result = await deps.adminSetupService.saveProgramConfig({
        token_core_program_id: body.token_core_program_id,
      });
      if (body.token_core_program_id) {
        deps.programIds.tokenCore = new PublicKey(body.token_core_program_id);
      }
      cacheService.publishAdminUpdate('programs_registered');
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/multisig-owners ----
  app.get('/admin/multisig-owners', async (request, reply) => {
    try {
      const owners = await deps.adminSetupService.getMultisigOwners();
      return reply.send({ ok: true, owners });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/multisig-owners ----
  app.post('/admin/multisig-owners', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS_MO = await getAdminWallets();
      if (ADMIN_WALLETS_MO.length > 0 && !ADMIN_WALLETS_MO.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.owner1 || !body.owner2 || !body.owner3) {
        return reply.status(400).send({ ok: false, error: 'owner1, owner2, owner3 required' });
      }
      const result = await deps.adminSetupService.saveMultisigOwners(body);
      cacheService.publishAdminUpdate('multisig_owners_saved');
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/tokens ----
  app.get('/admin/tokens', async (request, reply) => {
    try {
      const tokens = await deps.adminSetupService.getTokensFromDb();
      const predefined = deps.adminSetupService.getPredefinedTokens();
      return reply.send({ ok: true, tokens, predefined });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/token/init/confirm ----
  app.post('/admin/token/init/confirm', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS = await getAdminWallets();
      if (ADMIN_WALLETS.length > 0 && !ADMIN_WALLETS.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.symbol || !body.mint_address) {
        return reply.status(400).send({ ok: false, error: 'symbol and mint_address required' });
      }
      const result = await deps.adminSetupService.saveTokenToDb({
        symbol: body.symbol,
        name: body.name || body.symbol,
        mint_address: body.mint_address,
        decimals: body.decimals || 5,
        supply: body.supply || '0',
        metadata_uri: body.metadata_uri || '',
        image_url: body.image_url || '',
        tx_signature: body.tx_signature || '',
      });
      if (body.treasury_ata && body.mint_address) {
        try {
          await deps.adminSetupService.saveTreasuryWallet({
            token_symbol: body.symbol,
            mint_address: body.mint_address,
            treasury_ata: body.treasury_ata,
            tx_signature: body.tx_signature || '',
          });
        } catch (e) {
          console.warn('[Token Init] Failed to save treasury wallet:', e.message);
        }
      }
      try { await tokensService.loadFromDatabase(); } catch {}
      cacheService.publishTokensUpdate('token_registered');
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/vault ----
  app.get('/admin/vault', async (request, reply) => {
    try {
      const vault = await deps.adminSetupService.getVaultConfig();
      return reply.send({ ok: true, vault });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/treasury/create-atas/build ----
  app.post('/admin/treasury/create-atas/build', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || '';
      if (!isValidSolanaPublicKey(walletAddr)) {
        return reply.status(400).send({ ok: false, error: 'Valid userPubkey required' });
      }
      const ADMIN_WALLETS_AB = await getAdminWallets();
      if (ADMIN_WALLETS_AB.length > 0 && !ADMIN_WALLETS_AB.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const result = await deps.adminSetupService.buildTreasuryAtasTransaction(body);
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/treasury/create-atas/confirm ----
  app.post('/admin/treasury/create-atas/confirm', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS_AC = await getAdminWallets();
      if (ADMIN_WALLETS_AC.length > 0 && !ADMIN_WALLETS_AC.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.atas || !Array.isArray(body.atas)) {
        return reply.status(400).send({ ok: false, error: 'atas array required' });
      }
      for (const ata of body.atas) {
        await deps.adminSetupService.saveTreasuryWallet(ata);
      }
      cacheService.publishTreasuryUpdate('atas_created');
      cacheService.publishBalancesUpdate('atas_created');
      return reply.send({ ok: true, saved: body.atas.length });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/treasury/wallets ----
  app.get('/admin/treasury/wallets', async (request, reply) => {
    try {
      const wallets = await deps.adminSetupService.getTreasuryWallets();
      return reply.send({ ok: true, wallets });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });


  // ---- POST /admin/squads/recover-multisig ----
  app.post('/admin/squads/recover-multisig', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS_RC = await getAdminWallets();
      if (ADMIN_WALLETS_RC.length > 0 && !ADMIN_WALLETS_RC.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const txSig = body.txSignature;
      if (!txSig) {
        return reply.status(400).send({ ok: false, error: 'txSignature required' });
      }

      const existingConfig = await deps.adminSetupService.getVaultConfig();
      if (existingConfig && existingConfig.multisig_pda) {
        return reply.send(jsonSafe({
          ok: true,
          multisigPda: existingConfig.multisig_pda,
          vaultPda: existingConfig.treasury_authority_pda,
          alreadyExists: true,
          message: 'Multisig already in database',
        }));
      }

      const sqdsMultisig = require('@sqds/multisig');
      const SQUADS_PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
      const txDetail = await connection.getParsedTransaction(txSig, { maxSupportedTransactionVersion: 0 });
      if (!txDetail) {
        return reply.status(404).send({ ok: false, error: 'Transaction not found on-chain' });
      }
      const ixs = txDetail.transaction.message.instructions;
      const squadsIx = ixs.find(ix => ix.programId && ix.programId.toBase58() === SQUADS_PROGRAM_ID.toBase58());
      if (!squadsIx || !squadsIx.accounts || squadsIx.accounts.length < 4) {
        return reply.status(400).send({ ok: false, error: 'No Squads multisig instruction found in transaction' });
      }

      const accountKeys = txDetail.transaction.message.accountKeys;
      const signerKeys = accountKeys.filter(k => k.signer).map(k => k.pubkey.toBase58());
      const createKeyPub = signerKeys.find(k => k !== wallet.publicKey.toBase58());
      if (!createKeyPub) {
        return reply.status(400).send({ ok: false, error: 'Could not identify createKey from transaction' });
      }

      const [msPda] = sqdsMultisig.getMultisigPda({ createKey: new PublicKey(createKeyPub) });
      const [vaultPda] = sqdsMultisig.getVaultPda({ multisigPda: msPda, index: 0 });

      let msAccount;
      try {
        msAccount = await sqdsMultisig.accounts.Multisig.fromAccountAddress(connection, msPda);
      } catch (e) {
        return reply.status(404).send({ ok: false, error: 'Multisig PDA not found on-chain: ' + msPda.toBase58() });
      }

      const memberKeys = msAccount.members.map(m => m.key.toBase58());

      await deps.adminSetupService.saveVaultConfig({
        multisig_pda: msPda.toBase58(),
        treasury_authority_pda: vaultPda.toBase58(),
        program_id: SQUADS_PROGRAM_ID.toBase58(),
        owners: memberKeys,
        threshold: msAccount.threshold,
        allowed_programs: [],
        tx_signature: txSig,
      });

      deps.squadsService.setMultisig(msPda.toBase58());
      const vaultAddr = deps.squadsService.getVaultAddress();
      if (vaultAddr) {
        deps.treasuryService.setSquadsVault(vaultAddr.toBase58(), deps.squadsService);
      }

      _cachedAdminWallets = null;
      _adminCacheTime = 0;

      return reply.send(jsonSafe({
        ok: true,
        multisigPda: msPda.toBase58(),
        vaultPda: vaultPda.toBase58(),
        members: memberKeys,
        threshold: msAccount.threshold,
        recovered: true,
        message: 'Multisig recovered from on-chain transaction',
      }));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/squads/create-multisig/build ----
  app.post('/admin/squads/create-multisig/build', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || '';
      const ADMIN_WALLETS_BLD = await getAdminWallets();
      if (ADMIN_WALLETS_BLD.length > 0 && !ADMIN_WALLETS_BLD.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.owners || !Array.isArray(body.owners) || body.owners.length < 2) {
        return reply.status(400).send({ ok: false, error: 'owners array with at least 2 members required' });
      }
      const existingConfig = await deps.adminSetupService.getVaultConfig();
      if (existingConfig && existingConfig.multisig_pda) {
        try {
          const existingState = await deps.squadsService.getMultisigState();
          if (existingState && existingState.initialized) {
            return reply.send(jsonSafe({
              ok: true,
              multisigPda: existingConfig.multisig_pda,
              vaultPda: existingConfig.treasury_authority_pda,
              alreadyExists: true,
              message: 'Multisig already exists',
            }));
          }
        } catch (checkErr) {}
      }
      const result = await deps.squadsService.buildCreateMultisigTransaction({
        owners: body.owners,
        threshold: body.threshold || 2,
        userPubkey: walletAddr,
      });
      return reply.send(jsonSafe(result));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/squads/create-multisig/finalize ----
  app.post('/admin/squads/create-multisig/finalize', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || '';
      const ADMIN_WALLETS_FIN = await getAdminWallets();
      if (ADMIN_WALLETS_FIN.length > 0 && !ADMIN_WALLETS_FIN.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.multisigPda || !body.txSignature) {
        return reply.status(400).send({ ok: false, error: 'multisigPda and txSignature required' });
      }
      const owners = body.owners || [];
      const threshold = body.threshold || 2;
      if (!Array.isArray(owners) || owners.length < 2) {
        return reply.status(400).send({ ok: false, error: 'owners must be an array with at least 2 members' });
      }
      if (threshold < 1 || threshold > owners.length) {
        return reply.status(400).send({ ok: false, error: `threshold must be between 1 and ${owners.length}` });
      }

      const { PublicKey: PK } = require('@solana/web3.js');
      const msPda = new PK(body.multisigPda);
      const sqdsMultisig = require('@sqds/multisig');
      const [vaultPda] = sqdsMultisig.getVaultPda({ multisigPda: msPda, index: 0 });

      await deps.adminSetupService.saveVaultConfig({
        multisig_pda: msPda.toBase58(),
        treasury_authority_pda: vaultPda.toBase58(),
        program_id: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
        owners,
        threshold,
        allowed_programs: [],
        tx_signature: body.txSignature,
        skipVerification: true,
      });

      deps.squadsService.setMultisig(msPda.toBase58());
      const vaultAddr = deps.squadsService.getVaultAddress();
      if (vaultAddr) {
        deps.treasuryService.setSquadsVault(vaultAddr.toBase58(), deps.squadsService);
      }

      _cachedAdminWallets = null;
      _adminCacheTime = 0;

      console.log(`[Squads] Multisig finalized: pda=${msPda.toBase58()}, vault=${vaultPda.toBase58()}, owners=${owners.length}, threshold=${threshold}, tx=${body.txSignature}`);

      return reply.send(jsonSafe({
        ok: true,
        multisigPda: msPda.toBase58(),
        vaultPda: vaultPda.toBase58(),
        owners,
        threshold,
        message: 'Multisig created and saved',
      }));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/squads/create-multisig (legacy — backend-signed) ----
  app.post('/admin/squads/create-multisig', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS_SQ = await getAdminWallets();
      if (ADMIN_WALLETS_SQ.length > 0 && !ADMIN_WALLETS_SQ.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.owners || !Array.isArray(body.owners) || body.owners.length < 2) {
        return reply.status(400).send({ ok: false, error: 'owners array with at least 2 members required' });
      }
      const existingConfig = await deps.adminSetupService.getVaultConfig();
      if (existingConfig && existingConfig.multisig_pda) {
        try {
          const existingState = await deps.squadsService.getMultisigState();
          if (existingState && existingState.initialized) {
            return reply.send(jsonSafe({
              ok: true,
              multisigPda: existingConfig.multisig_pda,
              vaultPda: existingConfig.treasury_authority_pda,
              alreadyExists: true,
              message: 'Multisig already exists',
            }));
          }
        } catch (checkErr) {
        }
      }
      const result = await deps.squadsService.createMultisig({
        owners: body.owners,
        threshold: body.threshold || 2,
      });
      if (result.ok && result.multisigPda) {
        await deps.adminSetupService.saveVaultConfig({
          multisig_pda: result.multisigPda,
          treasury_authority_pda: result.vaultPda,
          program_id: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
          owners: body.owners,
          threshold: body.threshold || 2,
          allowed_programs: [],
          tx_signature: result.signature || '',
        });
      }
      return reply.send(jsonSafe(result));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/squads/create-vault ----
  app.post('/admin/squads/create-vault', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS_SV = await getAdminWallets();
      if (ADMIN_WALLETS_SV.length > 0 && !ADMIN_WALLETS_SV.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (body.multisigPda) {
        deps.squadsService.setMultisig(body.multisigPda);
      }
      const result = await deps.squadsService.createVault(body.index || 0);
      return reply.send(jsonSafe(result));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/squads/propose-transfer ----
  app.post('/admin/squads/propose-transfer', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || body.creator || '';
      const ADMIN_WALLETS_PT = await getAdminWallets();
      if (ADMIN_WALLETS_PT.length > 0 && !ADMIN_WALLETS_PT.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.creator || !isValidSolanaPublicKey(body.creator)) {
        return reply.status(400).send({ ok: false, error: 'Valid creator required' });
      }
      if (!body.mint || !isValidSolanaPublicKey(body.mint)) {
        return reply.status(400).send({ ok: false, error: 'Valid mint address required' });
      }
      if (!body.destination || !isValidSolanaPublicKey(body.destination)) {
        return reply.status(400).send({ ok: false, error: 'Valid destination address required' });
      }
      const parsedAmount = Number(body.amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return reply.status(400).send({ ok: false, error: 'Amount must be a positive number' });
      }
      if (body.multisigPda) deps.squadsService.setMultisig(body.multisigPda);
      const result = await deps.squadsService.buildTransferProposal({
        creator: body.creator,
        mint: body.mint,
        destination: body.destination,
        amount: parsedAmount,
        decimals: body.decimals ?? 5,
      });
      const tokenSymbol = body.tokenSymbol || '';
      const msState = await deps.squadsService.getMultisigState();
      const threshold = msState.threshold || 2;
      try {
        const { query: dbQ } = require('./db/init');
        await dbQ(
          `INSERT INTO transfer_proposals (transaction_index, token_symbol, token_mint, amount, decimals, destination, creator, status, approvals, threshold, approved_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 0, $8, '[]')
           ON CONFLICT (transaction_index) DO NOTHING`,
          [result.transactionIndex, tokenSymbol, body.mint, String(parsedAmount), body.decimals ?? 5, body.destination, body.creator, threshold]
        );
      } catch (dbErr) {
        console.warn('[DB] Failed to save transfer proposal:', dbErr.message);
      }
      return reply.send(jsonSafe(result));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/squads/propose ----
  app.post('/admin/squads/propose', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || body.creator || request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS_SP = await getAdminWallets();
      if (ADMIN_WALLETS_SP.length > 0 && !ADMIN_WALLETS_SP.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.creator || !isValidSolanaPublicKey(body.creator)) {
        return reply.status(400).send({ ok: false, error: 'Valid creator public key required' });
      }
      if (!body.instructions || !Array.isArray(body.instructions)) {
        return reply.status(400).send({ ok: false, error: 'instructions array required' });
      }
      if (body.multisigPda) {
        deps.squadsService.setMultisig(body.multisigPda);
      }
      const { PublicKey: PK, TransactionInstruction: TxIx } = require('@solana/web3.js');
      const deserializedIxs = body.instructions.map((ix, i) => {
        if (!ix.programId || !ix.keys || !ix.data) {
          throw new Error(`Instruction ${i} missing programId, keys, or data`);
        }
        return new TxIx({
          programId: new PK(ix.programId),
          keys: ix.keys.map(k => ({
            pubkey: new PK(k.pubkey),
            isSigner: !!k.isSigner,
            isWritable: !!k.isWritable,
          })),
          data: Buffer.from(ix.data, 'base64'),
        });
      });
      const vtResult = await deps.squadsService.createVaultTransaction({
        creator: body.creator,
        instructions: deserializedIxs,
      });
      const propResult = await deps.squadsService.createProposal({
        creator: body.creator,
        transactionIndex: vtResult.transactionIndex,
      });
      return reply.send(jsonSafe({
        ok: true,
        transactionIndex: vtResult.transactionIndex,
        vaultTransaction: vtResult.transaction,
        proposalTransaction: propResult.transaction,
        blockhash: propResult.blockhash,
        lastValidBlockHeight: propResult.lastValidBlockHeight,
      }));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/squads/approve ----
  app.post('/admin/squads/approve', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || body.member || request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS_SA = await getAdminWallets();
      if (ADMIN_WALLETS_SA.length > 0 && !ADMIN_WALLETS_SA.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.member || !isValidSolanaPublicKey(body.member)) {
        return reply.status(400).send({ ok: false, error: 'Valid member public key required' });
      }
      if (body.transactionIndex === undefined || body.transactionIndex === null) {
        return reply.status(400).send({ ok: false, error: 'transactionIndex required' });
      }
      if (body.multisigPda) {
        deps.squadsService.setMultisig(body.multisigPda);
      }
      const result = await deps.squadsService.approveProposal({
        member: body.member,
        transactionIndex: body.transactionIndex,
      });
      return reply.send(jsonSafe(result));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/squads/execute ----
  app.post('/admin/squads/execute', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || body.member || request.headers['x-wallet-address'] || '';
      const ADMIN_WALLETS_SE = await getAdminWallets();
      if (ADMIN_WALLETS_SE.length > 0 && !ADMIN_WALLETS_SE.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.member || !isValidSolanaPublicKey(body.member)) {
        return reply.status(400).send({ ok: false, error: 'Valid member public key required' });
      }
      if (body.transactionIndex === undefined || body.transactionIndex === null) {
        return reply.status(400).send({ ok: false, error: 'transactionIndex required' });
      }
      if (body.multisigPda) {
        deps.squadsService.setMultisig(body.multisigPda);
      }
      const result = await deps.squadsService.executeTransaction({
        member: body.member,
        transactionIndex: body.transactionIndex,
      });
      return reply.send(jsonSafe(result));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/squads/proposals ----
  app.get('/admin/squads/proposals', async (request, reply) => {
    try {
      const walletAddrGP = request.query.wallet || '';
      const ADMIN_WALLETS_GP = await getAdminWallets();
      if (ADMIN_WALLETS_GP.length > 0 && !ADMIN_WALLETS_GP.includes(walletAddrGP)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const { query: dbQ } = require('./db/init');
      const result = await dbQ('SELECT * FROM transfer_proposals ORDER BY created_at DESC LIMIT 50');
      return reply.send({ ok: true, proposals: result.rows });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/squads/proposals/update-status ----
  app.post('/admin/squads/proposals/update-status', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || '';
      const ADMIN_WALLETS_PU = await getAdminWallets();
      if (ADMIN_WALLETS_PU.length > 0 && !ADMIN_WALLETS_PU.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.transactionIndex) {
        return reply.status(400).send({ ok: false, error: 'transactionIndex required' });
      }
      const { query: dbQ } = require('./db/init');
      const existing = await dbQ('SELECT * FROM transfer_proposals WHERE transaction_index = $1', [body.transactionIndex]);
      if (!existing.rows.length) {
        return reply.status(404).send({ ok: false, error: 'Proposal not found' });
      }
      const proposal = existing.rows[0];

      const msState = await deps.squadsService.getMultisigState();
      if (!msState.initialized) {
        if (msState.error && msState.error !== 'Multisig PDA not set') {
          return reply.status(502).send({ ok: false, error: 'Unable to read multisig state. Please try again.' });
        }
        return reply.status(400).send({ ok: false, error: 'Multisig not initialized' });
      }
      const memberKeys = (msState.members || []).map(m => typeof m === 'string' ? m : m.key || m.pubkey || '');
      if (!memberKeys.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Wallet is not a multisig member' });
      }

      const onChainState = await deps.squadsService.getProposalState(body.transactionIndex);
      if (!onChainState || !onChainState.ok) {
        return reply.status(502).send({ ok: false, error: 'Unable to verify on-chain proposal state. Please try again.' });
      }

      if (body.action === 'approve') {
        if (!onChainState.approvedMembers.includes(walletAddr)) {
          return reply.status(400).send({ ok: false, error: 'On-chain approval not found for this wallet. Please sign the approval transaction first.' });
        }
        const onChainApprovals = onChainState.approvedMembers;
        const newApprovals = onChainApprovals.length;
        const threshold = proposal.threshold || msState.threshold || 2;
        const newStatus = newApprovals >= threshold ? 'approved' : 'active';
        await dbQ(
          `UPDATE transfer_proposals SET approvals = $2, approved_by = $3::jsonb, status = $4, updated_at = NOW() WHERE transaction_index = $1`,
          [body.transactionIndex, newApprovals, JSON.stringify(onChainApprovals), newStatus]
        );
        return reply.send({ ok: true, approvals: newApprovals, approved_by: onChainApprovals, status: newStatus });
      }

      if (body.action === 'execute') {
        if (proposal.status === 'executed') {
          return reply.status(400).send({ ok: false, error: 'This proposal has already been executed' });
        }
        if (onChainState.status !== 'Executed') {
          return reply.status(400).send({ ok: false, error: `On-chain proposal status is "${onChainState.status}". The Squads execute transaction must be confirmed on-chain before the transfer can be applied.` });
        }
        const onChainApprovers = onChainState.approvedMembers || [];
        const updateResult = await dbQ(
          `UPDATE transfer_proposals SET status = 'executed', execute_signature = $2, approvals = $3, approved_by = $4::jsonb, updated_at = NOW() WHERE transaction_index = $1 AND status != 'executed' RETURNING id`,
          [body.transactionIndex, body.execute_signature || '', onChainApprovers.length, JSON.stringify(onChainApprovers)]
        );
        if (!updateResult.rows.length) {
          return reply.status(400).send({ ok: false, error: 'This proposal has already been executed (concurrent request)' });
        }
        return reply.send({ ok: true, status: 'executed' });
      }

      return reply.status(400).send({ ok: false, error: 'action must be "approve" or "execute"' });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/squads/state ----
  app.get('/admin/squads/state', async (request, reply) => {
    try {
      const multisigPda = request.query.multisigPda;
      if (multisigPda) {
        deps.squadsService.setMultisig(multisigPda);
      }
      const sqState = await deps.squadsService.getMultisigState();
      return reply.send(jsonSafe({ ok: true, ...sqState }));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/squads/vault-balances ----
  app.get('/admin/squads/vault-balances', async (request, reply) => {
    try {
      const multisigPda = request.query.multisigPda;
      if (multisigPda) {
        deps.squadsService.setMultisig(multisigPda);
      }
      let mintsParam = request.query.mints || '';
      let mints = mintsParam.split(',').filter(Boolean);
      if (mints.length === 0) {
        const allTokens = deps.tokensService.listTokens();
        mints = allTokens.map(t => t.mint_address || t.mint).filter(Boolean);
      }
      const result = await deps.squadsService.getVaultBalances(mints);
      const allTokens = deps.tokensService.listTokens();
      const tokenMap = {};
      for (const t of allTokens) {
        tokenMap[t.mint_address || t.mint] = t;
      }
      for (const b of result.balances) {
        if (b.mint !== 'SOL' && tokenMap[b.mint]) {
          b.symbol = tokenMap[b.mint].symbol;
          b.name = tokenMap[b.mint].name;
        }
      }
      return reply.send(jsonSafe(result));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/swap-limits ----
  app.get('/admin/swap-limits', async (request, reply) => {
    try {
      const walletAddr = request.query.wallet || '';
      const ADMIN_WALLETS_SL = await getAdminWallets();
      if (ADMIN_WALLETS_SL.length > 0 && !ADMIN_WALLETS_SL.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const swapLimits = await deps.tradeService.getSwapLimits();
      const { query: dbQ } = require('./db/init');
      const configResult = await dbQ('SELECT * FROM swap_limit_config ORDER BY updated_at DESC LIMIT 1');
      const config = configResult.rows[0] || null;
      return reply.send({ ok: true, limits: swapLimits, config });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/swap-limits/proposals ----
  app.get('/admin/swap-limits/proposals', async (request, reply) => {
    try {
      const walletAddr = request.query.wallet || '';
      const ADMIN_WALLETS_SLP = await getAdminWallets();
      if (ADMIN_WALLETS_SLP.length > 0 && !ADMIN_WALLETS_SLP.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const { query: dbQ } = require('./db/init');
      const result = await dbQ('SELECT * FROM swap_limit_proposals ORDER BY created_at DESC LIMIT 50');
      return reply.send({ ok: true, proposals: result.rows });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/squads/propose-limit-change ----
  app.post('/admin/squads/propose-limit-change', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || body.creator || '';
      const ADMIN_WALLETS_PLC = await getAdminWallets();
      if (ADMIN_WALLETS_PLC.length > 0 && !ADMIN_WALLETS_PLC.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.creator || !isValidSolanaPublicKey(body.creator)) {
        return reply.status(400).send({ ok: false, error: 'Valid creator required' });
      }
      const proposedDaily = parseFloat(body.dailyLimit);
      const proposedMonthly = parseFloat(body.monthlyLimit);
      if (!Number.isFinite(proposedDaily) || proposedDaily <= 0) {
        return reply.status(400).send({ ok: false, error: 'dailyLimit must be a positive number' });
      }
      if (!Number.isFinite(proposedMonthly) || proposedMonthly <= 0) {
        return reply.status(400).send({ ok: false, error: 'monthlyLimit must be a positive number' });
      }
      if (proposedDaily > proposedMonthly) {
        return reply.status(400).send({ ok: false, error: 'Daily limit cannot exceed monthly limit' });
      }

      const currentLimits = await deps.tradeService.getSwapLimits();

      const { PublicKey: PK } = require('@solana/web3.js');
      const memoIx = {
        programId: new PK('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        keys: [],
        data: Buffer.from(JSON.stringify({
          type: 'swap_limit_change',
          dailyLimit: proposedDaily,
          monthlyLimit: proposedMonthly,
        })),
      };

      if (body.multisigPda) deps.squadsService.setMultisig(body.multisigPda);

      const vtResult = await deps.squadsService.createVaultTransaction({
        creator: body.creator,
        instructions: [memoIx],
      });
      const propResult = await deps.squadsService.createProposal({
        creator: body.creator,
        transactionIndex: vtResult.transactionIndex,
      });

      const msState = await deps.squadsService.getMultisigState();
      const threshold = msState.threshold || 2;

      const { query: dbQ } = require('./db/init');
      try {
        await dbQ(
          `INSERT INTO swap_limit_proposals (transaction_index, proposed_daily, proposed_monthly, current_daily, current_monthly, creator, status, approvals, threshold, approved_by, propose_signature)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', 0, $7, '[]', '')
           ON CONFLICT (transaction_index) DO NOTHING`,
          [vtResult.transactionIndex, proposedDaily, proposedMonthly, currentLimits.daily, currentLimits.monthly, body.creator, threshold]
        );
      } catch (dbErr) {
        console.warn('[DB] Failed to save swap limit proposal:', dbErr.message);
      }

      broadcastSSE({ channel: 'swap_limits_update', detail: 'proposal_created', ts: Date.now() });

      return reply.send(jsonSafe({
        ok: true,
        transactionIndex: vtResult.transactionIndex,
        vaultTransaction: vtResult.transaction,
        proposalTransaction: propResult.transaction,
        blockhash: propResult.blockhash,
        lastValidBlockHeight: propResult.lastValidBlockHeight,
      }));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/swap-limits/proposals/update-status ----
  app.post('/admin/swap-limits/proposals/update-status', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || '';
      const ADMIN_WALLETS_SLPU = await getAdminWallets();
      if (ADMIN_WALLETS_SLPU.length > 0 && !ADMIN_WALLETS_SLPU.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.transactionIndex) {
        return reply.status(400).send({ ok: false, error: 'transactionIndex required' });
      }
      const { query: dbQ } = require('./db/init');
      const existing = await dbQ('SELECT * FROM swap_limit_proposals WHERE transaction_index = $1', [body.transactionIndex]);
      if (!existing.rows.length) {
        return reply.status(404).send({ ok: false, error: 'Swap limit proposal not found' });
      }
      const proposal = existing.rows[0];

      const msState = await deps.squadsService.getMultisigState();
      if (!msState.initialized) {
        return reply.status(400).send({ ok: false, error: 'Multisig not initialized' });
      }
      const memberKeys = (msState.members || []).map(m => typeof m === 'string' ? m : m.key || m.pubkey || '');
      if (!memberKeys.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Wallet is not a multisig member' });
      }

      const onChainState = await deps.squadsService.getProposalState(body.transactionIndex);
      if (!onChainState || !onChainState.ok) {
        return reply.status(502).send({ ok: false, error: 'Unable to verify on-chain proposal state. Please try again.' });
      }

      if (body.action === 'propose_signature' && body.propose_signature) {
        await dbQ(
          `UPDATE swap_limit_proposals SET propose_signature = $2, updated_at = NOW() WHERE transaction_index = $1`,
          [body.transactionIndex, body.propose_signature]
        );
        return reply.send({ ok: true });
      }

      if (body.action === 'approve') {
        if (!onChainState.approvedMembers.includes(walletAddr)) {
          return reply.status(400).send({ ok: false, error: 'On-chain approval not found for this wallet. Please sign the approval transaction first.' });
        }
        const onChainApprovals = onChainState.approvedMembers;
        const newApprovals = onChainApprovals.length;
        const threshold = proposal.threshold || msState.threshold || 2;
        const newStatus = newApprovals >= threshold ? 'approved' : 'active';
        let existingSigs = [];
        try { existingSigs = Array.isArray(proposal.approve_signatures) ? proposal.approve_signatures : JSON.parse(proposal.approve_signatures || '[]'); } catch { existingSigs = []; }
        if (body.approve_signature && !existingSigs.find(s => s.wallet === walletAddr)) {
          existingSigs.push({ wallet: walletAddr, signature: body.approve_signature });
        }
        await dbQ(
          `UPDATE swap_limit_proposals SET approvals = $2, approved_by = $3::jsonb, status = $4, approve_signatures = $5::jsonb, updated_at = NOW() WHERE transaction_index = $1`,
          [body.transactionIndex, newApprovals, JSON.stringify(onChainApprovals), newStatus, JSON.stringify(existingSigs)]
        );
        broadcastSSE({ channel: 'swap_limits_update', detail: 'proposal_approved', ts: Date.now() });
        return reply.send({ ok: true, approvals: newApprovals, approved_by: onChainApprovals, status: newStatus });
      }

      if (body.action === 'execute') {
        if (proposal.status === 'executed') {
          return reply.status(400).send({ ok: false, error: 'This proposal has already been executed' });
        }
        if (onChainState.status !== 'Executed') {
          return reply.status(400).send({ ok: false, error: `On-chain proposal status is "${onChainState.status}". The Squads execute transaction must be confirmed on-chain before limits can be applied.` });
        }
        const onChainApprovers = onChainState.approvedMembers || [];
        const updateResult = await dbQ(
          `UPDATE swap_limit_proposals SET status = 'executed', execute_signature = $2, approvals = $3, approved_by = $4::jsonb, updated_at = NOW() WHERE transaction_index = $1 AND status != 'executed' RETURNING id`,
          [body.transactionIndex, body.execute_signature || '', onChainApprovers.length, JSON.stringify(onChainApprovers)]
        );
        if (!updateResult.rows.length) {
          return reply.status(400).send({ ok: false, error: 'This proposal has already been executed (concurrent request)' });
        }
        await dbQ(
          `INSERT INTO swap_limit_config (daily_limit, monthly_limit, updated_by) VALUES ($1, $2, $3)`,
          [proposal.proposed_daily, proposal.proposed_monthly, walletAddr]
        );
        deps.tradeService.invalidateSwapLimitsCache();
        broadcastSSE({ channel: 'swap_limits_update', detail: 'limits_updated', ts: Date.now() });
        return reply.send({ ok: true, status: 'executed', dailyLimit: proposal.proposed_daily, monthlyLimit: proposal.proposed_monthly });
      }

      return reply.status(400).send({ ok: false, error: 'action must be "approve", "execute", or "propose_signature"' });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /referral/code ----
  app.get('/referral/code', async (request, reply) => {
    try {
      const wallet = request.query.wallet || '';
      if (!wallet || !isValidSolanaPublicKey(wallet)) {
        return reply.status(400).send({ ok: false, error: 'Valid wallet required' });
      }
      const code = await deps.referralDbService.getOrCreateCode(wallet);
      return reply.send({ ok: true, code });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /referral/use ----
  app.post('/referral/use', async (request, reply) => {
    try {
      const nacl = require('tweetnacl');
      const body = request.body || {};
      if (!body.code) return reply.status(400).send({ ok: false, error: 'Referral code required' });
      if (!body.wallet || !isValidSolanaPublicKey(body.wallet)) {
        return reply.status(400).send({ ok: false, error: 'Valid wallet required' });
      }
      if (!body.signature) {
        return reply.status(400).send({ ok: false, error: 'Wallet signature required for verification' });
      }
      const expectedMsg = `Apply referral code: ${body.code.toUpperCase()}`;
      const msgBytes = new TextEncoder().encode(expectedMsg);
      let sigBytes;
      try {
        sigBytes = Uint8Array.from(Buffer.from(body.signature, 'base64'));
      } catch {
        return reply.status(400).send({ ok: false, error: 'Invalid signature format' });
      }
      const pubkeyBytes = new PublicKey(body.wallet).toBytes();
      const verified = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
      if (!verified) {
        return reply.status(403).send({ ok: false, error: 'Wallet signature verification failed' });
      }
      const result = await deps.referralDbService.useCode(body.code, body.wallet);
      if (!result.ok) return reply.status(400).send(result);
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /referral/stats ----
  app.get('/referral/stats', async (request, reply) => {
    try {
      const wallet = request.query.wallet || '';
      if (!wallet || !isValidSolanaPublicKey(wallet)) {
        return reply.status(400).send({ ok: false, error: 'Valid wallet required' });
      }
      const stats = await deps.referralDbService.getStats(wallet);
      return reply.send({ ok: true, ...stats });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /referral/config ----
  app.get('/referral/config', async (request, reply) => {
    try {
      const config = await deps.referralDbService.getRewardConfig();
      return reply.send({ ok: true, config });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/referral-config ----
  app.get('/admin/referral-config', async (request, reply) => {
    try {
      const walletAddr = request.query.wallet || '';
      const ADMIN_WALLETS_RC = await getAdminWallets();
      if (ADMIN_WALLETS_RC.length > 0 && !ADMIN_WALLETS_RC.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const config = await deps.referralDbService.getRewardConfig();
      const adminStats = await deps.referralDbService.getAdminStats();
      const configHistory = await deps.referralDbService.getConfigHistory();
      return reply.send({ ok: true, config, stats: adminStats, configHistory });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/referral-config/proposals ----
  app.get('/admin/referral-config/proposals', async (request, reply) => {
    try {
      const walletAddr = request.query.wallet || '';
      const ADMIN_WALLETS_RCP = await getAdminWallets();
      if (ADMIN_WALLETS_RCP.length > 0 && !ADMIN_WALLETS_RCP.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const { query: dbQ } = require('./db/init');
      const result = await dbQ('SELECT * FROM referral_reward_proposals ORDER BY created_at DESC LIMIT 50');
      return reply.send({ ok: true, proposals: result.rows });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/referral-config/propose (+ alias /admin/squads/propose-referral-config) ----
  const handleProposeReferralConfig = async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || body.creator || '';
      const ADMIN_WALLETS_PRC = await getAdminWallets();
      if (ADMIN_WALLETS_PRC.length > 0 && !ADMIN_WALLETS_PRC.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.creator || !isValidSolanaPublicKey(body.creator)) {
        return reply.status(400).send({ ok: false, error: 'Valid creator required' });
      }
      const proposedReferrer = parseFloat(body.referrerReward);
      const proposedReferee = parseFloat(body.refereeReward);
      if (!Number.isFinite(proposedReferrer) || proposedReferrer < 0) {
        return reply.status(400).send({ ok: false, error: 'referrerReward must be a non-negative number' });
      }
      if (!Number.isFinite(proposedReferee) || proposedReferee < 0) {
        return reply.status(400).send({ ok: false, error: 'refereeReward must be a non-negative number' });
      }

      const currentConfig = await deps.referralDbService.getRewardConfig();

      const { PublicKey: PK } = require('@solana/web3.js');
      const memoIx = {
        programId: new PK('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        keys: [],
        data: Buffer.from(JSON.stringify({
          type: 'referral_config_change',
          referrerReward: proposedReferrer,
          refereeReward: proposedReferee,
        })),
      };

      if (body.multisigPda) deps.squadsService.setMultisig(body.multisigPda);

      const vtResult = await deps.squadsService.createVaultTransaction({
        creator: body.creator,
        instructions: [memoIx],
      });
      const propResult = await deps.squadsService.createProposal({
        creator: body.creator,
        transactionIndex: vtResult.transactionIndex,
      });

      const msState = await deps.squadsService.getMultisigState();
      const threshold = msState.threshold || 2;

      const { query: dbQ } = require('./db/init');
      try {
        await dbQ(
          `INSERT INTO referral_reward_proposals (transaction_index, proposed_referrer_reward, proposed_referee_reward, current_referrer_reward, current_referee_reward, creator, status, approvals, threshold, approved_by)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', 0, $7, '[]')
           ON CONFLICT (transaction_index) DO NOTHING`,
          [vtResult.transactionIndex, proposedReferrer, proposedReferee, currentConfig.referrerReward, currentConfig.refereeReward, body.creator, threshold]
        );
      } catch (dbErr) {
        console.warn('[DB] Failed to save referral config proposal:', dbErr.message);
      }

      broadcastSSE({ channel: 'referral_config_update', detail: 'proposal_created', ts: Date.now() });

      return reply.send(jsonSafe({
        ok: true,
        transactionIndex: vtResult.transactionIndex,
        vaultTransaction: vtResult.transaction,
        proposalTransaction: propResult.transaction,
        blockhash: propResult.blockhash,
        lastValidBlockHeight: propResult.lastValidBlockHeight,
      }));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  };
  app.post('/admin/referral-config/propose', handleProposeReferralConfig);
  app.post('/admin/squads/propose-referral-config', handleProposeReferralConfig);

  // ---- POST /admin/referral-config/proposals/update-status ----
  app.post('/admin/referral-config/proposals/update-status', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || '';
      const ADMIN_WALLETS_RCPU = await getAdminWallets();
      if (ADMIN_WALLETS_RCPU.length > 0 && !ADMIN_WALLETS_RCPU.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.transactionIndex) {
        return reply.status(400).send({ ok: false, error: 'transactionIndex required' });
      }
      const { query: dbQ } = require('./db/init');
      const existing = await dbQ('SELECT * FROM referral_reward_proposals WHERE transaction_index = $1', [body.transactionIndex]);
      if (!existing.rows.length) {
        return reply.status(404).send({ ok: false, error: 'Referral config proposal not found' });
      }
      const proposal = existing.rows[0];

      const msState = await deps.squadsService.getMultisigState();
      if (!msState.initialized) {
        return reply.status(400).send({ ok: false, error: 'Multisig not initialized' });
      }
      const memberKeys = (msState.members || []).map(m => typeof m === 'string' ? m : m.key || m.pubkey || '');
      if (!memberKeys.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Wallet is not a multisig member' });
      }

      const onChainState = await deps.squadsService.getProposalState(body.transactionIndex);
      if (!onChainState || !onChainState.ok) {
        return reply.status(502).send({ ok: false, error: 'Unable to verify on-chain proposal state. Please try again.' });
      }

      if (body.action === 'approve') {
        if (!onChainState.approvedMembers.includes(walletAddr)) {
          return reply.status(400).send({ ok: false, error: 'On-chain approval not found for this wallet. Please sign the approval transaction first.' });
        }
        const onChainApprovals = onChainState.approvedMembers;
        const newApprovals = onChainApprovals.length;
        const threshold = proposal.threshold || msState.threshold || 2;
        const newStatus = newApprovals >= threshold ? 'approved' : 'active';
        await dbQ(
          `UPDATE referral_reward_proposals SET approvals = $2, approved_by = $3::jsonb, status = $4, updated_at = NOW() WHERE transaction_index = $1`,
          [body.transactionIndex, newApprovals, JSON.stringify(onChainApprovals), newStatus]
        );
        broadcastSSE({ channel: 'referral_config_update', detail: 'proposal_approved', ts: Date.now() });
        return reply.send({ ok: true, approvals: newApprovals, approved_by: onChainApprovals, status: newStatus });
      }

      if (body.action === 'execute') {
        if (proposal.status === 'executed') {
          return reply.status(400).send({ ok: false, error: 'This proposal has already been executed' });
        }
        if (onChainState.status !== 'Executed') {
          return reply.status(400).send({ ok: false, error: `On-chain proposal status is "${onChainState.status}". The Squads execute transaction must be confirmed on-chain before config can be applied.` });
        }
        const onChainApprovers = onChainState.approvedMembers || [];
        const updateResult = await dbQ(
          `UPDATE referral_reward_proposals SET status = 'executed', execute_signature = $2, approvals = $3, approved_by = $4::jsonb, updated_at = NOW() WHERE transaction_index = $1 AND status != 'executed' RETURNING id`,
          [body.transactionIndex, body.execute_signature || '', onChainApprovers.length, JSON.stringify(onChainApprovers)]
        );
        if (!updateResult.rows.length) {
          return reply.status(400).send({ ok: false, error: 'This proposal has already been executed (concurrent request)' });
        }
        await dbQ(
          `INSERT INTO referral_config (referrer_reward, referee_reward, updated_by) VALUES ($1, $2, $3)`,
          [proposal.proposed_referrer_reward, proposal.proposed_referee_reward, walletAddr]
        );
        deps.referralDbService.invalidateConfigCache();
        broadcastSSE({ channel: 'referral_config_update', detail: 'config_updated', ts: Date.now() });
        return reply.send({ ok: true, status: 'executed', referrerReward: proposal.proposed_referrer_reward, refereeReward: proposal.proposed_referee_reward });
      }

      return reply.status(400).send({ ok: false, error: 'action must be "approve" or "execute"' });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- GET /admin/token-prices ----
  app.get('/admin/token-prices', async (request, reply) => {
    try {
      const walletAddr = request.query.wallet || '';
      const ADMIN_WALLETS_TP = await getAdminWallets();
      if (ADMIN_WALLETS_TP.length > 0 && !ADMIN_WALLETS_TP.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const { query: dbQ } = require('./db/init');
      const [pricesResult, proposalsResult] = await Promise.all([
        dbQ('SELECT * FROM token_buy_price_config ORDER BY token_symbol ASC'),
        dbQ('SELECT * FROM token_buy_price_proposals ORDER BY created_at DESC LIMIT 100'),
      ]);
      const ALL_SYMBOLS = ['NTC', 'ASDC', 'EDC', 'RDC', 'DMC', 'BDC', 'YDC', 'SDC', 'CDC', 'ADC', 'SGDC'];
      const priceMap = {};
      for (const row of pricesResult.rows) priceMap[row.token_symbol] = row;
      const prices = ALL_SYMBOLS.map(sym => priceMap[sym] || { token_symbol: sym, price_usd: null, updated_by: '', updated_at: null });
      return reply.send({ ok: true, prices, proposals: proposalsResult.rows });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/token-prices/propose ----
  app.post('/admin/token-prices/propose', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || body.creator || '';
      const ADMIN_WALLETS_TPP = await getAdminWallets();
      if (ADMIN_WALLETS_TPP.length > 0 && !ADMIN_WALLETS_TPP.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.creator || !isValidSolanaPublicKey(body.creator)) {
        return reply.status(400).send({ ok: false, error: 'Valid creator required' });
      }
      const VALID_SYMBOLS = ['NTC', 'ASDC', 'EDC', 'RDC', 'DMC', 'BDC', 'YDC', 'SDC', 'CDC', 'ADC', 'SGDC'];
      const tokenSymbol = (body.tokenSymbol || '').toUpperCase();
      if (!VALID_SYMBOLS.includes(tokenSymbol)) {
        return reply.status(400).send({ ok: false, error: `tokenSymbol must be one of: ${VALID_SYMBOLS.join(', ')}` });
      }
      const proposedPrice = parseFloat(body.priceUsd);
      if (!Number.isFinite(proposedPrice) || proposedPrice <= 0) {
        return reply.status(400).send({ ok: false, error: 'priceUsd must be a positive number' });
      }

      const { query: dbQ } = require('./db/init');
      const currentRow = await dbQ('SELECT price_usd FROM token_buy_price_config WHERE token_symbol = $1', [tokenSymbol]);
      const currentPrice = currentRow.rows[0]?.price_usd || 0;

      const { PublicKey: PK } = require('@solana/web3.js');
      const memoIx = {
        programId: new PK('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        keys: [],
        data: Buffer.from(JSON.stringify({
          type: 'token_buy_price_change',
          tokenSymbol,
          priceUsd: proposedPrice,
        })),
      };

      if (body.multisigPda) deps.squadsService.setMultisig(body.multisigPda);

      const vtResult = await deps.squadsService.createVaultTransaction({
        creator: body.creator,
        instructions: [memoIx],
      });
      const propResult = await deps.squadsService.createProposal({
        creator: body.creator,
        transactionIndex: vtResult.transactionIndex,
      });

      return reply.send(jsonSafe({
        ok: true,
        transactionIndex: vtResult.transactionIndex,
        vaultTransaction: vtResult.transaction,
        proposalTransaction: propResult.transaction,
        blockhash: propResult.blockhash,
        lastValidBlockHeight: propResult.lastValidBlockHeight,
        currentPrice,
      }));
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/token-prices/proposals/update-status ----
  app.post('/admin/token-prices/proposals/update-status', async (request, reply) => {
    try {
      const body = request.body || {};
      const walletAddr = body.userPubkey || '';
      const ADMIN_WALLETS_TPPU = await getAdminWallets();
      if (ADMIN_WALLETS_TPPU.length > 0 && !ADMIN_WALLETS_TPPU.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      if (!body.transactionIndex) {
        return reply.status(400).send({ ok: false, error: 'transactionIndex required' });
      }
      const { query: dbQ } = require('./db/init');

      if (body.action === 'propose_signature') {
        if (!body.propose_signature) {
          return reply.status(400).send({ ok: false, error: 'propose_signature required' });
        }
        const VALID_SYMBOLS_TPP = ['NTC', 'ASDC', 'EDC', 'RDC', 'DMC', 'BDC', 'YDC', 'SDC', 'CDC', 'ADC', 'SGDC'];
        const tokenSymbolTPP = (body.tokenSymbol || '').toUpperCase();
        if (!VALID_SYMBOLS_TPP.includes(tokenSymbolTPP)) {
          return reply.status(400).send({ ok: false, error: `tokenSymbol must be one of: ${VALID_SYMBOLS_TPP.join(', ')}` });
        }
        const proposedPriceTPP = parseFloat(body.proposedPrice);
        if (!Number.isFinite(proposedPriceTPP) || proposedPriceTPP <= 0) {
          return reply.status(400).send({ ok: false, error: 'proposedPrice must be a positive number' });
        }
        const creatorTPP = body.creator || walletAddr;
        if (!creatorTPP || !isValidSolanaPublicKey(creatorTPP)) {
          return reply.status(400).send({ ok: false, error: 'Valid creator required' });
        }
        const sigStatuses = await deps.connection.getSignatureStatuses([body.propose_signature], { searchTransactionHistory: true });
        const sigStatus = sigStatuses?.value?.[0];
        if (!sigStatus) {
          return reply.status(502).send({ ok: false, error: 'Proposal signature not found on-chain. Please wait for confirmation and try again.' });
        }
        if (sigStatus.err) {
          return reply.status(400).send({ ok: false, error: `Proposal transaction failed on-chain: ${JSON.stringify(sigStatus.err)}` });
        }
        if (sigStatus.confirmationStatus !== 'confirmed' && sigStatus.confirmationStatus !== 'finalized') {
          return reply.status(502).send({ ok: false, error: 'Proposal transaction not yet confirmed on-chain. Please wait a moment and try again.' });
        }
        let onChainStateTPP = null;
        for (let _retry = 0; _retry < 4; _retry++) {
          if (_retry > 0) await new Promise(r => setTimeout(r, 2000));
          const attempt = await deps.squadsService.getProposalState(body.transactionIndex);
          if (attempt && attempt.ok) { onChainStateTPP = attempt; break; }
        }
        if (!onChainStateTPP || !onChainStateTPP.ok) {
          return reply.status(502).send({ ok: false, error: 'Unable to verify on-chain proposal state. Transaction may not have confirmed yet — please try again shortly.' });
        }
        const msStateTPP = await deps.squadsService.getMultisigState();
        const thresholdTPP = msStateTPP.threshold || 2;
        const currentPriceTPP = parseFloat(body.currentPrice) || 0;
        await dbQ(
          `INSERT INTO token_buy_price_proposals (transaction_index, token_symbol, proposed_price, current_price, creator, status, approvals, threshold, approved_by, propose_signature)
           VALUES ($1, $2, $3, $4, $5, 'active', 0, $6, '[]', $7)
           ON CONFLICT (transaction_index) DO UPDATE SET propose_signature = EXCLUDED.propose_signature, updated_at = NOW()`,
          [body.transactionIndex, tokenSymbolTPP, proposedPriceTPP, currentPriceTPP, creatorTPP, thresholdTPP, body.propose_signature]
        );
        broadcastSSE({ channel: 'token_prices_update', detail: 'proposal_created', ts: Date.now() });
        return reply.send({ ok: true });
      }

      const existing = await dbQ('SELECT * FROM token_buy_price_proposals WHERE transaction_index = $1', [body.transactionIndex]);
      if (!existing.rows.length) {
        return reply.status(404).send({ ok: false, error: 'Token price proposal not found' });
      }
      const proposal = existing.rows[0];

      const msState = await deps.squadsService.getMultisigState();
      if (!msState.initialized) {
        return reply.status(400).send({ ok: false, error: 'Multisig not initialized' });
      }
      const memberKeys = (msState.members || []).map(m => typeof m === 'string' ? m : m.key || m.pubkey || '');
      if (!memberKeys.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Wallet is not a multisig member' });
      }

      const onChainState = await deps.squadsService.getProposalState(body.transactionIndex);
      if (!onChainState || !onChainState.ok) {
        return reply.status(502).send({ ok: false, error: 'Unable to verify on-chain proposal state. Please try again.' });
      }

      if (body.action === 'approve') {
        if (!onChainState.approvedMembers.includes(walletAddr)) {
          return reply.status(400).send({ ok: false, error: 'On-chain approval not found for this wallet. Please sign the approval transaction first.' });
        }
        const onChainApprovals = onChainState.approvedMembers;
        const newApprovals = onChainApprovals.length;
        const threshold = proposal.threshold || msState.threshold || 2;
        const newStatus = newApprovals >= threshold ? 'approved' : 'active';
        let existingSigs = [];
        try { existingSigs = Array.isArray(proposal.approve_signatures) ? proposal.approve_signatures : JSON.parse(proposal.approve_signatures || '[]'); } catch { existingSigs = []; }
        if (body.approve_signature && !existingSigs.find(s => s.wallet === walletAddr)) {
          existingSigs.push({ wallet: walletAddr, signature: body.approve_signature });
        }
        await dbQ(
          `UPDATE token_buy_price_proposals SET approvals = $2, approved_by = $3::jsonb, status = $4, approve_signatures = $5::jsonb, updated_at = NOW() WHERE transaction_index = $1`,
          [body.transactionIndex, newApprovals, JSON.stringify(onChainApprovals), newStatus, JSON.stringify(existingSigs)]
        );
        broadcastSSE({ channel: 'token_prices_update', detail: 'proposal_approved', ts: Date.now() });
        return reply.send({ ok: true, approvals: newApprovals, approved_by: onChainApprovals, status: newStatus });
      }

      if (body.action === 'execute') {
        if (proposal.status === 'executed') {
          return reply.status(400).send({ ok: false, error: 'This proposal has already been executed' });
        }
        if (onChainState.status !== 'Executed') {
          return reply.status(400).send({ ok: false, error: `On-chain proposal status is "${onChainState.status}". The Squads execute transaction must be confirmed on-chain before price can be applied.` });
        }
        const onChainApprovers = onChainState.approvedMembers || [];
        const updateResult = await dbQ(
          `UPDATE token_buy_price_proposals SET status = 'executed', execute_signature = $2, approvals = $3, approved_by = $4::jsonb, updated_at = NOW() WHERE transaction_index = $1 AND status != 'executed' RETURNING id`,
          [body.transactionIndex, body.execute_signature || '', onChainApprovers.length, JSON.stringify(onChainApprovers)]
        );
        if (!updateResult.rows.length) {
          return reply.status(400).send({ ok: false, error: 'This proposal has already been executed (concurrent request)' });
        }
        await dbQ(
          `INSERT INTO token_buy_price_config (token_symbol, price_usd, updated_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (token_symbol) DO UPDATE SET price_usd = EXCLUDED.price_usd, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [proposal.token_symbol, proposal.proposed_price, walletAddr]
        );
        broadcastSSE({ channel: 'token_prices_update', detail: 'price_updated', ts: Date.now() });
        return reply.send({ ok: true, status: 'executed', tokenSymbol: proposal.token_symbol, priceUsd: proposal.proposed_price });
      }

      return reply.status(400).send({ ok: false, error: 'action must be "approve", "execute", or "propose_signature"' });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- POST /admin/referral/retry-payouts ----
  app.post('/admin/referral/retry-payouts', async (request, reply) => {
    try {
      const { wallet } = request.body || {};
      const ADMIN_WALLETS_RP = await getAdminWallets();
      if (ADMIN_WALLETS_RP.length > 0 && !ADMIN_WALLETS_RP.includes(wallet)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const results = await deps.referralDbService.retryFailedPayouts();
      return reply.send({ ok: true, results });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- MoonPay transaction tracking ----
  app.post('/moonpay/transaction', async (request, reply) => {
    try {
      const { userWallet, cryptoCurrency, fiatCurrency, amountFiat, amountCrypto, moonpayTransactionId, widgetUrl, type, tokenPrice, txSignature } = request.body || {};
      if (!userWallet || typeof userWallet !== 'string' || userWallet.length < 32 || userWallet.length > 64) return reply.status(400).send({ ok: false, error: 'Valid userWallet required' });
      if (amountFiat !== undefined && (typeof amountFiat !== 'number' || amountFiat < 0)) return reply.status(400).send({ ok: false, error: 'amountFiat must be a non-negative number' });
      const txType = (type === 'sell') ? 'sell' : 'buy';
      const crypto = require('crypto');
      const updateToken = crypto.randomBytes(32).toString('hex');
      const s = require('./db/init').getSql();
      const row = await s`
        INSERT INTO moonpay_transactions (user_wallet, update_token, type, crypto_currency, fiat_currency, amount_fiat, amount_crypto, token_price, tx_signature, moonpay_transaction_id, widget_url)
        VALUES (${userWallet}, ${updateToken}, ${txType}, ${cryptoCurrency || ''}, ${fiatCurrency || 'USD'}, ${amountFiat || 0}, ${amountCrypto || 0}, ${parseFloat(tokenPrice) || 0}, ${txSignature || ''}, ${moonpayTransactionId || ''}, ${widgetUrl || ''})
        RETURNING id, user_wallet, update_token, type, moonpay_transaction_id, status, crypto_currency, fiat_currency, amount_fiat, amount_crypto, token_price, tx_signature, moonpay_status, widget_url, created_at, updated_at`;
      return reply.send({ ok: true, transaction: row[0] });
    } catch (e) {
      console.error('[MoonPay] create tx error:', e.message);
      return reply.status(500).send({ ok: false, error: 'Transaction creation failed' });
    }
  });

  app.patch('/moonpay/transaction/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(id)) return reply.status(400).send({ ok: false, error: 'Invalid transaction ID' });
      const { status, moonpayTransactionId, moonpayStatus, amountCrypto, txSignature, updateToken } = request.body || {};
      if (!updateToken) return reply.status(401).send({ ok: false, error: 'updateToken required' });
      const ALLOWED_STATUSES = ['pending', 'widget_opened', 'widget_closed', 'completed', 'failed', 'swap_rejected', 'swap_failed', 'processing'];
      if (status && !ALLOWED_STATUSES.includes(status)) return reply.status(400).send({ ok: false, error: 'Invalid status' });
      const safeMoonpayStatus = moonpayStatus || null;
      const s = require('./db/init').getSql();
      const row = await s`
        UPDATE moonpay_transactions SET
          status = COALESCE(${status || null}, status),
          moonpay_transaction_id = COALESCE(${moonpayTransactionId || null}, moonpay_transaction_id),
          moonpay_status = COALESCE(${safeMoonpayStatus}, moonpay_status),
          amount_crypto = COALESCE(${amountCrypto !== undefined ? amountCrypto : null}, amount_crypto),
          tx_signature = COALESCE(${txSignature || null}, tx_signature),
          updated_at = NOW()
        WHERE id = ${id} AND update_token = ${updateToken}
        RETURNING id, user_wallet, type, moonpay_transaction_id, status, crypto_currency, fiat_currency, amount_fiat, amount_crypto, token_price, tx_signature, moonpay_status, widget_url, created_at, updated_at`;
      if (row.length === 0) return reply.status(403).send({ ok: false, error: 'Forbidden' });
      return reply.send({ ok: true, transaction: row[0] });
    } catch (e) {
      console.error('[MoonPay] update tx error:', e.message);
      return reply.status(500).send({ ok: false, error: 'Update failed' });
    }
  });

  app.get('/moonpay/transactions/:walletAddress', async (request, reply) => {
    try {
      const { walletAddress } = request.params;
      if (!walletAddress || walletAddress.length < 32 || walletAddress.length > 64) return reply.status(400).send({ ok: false, error: 'Invalid wallet address' });
      const limit = Math.min(Math.max(parseInt(request.query.limit) || 50, 1), 100);
      const offset = Math.max(parseInt(request.query.offset) || 0, 0);
      const s = require('./db/init').getSql();
      const rows = await s`
        SELECT id, user_wallet, type, moonpay_transaction_id, status, crypto_currency, fiat_currency, amount_fiat, amount_crypto, token_price, tx_signature, moonpay_status, widget_url, created_at, updated_at
        FROM moonpay_transactions
        WHERE user_wallet = ${walletAddress}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}`;
      return reply.send({ ok: true, transactions: rows });
    } catch (e) {
      console.error('[MoonPay] list tx error:', e.message);
      return reply.status(500).send({ ok: false, error: 'Failed to fetch transactions' });
    }
  });

  app.get('/moonpay/treasury-vault', async (request, reply) => {
    try {
      return reply.send({ ok: true, vaultAddress: treasuryPubkey });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: 'Failed to get treasury vault' });
    }
  });

  app.post('/moonpay/transfer/build', async (request, reply) => {
    try {
      const { userPubkey, tokenMint, amount } = request.body || {};
      if (!userPubkey || !tokenMint || !amount) {
        return reply.status(400).send({ ok: false, error: 'userPubkey, tokenMint, and amount are required' });
      }
      const parsedAmount = parseFloat(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return reply.status(400).send({ ok: false, error: 'amount must be a positive number' });
      }
      if (!treasuryPubkey) {
        return reply.status(500).send({ ok: false, error: 'Treasury vault not configured' });
      }

      const splToken = require('@solana/spl-token');
      const userPk = new PublicKey(userPubkey);
      const mintPk = new PublicKey(tokenMint);
      const vaultPk = new PublicKey(treasuryPubkey);

      const mintAcct = await connection.getAccountInfo(mintPk);
      if (!mintAcct) {
        return reply.status(400).send({ ok: false, error: 'Invalid token mint' });
      }
      const tokenProgram = mintAcct.owner.toBase58() === splToken.TOKEN_2022_PROGRAM_ID.toBase58()
        ? splToken.TOKEN_2022_PROGRAM_ID
        : splToken.TOKEN_PROGRAM_ID;

      const mintInfo = splToken.MintLayout.decode(mintAcct.data);
      const tokenDecimals = mintInfo.decimals;
      const rawAmount = BigInt(Math.round(parsedAmount * Math.pow(10, tokenDecimals)));

      const userAta = splToken.getAssociatedTokenAddressSync(mintPk, userPk, false, tokenProgram);
      const vaultAta = splToken.getAssociatedTokenAddressSync(mintPk, vaultPk, true, tokenProgram);

      const instructions = [];

      const vaultAtaInfo = await connection.getAccountInfo(vaultAta);
      if (!vaultAtaInfo) {
        instructions.push(
          splToken.createAssociatedTokenAccountIdempotentInstruction(
            userPk, vaultAta, vaultPk, mintPk, tokenProgram
          )
        );
      }

      instructions.push(
        splToken.createTransferCheckedInstruction(
          userAta, mintPk, vaultAta, userPk, rawAmount, tokenDecimals, [], tokenProgram
        )
      );

      const { ComputeBudgetProgram, TransactionMessage, VersionedTransaction: VTx } = require('@solana/web3.js');
      const computeIxs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      ];
      const allIxs = [...computeIxs, ...instructions];
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const messageV0 = new TransactionMessage({
        payerKey: userPk,
        recentBlockhash: blockhash,
        instructions: allIxs,
      }).compileToV0Message();
      const tx = new VTx(messageV0);
      const base64 = Buffer.from(tx.serialize()).toString('base64');

      return reply.send({
        ok: true,
        transaction: base64,
        blockhash,
        lastValidBlockHeight,
        summary: {
          type: 'transferToVault',
          tokenMint,
          amount: parseFloat(amount),
          vaultAddress: treasuryPubkey,
        },
      });
    } catch (e) {
      console.error('[MoonPay] transfer/build error:', e.message);
      return reply.status(500).send({ ok: false, error: e.message || 'Failed to build transfer' });
    }
  });

  // ---- GET /chart/stream (SSE) ----
  app.get('/chart/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.write('data: {"connected":true}\n\n');
    sseClients.push(reply.raw);
    request.raw.on('close', () => {
      const idx = sseClients.indexOf(reply.raw);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
    reply.hijack();
  });

  // ---- NOWPayments: GET /buy/currencies ----
  app.get('/buy/currencies', async (request, reply) => {
    try {
      const currencies = await nowPaymentsService.getCurrencies();
      return reply.send({ ok: true, currencies });
    } catch (e) {
      console.error('[NOWPayments] getCurrencies error:', e.message);
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- NOWPayments: GET /buy/estimate ----
  app.get('/buy/estimate', async (request, reply) => {
    try {
      const { ntcAmount, dollarAmount, payCurrency, tokenSymbol } = request.query || {};
      if ((!ntcAmount && !dollarAmount) || !payCurrency) {
        return reply.status(400).send({ ok: false, error: 'dollarAmount (or ntcAmount) and payCurrency are required' });
      }

      const receiveToken = (tokenSymbol || 'NTC').toUpperCase();
      const tokenPriceUsd = await nowPaymentsService.getNtcPriceUsd(receiveToken);
      if (!tokenPriceUsd || tokenPriceUsd <= 0) {
        return reply.status(503).send({ ok: false, error: `${receiveToken} price not available` });
      }

      let totalUsd, ntcTokens;
      if (dollarAmount) {
        totalUsd = parseFloat(dollarAmount);
        ntcTokens = tokenPriceUsd > 0 ? totalUsd / tokenPriceUsd : 0;
      } else {
        ntcTokens = parseFloat(ntcAmount);
        totalUsd = ntcTokens * tokenPriceUsd;
      }

      if (totalUsd <= 0) {
        return reply.status(400).send({ ok: false, error: 'Invalid amount' });
      }

      const MIN_USD = 1;
      if (totalUsd < MIN_USD) {
        return reply.status(400).send({ ok: false, error: `Minimum purchase is $${MIN_USD} USD` });
      }

      const cur = payCurrency.toLowerCase();
      let minPayAmount = 0;
      let minNtcAmount = 0;
      let minUsdAmount = 0;
      try {
        const minData = await nowPaymentsService.getMinPaymentAmount(cur, 'usd');
        minPayAmount = parseFloat(minData.min_amount) || 0;
        if (minPayAmount > 0) {
          const minEstimate = await nowPaymentsService.getEstimate({ amountUsd: 1, currencyFrom: 'usd', currencyTo: cur });
          const ratePerUsd = parseFloat(minEstimate.estimated_amount) || 0;
          if (ratePerUsd > 0) {
            minUsdAmount = minPayAmount / ratePerUsd;
            minNtcAmount = Math.ceil(minUsdAmount / tokenPriceUsd);
          }
        }
      } catch (_) {}

      const estimate = await nowPaymentsService.getEstimate({
        amountUsd: totalUsd,
        currencyFrom: 'usd',
        currencyTo: cur,
      });

      const estAmount = parseFloat(estimate.estimated_amount) || 0;
      const belowMinimum = minPayAmount > 0 && estAmount < minPayAmount;

      return reply.send({
        ok: true,
        ntcAmount: ntcTokens,
        tokenSymbol: receiveToken,
        ntcPriceUsd: tokenPriceUsd,
        totalUsd,
        payCurrency: cur,
        estimatedPayAmount: estimate.estimated_amount,
        minPayAmount,
        minNtcAmount: minNtcAmount || 0,
        minUsdAmount: minUsdAmount || 0,
        belowMinimum,
      });
    } catch (e) {
      console.error('[NOWPayments] estimate error:', e.message);
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- NOWPayments: POST /buy/create-payment ----
  app.post('/buy/create-payment', async (request, reply) => {
    try {
      const { wallet: userWallet, ntcAmount, dollarAmount, payCurrency, tokenSymbol } = request.body || {};
      if (!userWallet || (!ntcAmount && !dollarAmount) || !payCurrency) {
        return reply.status(400).send({ ok: false, error: 'wallet, dollarAmount (or ntcAmount), and payCurrency are required' });
      }

      if (!isValidSolanaPublicKey(userWallet)) {
        return reply.status(400).send({ ok: false, error: 'Invalid wallet address' });
      }

      const receiveToken = (tokenSymbol || 'NTC').toUpperCase();
      const ntcPriceUsd = await nowPaymentsService.getNtcPriceUsd(receiveToken);
      if (!ntcPriceUsd || ntcPriceUsd <= 0) {
        return reply.status(503).send({ ok: false, error: `${receiveToken} price not available` });
      }

      let totalUsd, computedNtcAmount;
      if (dollarAmount) {
        totalUsd = parseFloat(dollarAmount);
        computedNtcAmount = ntcPriceUsd > 0 ? totalUsd / ntcPriceUsd : 0;
      } else {
        computedNtcAmount = parseFloat(ntcAmount);
        totalUsd = computedNtcAmount * ntcPriceUsd;
      }

      const MIN_USD = 1;
      if (totalUsd < MIN_USD) {
        return reply.status(400).send({ ok: false, error: `Minimum purchase is $${MIN_USD} USD` });
      }

      if (totalUsd <= 0) {
        return reply.status(400).send({ ok: false, error: 'Invalid amount' });
      }

      const cur = payCurrency.toLowerCase();
      try {
        const minData = await nowPaymentsService.getMinPaymentAmount(cur, 'usd');
        const minPay = parseFloat(minData.min_amount) || 0;
        if (minPay > 0) {
          const est = await nowPaymentsService.getEstimate({ amountUsd: totalUsd, currencyFrom: 'usd', currencyTo: cur });
          const estPay = parseFloat(est.estimated_amount) || 0;
          if (estPay < minPay) {
            const minEstRate = await nowPaymentsService.getEstimate({ amountUsd: 1, currencyFrom: 'usd', currencyTo: cur });
            const ratePerUsd = parseFloat(minEstRate.estimated_amount) || 0;
            const minUsd = ratePerUsd > 0 ? minPay / ratePerUsd : 0;
            const minNtc = Math.ceil(minUsd / ntcPriceUsd);
            return reply.status(400).send({
              ok: false,
              error: `Minimum purchase is ${minNtc} NTC (~$${minUsd.toFixed(2)}) for ${cur.toUpperCase()} payments`,
              minNtcAmount: minNtc,
            });
          }
        }
      } catch (_) {}

      const ipnUrl = process.env.APP_URL
        ? `${process.env.APP_URL.replace(/\/$/, '')}/api/ipn`
        : 'https://cryptoniteswap.xyz/api/ipn';

      const s = require('./db/init').getSql();
      const [row] = await s`
        INSERT INTO token_purchases (user_wallet, ntc_amount, price_usd, pay_currency, token_symbol, status)
        VALUES (${userWallet}, ${computedNtcAmount}, ${totalUsd}, ${cur}, ${receiveToken}, 'pending')
        RETURNING id
      `;

      const payment = await nowPaymentsService.createPayment({
        priceAmount: totalUsd,
        priceCurrency: 'usd',
        payCurrency: payCurrency.toLowerCase(),
        orderId: row.id,
        orderDescription: `Buy ${computedNtcAmount.toFixed(2)} ${receiveToken} tokens`,
        ipnCallbackUrl: ipnUrl,
      });

      await s`
        UPDATE token_purchases
        SET nowpayments_id = ${payment.payment_id},
            nowpayments_status = ${payment.payment_status || 'waiting'},
            pay_amount = ${payment.pay_amount || 0},
            pay_address = ${payment.pay_address || ''},
            updated_at = NOW()
        WHERE id = ${row.id}
      `;

      console.log(`[NOWPayments] Payment created: ${payment.payment_id} for ${computedNtcAmount.toFixed(4)} ${receiveToken} ($${totalUsd.toFixed(2)}) wallet=${userWallet}`);

      return reply.send({
        ok: true,
        purchaseId: row.id,
        paymentId: payment.payment_id,
        payAddress: payment.pay_address,
        payAmount: payment.pay_amount,
        payCurrency: payment.pay_currency,
        status: payment.payment_status,
        ntcAmount: computedNtcAmount,
        tokenSymbol: receiveToken,
        totalUsd,
      });
    } catch (e) {
      console.error('[NOWPayments] createPayment error:', e.message);
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- NOWPayments: GET /buy/payment-status/:id ----
  app.get('/buy/payment-status/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const s = require('./db/init').getSql();

      const [purchase] = await s`
        SELECT id, user_wallet, ntc_amount, price_usd, pay_currency, pay_amount,
               nowpayments_id, nowpayments_status, pay_address, status,
               ntc_tx_signature, pay_tx_hash, created_at, updated_at
        FROM token_purchases WHERE id = ${id}
      `;

      if (!purchase) {
        return reply.status(404).send({ ok: false, error: 'Purchase not found' });
      }

      if (purchase.status === 'sending' && purchase.nowpayments_status === 'finished' && !purchase.ntc_tx_signature) {
        const stuckMinutes = (Date.now() - new Date(purchase.updated_at).getTime()) / 60000;
        if (stuckMinutes > 2) {
          console.log(`[NOWPayments] Recovering stuck 'sending' purchase ${id} (stuck ${stuckMinutes.toFixed(1)}m)`);
          const sym = purchase.token_symbol || 'NTC';
          let alreadySent = false;
          try {
            const splToken = require('@solana/spl-token');
            const mintAddr = await getTokenMint(sym);
            if (mintAddr) {
              const mintPk = new PublicKey(mintAddr);
              const mintAcct = await connection.getAccountInfo(mintPk);
              const tokenProgram = mintAcct && mintAcct.owner.toBase58() === splToken.TOKEN_2022_PROGRAM_ID.toBase58()
                ? splToken.TOKEN_2022_PROGRAM_ID : splToken.TOKEN_PROGRAM_ID;
              const serverAta = splToken.getAssociatedTokenAddressSync(mintPk, wallet.publicKey, false, tokenProgram);
              const recentSigs = await connection.getSignaturesForAddress(serverAta, { limit: 10 });
              const cutoff = new Date(purchase.updated_at).getTime() - 120000;
              for (const sigInfo of recentSigs) {
                if (sigInfo.blockTime && sigInfo.blockTime * 1000 > cutoff && !sigInfo.err) {
                  const tx = await connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
                  if (tx && tx.meta && !tx.meta.err) {
                    const recipientPk = purchase.user_wallet;
                    const recipientAta = splToken.getAssociatedTokenAddressSync(mintPk, new PublicKey(recipientPk), false, tokenProgram).toBase58();
                    const hasTransfer = (tx.transaction.message.instructions || []).some(ix =>
                      ix.parsed && ix.parsed.type === 'transferChecked' &&
                      ix.parsed.info && ix.parsed.info.destination === recipientAta
                    );
                    if (hasTransfer) {
                      console.log(`[NOWPayments] Found existing on-chain transfer for ${id}: ${sigInfo.signature}`);
                      await s`UPDATE token_purchases SET status = 'completed', ntc_tx_signature = ${sigInfo.signature}, updated_at = NOW() WHERE id = ${id}`;
                      purchase.status = 'completed';
                      purchase.ntc_tx_signature = sigInfo.signature;
                      alreadySent = true;
                      break;
                    }
                  }
                }
              }
            }
          } catch (chainErr) {
            console.warn(`[NOWPayments] Chain check failed for stuck purchase ${id}:`, chainErr.message);
          }
          if (!alreadySent) {
            const [locked] = await s`
              UPDATE token_purchases SET updated_at = NOW()
              WHERE id = ${id} AND status = 'sending' AND ntc_tx_signature = ''
              RETURNING id, user_wallet, ntc_amount, token_symbol
            `;
            if (locked) {
              try {
                const txSig = await sendTokenToUser(connection, wallet, locked.user_wallet, locked.ntc_amount, locked.token_symbol);
                await s`UPDATE token_purchases SET status = 'completed', ntc_tx_signature = ${txSig}, updated_at = NOW() WHERE id = ${id}`;
                purchase.status = 'completed';
                purchase.ntc_tx_signature = txSig;
                console.log(`[NOWPayments] ${locked.token_symbol || 'NTC'} sent (retry): ${locked.ntc_amount} to ${locked.user_wallet} tx=${txSig}`);
              } catch (err) {
                const failReason = err.message || 'Unknown error';
                console.error(`[NOWPayments] NTC send retry failed for ${id}:`, failReason);
                await s`UPDATE token_purchases SET status = 'send_failed', nowpayments_status = ${failReason.substring(0, 32)}, updated_at = NOW() WHERE id = ${id}`;
                purchase.status = 'send_failed';
              }
            }
          }
        }
      }

      if (purchase.nowpayments_id && !['completed', 'failed', 'sending'].includes(purchase.status)) {
        try {
          const live = await nowPaymentsService.getPaymentStatus(purchase.nowpayments_id);
          if (live.payment_status && live.payment_status !== purchase.nowpayments_status) {
            await s`
              UPDATE token_purchases
              SET nowpayments_status = ${live.payment_status}, updated_at = NOW()
              WHERE id = ${id}
            `;
            purchase.nowpayments_status = live.payment_status;
          }

          if (live.payment_status === 'finished' && !['sending', 'completed'].includes(purchase.status)) {
            const paidVal = parseFloat(live.actually_paid || live.pay_amount) || 0;
            const expectedPay = parseFloat(purchase.pay_amount) || 0;
            const TOLERANCE = 0.95;

            if (expectedPay > 0 && paidVal < expectedPay * TOLERANCE) {
              await s`UPDATE token_purchases SET status = 'underpaid', updated_at = NOW() WHERE id = ${id}`;
              purchase.status = 'underpaid';
            } else {
              const [locked] = await s`
                UPDATE token_purchases
                SET nowpayments_status = 'finished',
                    pay_amount = CASE WHEN ${paidVal}::double precision > 0 THEN ${paidVal}::double precision ELSE pay_amount END,
                    status = 'sending',
                    confirmed_at = COALESCE(confirmed_at, NOW()),
                    sent_at = NOW(),
                    updated_at = NOW()
                WHERE id = ${id} AND status NOT IN ('sending', 'completed')
                RETURNING id, user_wallet, ntc_amount, token_symbol
              `;

              if (locked) {
                purchase.status = 'sending';
                (async () => {
                  try {
                    const txSig = await sendTokenToUser(connection, wallet, locked.user_wallet, locked.ntc_amount, locked.token_symbol);
                    await s`
                      UPDATE token_purchases
                      SET status = 'completed', ntc_tx_signature = ${txSig}, updated_at = NOW()
                      WHERE id = ${id}
                    `;
                    console.log(`[NOWPayments] ${locked.token_symbol || 'NTC'} sent (poll): ${locked.ntc_amount} to ${locked.user_wallet} tx=${txSig}`);
                  } catch (err) {
                    const failReason = err.message || 'Unknown error';
                    console.error(`[NOWPayments] NTC send failed (poll) for ${id}:`, failReason);
                    await s`UPDATE token_purchases SET status = 'send_failed', nowpayments_status = ${failReason.substring(0, 32)}, updated_at = NOW() WHERE id = ${id}`;
                  }
                })();
              }
            }
          }
        } catch (_) {}
      }

      return reply.send({ ok: true, purchase });
    } catch (e) {
      console.error('[NOWPayments] paymentStatus error:', e.message);
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- NOWPayments: POST /buy/ipn (IPN webhook) ----
  app.post('/buy/ipn', async (request, reply) => {
    try {
      const hmacHeader = request.headers['x-nowpayments-sig'];
      const body = request.body;

      if (!nowPaymentsService.verifyIpn(body, hmacHeader)) {
        console.warn('[NOWPayments IPN] Invalid signature');
        return reply.status(403).send({ ok: false, error: 'Invalid IPN signature' });
      }

      const {
        payment_id,
        payment_status,
        order_id,
        actually_paid,
        pay_currency,
        outcome_amount,
        outcome_currency,
      } = body;

      console.log(`[NOWPayments IPN] payment_id=${payment_id} status=${payment_status} order=${order_id} paid=${actually_paid} ${pay_currency}`);

      const s = require('./db/init').getSql();

      const [purchase] = await s`
        SELECT id, user_wallet, ntc_amount, pay_amount, pay_currency, status, ntc_tx_signature
        FROM token_purchases WHERE id = ${order_id}
      `;

      if (!purchase) {
        console.warn(`[NOWPayments IPN] No purchase found for order ${order_id}`);
        return reply.send({ ok: true });
      }

      const terminalFailStatuses = ['expired', 'refunded', 'failed'];
      const isTerminalFail = terminalFailStatuses.includes(payment_status);
      const isConfirming = payment_status === 'confirming' || payment_status === 'partially_paid';
      const isConfirmed = payment_status === 'confirmed';
      const isFinished = payment_status === 'finished';

      const paidVal = parseFloat(actually_paid) || 0;

      if (isTerminalFail) {
        await s`
          UPDATE token_purchases
          SET nowpayments_status = ${payment_status},
              nowpayments_id = ${String(payment_id)},
              pay_amount = CASE WHEN ${paidVal}::double precision > 0 THEN ${paidVal}::double precision ELSE pay_amount END,
              status = 'failed',
              updated_at = NOW()
          WHERE id = ${order_id}
        `;
      } else if (isConfirming) {
        await s`
          UPDATE token_purchases
          SET nowpayments_status = ${payment_status},
              nowpayments_id = ${String(payment_id)},
              pay_amount = CASE WHEN ${paidVal}::double precision > 0 THEN ${paidVal}::double precision ELSE pay_amount END,
              status = 'confirming',
              updated_at = NOW()
          WHERE id = ${order_id} AND status NOT IN ('confirmed', 'sending', 'completed')
        `;
      } else if (isConfirmed || isFinished) {
        const expectedPay = parseFloat(purchase.pay_amount) || 0;
        const TOLERANCE = 0.95;

        if (expectedPay > 0 && paidVal < expectedPay * TOLERANCE) {
          console.warn(`[NOWPayments IPN] Underpayment for ${order_id}: paid=${paidVal}, expected=${expectedPay} ${purchase.pay_currency}`);
          await s`
            UPDATE token_purchases
            SET nowpayments_status = ${payment_status},
                nowpayments_id = ${String(payment_id)},
                pay_amount = CASE WHEN ${paidVal}::double precision > 0 THEN ${paidVal}::double precision ELSE pay_amount END,
                status = 'underpaid',
                updated_at = NOW()
            WHERE id = ${order_id}
          `;
        } else {
          if (isConfirmed && !isFinished) {
            await s`
              UPDATE token_purchases
              SET nowpayments_status = ${payment_status},
                  nowpayments_id = ${String(payment_id)},
                  pay_amount = CASE WHEN ${paidVal}::double precision > 0 THEN ${paidVal}::double precision ELSE pay_amount END,
                  status = 'confirmed',
                  updated_at = NOW()
              WHERE id = ${order_id} AND status NOT IN ('sending', 'completed')
            `;
          }

          if (isFinished) {
            const [locked] = await s`
              UPDATE token_purchases
              SET nowpayments_status = ${payment_status},
                  nowpayments_id = ${String(payment_id)},
                  pay_amount = CASE WHEN ${paidVal}::double precision > 0 THEN ${paidVal}::double precision ELSE pay_amount END,
                  status = 'sending',
                  confirmed_at = COALESCE(confirmed_at, NOW()),
                  sent_at = NOW(),
                  updated_at = NOW()
              WHERE id = ${order_id} AND status NOT IN ('sending', 'completed')
              RETURNING id, user_wallet, ntc_amount, token_symbol
            `;

            if (locked) {
              (async () => {
                try {
                  const txSig = await sendTokenToUser(connection, wallet, locked.user_wallet, locked.ntc_amount, locked.token_symbol);
                  await s`
                    UPDATE token_purchases
                    SET status = 'completed', ntc_tx_signature = ${txSig}, updated_at = NOW()
                    WHERE id = ${order_id}
                  `;
                  console.log(`[NOWPayments] ${locked.token_symbol || 'NTC'} sent: ${locked.ntc_amount} to ${locked.user_wallet} tx=${txSig}`);
                } catch (err) {
                  const failReason = err.message || 'Unknown error';
                  console.error(`[NOWPayments] NTC send failed for ${order_id}:`, failReason);
                  await s`UPDATE token_purchases SET status = 'send_failed', nowpayments_status = ${failReason.substring(0, 32)}, updated_at = NOW() WHERE id = ${order_id}`;
                }
              })();
            }
          }
        }
      } else {
        await s`
          UPDATE token_purchases
          SET nowpayments_status = ${payment_status},
              nowpayments_id = ${payment_id},
              pay_amount = COALESCE(NULLIF(${actually_paid || 0}, 0), pay_amount),
              updated_at = NOW()
          WHERE id = ${order_id}
        `;
      }

      return reply.send({ ok: true });
    } catch (e) {
      console.error('[NOWPayments IPN] error:', e.message);
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- NOWPayments: POST /buy/sandbox-simulate (sandbox only) ----
  app.post('/buy/sandbox-simulate', async (request, reply) => {
    if (process.env.NOWPAYMENTS_SANDBOX !== 'true') {
      return reply.status(403).send({ ok: false, error: 'Only available in sandbox mode' });
    }
    try {
      const { purchaseId } = request.body || {};
      if (!purchaseId) return reply.status(400).send({ ok: false, error: 'purchaseId required' });

      const s = require('./db/init').getSql();
      const [purchase] = await s`SELECT * FROM token_purchases WHERE id = ${purchaseId}`;
      if (!purchase) return reply.status(404).send({ ok: false, error: 'Purchase not found' });
      if (['completed', 'sending'].includes(purchase.status)) {
        return reply.send({ ok: true, message: 'Already processing or completed' });
      }

      const paidVal = parseFloat(purchase.pay_amount) || 0;

      const [locked] = await s`
        UPDATE token_purchases
        SET nowpayments_status = 'finished',
            pay_amount = CASE WHEN ${paidVal}::double precision > 0 THEN ${paidVal}::double precision ELSE pay_amount END,
            status = 'sending',
            updated_at = NOW()
        WHERE id = ${purchaseId} AND status NOT IN ('sending', 'completed')
        RETURNING id, user_wallet, ntc_amount, token_symbol
      `;

      if (locked) {
        (async () => {
          try {
            const txSig = await sendTokenToUser(connection, wallet, locked.user_wallet, locked.ntc_amount, locked.token_symbol);
            await s`
              UPDATE token_purchases
              SET status = 'completed', ntc_tx_signature = ${txSig}, updated_at = NOW()
              WHERE id = ${purchaseId}
            `;
            console.log(`[NOWPayments] ${locked.token_symbol || 'NTC'} sent (sandbox): ${locked.ntc_amount} to ${locked.user_wallet} tx=${txSig}`);
          } catch (err) {
            console.error(`[NOWPayments] NTC send failed (sandbox) for ${purchaseId}:`, err.message);
            await s`UPDATE token_purchases SET status = 'send_failed', updated_at = NOW() WHERE id = ${purchaseId}`;
          }
        })();
        return reply.send({ ok: true, message: 'Payment simulated, NTC delivery in progress' });
      }

      return reply.send({ ok: true, message: 'No action needed' });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- NOWPayments: GET /buy/purchases/:wallet ----
  app.get('/buy/purchases/:wallet', async (request, reply) => {
    try {
      const { wallet: w } = request.params;
      const s = require('./db/init').getSql();
      const purchases = await s`
        SELECT id, ntc_amount, price_usd, pay_currency, pay_amount,
               nowpayments_status, status, ntc_tx_signature, token_symbol, created_at
        FROM token_purchases
        WHERE user_wallet = ${w}
        ORDER BY created_at DESC
        LIMIT 50
      `;
      return reply.send({ ok: true, purchases });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- NOWPayments: GET /admin/purchases ----
  app.get('/admin/purchases', async (request, reply) => {
    try {
      const walletAddr = request.headers['x-wallet-address'] || request.query?.wallet;
      if (!walletAddr) return reply.status(401).send({ ok: false, error: 'Wallet required' });
      const ADMIN_WALLETS_AP = await getAdminWallets();
      if (ADMIN_WALLETS_AP.length > 0 && !ADMIN_WALLETS_AP.includes(walletAddr)) {
        return reply.status(403).send({ ok: false, error: 'Admin wallet required' });
      }
      const s = require('./db/init').getSql();
      const purchases = await s`
        SELECT id, user_wallet, ntc_amount, price_usd, pay_currency, pay_amount,
               nowpayments_id, nowpayments_status, pay_address, status,
               ntc_tx_signature, created_at, updated_at
        FROM token_purchases
        ORDER BY created_at DESC
        LIMIT 100
      `;
      return reply.send({ ok: true, purchases });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.post('/buy/create', (request, reply) => app.inject({ method: 'POST', url: '/buy/create-payment', payload: request.body, headers: request.headers }).then(res => { reply.status(res.statusCode).headers(Object.fromEntries(Object.entries(res.headers).filter(([k]) => !['transfer-encoding','content-length','connection'].includes(k)))).send(res.json()) }));
  app.get('/buy/status/:id', (request, reply) => app.inject({ method: 'GET', url: `/buy/payment-status/${request.params.id}`, headers: request.headers }).then(res => { reply.status(res.statusCode).headers(Object.fromEntries(Object.entries(res.headers).filter(([k]) => !['transfer-encoding','content-length','connection'].includes(k)))).send(res.json()) }));
  app.post('/ipn', (request, reply) => app.inject({ method: 'POST', url: '/buy/ipn', payload: request.body, headers: request.headers }).then(res => { reply.status(res.statusCode).headers(Object.fromEntries(Object.entries(res.headers).filter(([k]) => !['transfer-encoding','content-length','connection'].includes(k)))).send(res.json()) }));

  // ---- Limit Orders ----
  app.post('/limit-orders', async (request, reply) => {
    try {
      const { wallet, sellToken, buyToken, sellMint, buyMint, amount, targetPrice, side } = request.body || {};
      if (!wallet || !sellToken || !buyToken || !amount || !targetPrice) {
        return reply.status(400).send({ ok: false, error: 'wallet, sellToken, buyToken, amount, and targetPrice are required' });
      }
      if (!['buy', 'sell'].includes(side)) {
        return reply.status(400).send({ ok: false, error: 'side must be buy or sell' });
      }
      const amt = parseFloat(amount);
      const price = parseFloat(targetPrice);
      if (amt <= 0 || price <= 0 || !isFinite(amt) || !isFinite(price)) {
        return reply.status(400).send({ ok: false, error: 'amount and targetPrice must be positive numbers' });
      }
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const [order] = await s`
        INSERT INTO limit_orders (wallet, sell_token, buy_token, sell_mint, buy_mint, amount, target_price, side, status)
        VALUES (${wallet}, ${sellToken}, ${buyToken}, ${sellMint || ''}, ${buyMint || ''}, ${amt}, ${price}, ${side}, 'open')
        RETURNING *
      `;
      return reply.send({ ok: true, order });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.get('/limit-orders', async (request, reply) => {
    try {
      const { wallet, status } = request.query || {};
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet query param required' });
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      let orders;
      if (status) {
        orders = await s`SELECT * FROM limit_orders WHERE wallet = ${wallet} AND status = ${status} ORDER BY created_at DESC LIMIT 50`;
      } else {
        orders = await s`SELECT * FROM limit_orders WHERE wallet = ${wallet} ORDER BY created_at DESC LIMIT 50`;
      }
      return reply.send({ ok: true, orders });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.delete('/limit-orders/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const wallet = request.headers['x-wallet-address'] || request.query.wallet || '';
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet required (header x-wallet-address or query param)' });
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const result = await s`UPDATE limit_orders SET status = 'cancelled', updated_at = NOW() WHERE id = ${id} AND wallet = ${wallet} AND status = 'open' RETURNING id`;
      if (result.length === 0) return reply.status(404).send({ ok: false, error: 'Order not found or already filled/cancelled' });
      return reply.send({ ok: true, cancelled: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- User Profiles ----
  app.post('/profiles', async (request, reply) => {
    try {
      const { wallet, username, displayName, bio, avatarUrl } = request.body || {};
      if (!wallet || !username) return reply.status(400).send({ ok: false, error: 'wallet and username required' });
      if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return reply.status(400).send({ ok: false, error: 'Username must be 3-24 alphanumeric characters or underscores' });
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const existing = await s`SELECT id FROM user_profiles WHERE wallet = ${wallet} OR username = ${username.toLowerCase()}`;
      if (existing.length > 0) return reply.status(409).send({ ok: false, error: 'Profile already exists for this wallet or username is taken' });
      const result = await s`INSERT INTO user_profiles (wallet, username, display_name, bio, avatar_url) VALUES (${wallet}, ${username.toLowerCase()}, ${displayName || username}, ${bio || ''}, ${avatarUrl || ''}) RETURNING *`;
      return reply.send({ ok: true, profile: result[0] });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.get('/profiles/me', async (request, reply) => {
    try {
      const wallet = request.headers['x-wallet-address'] || request.query.wallet || '';
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet required' });
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const profiles = await s`SELECT * FROM user_profiles WHERE wallet = ${wallet}`;
      if (profiles.length === 0) return reply.send({ ok: true, profile: null });
      return reply.send({ ok: true, profile: profiles[0] });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.get('/profiles/:username/export', async (request, reply) => {
    try {
      const nacl = require('tweetnacl');
      const { username } = request.params;
      const wallet = request.headers['x-wallet-address'] || request.query.wallet || '';
      const signature = request.headers['x-wallet-signature'] || request.query.signature || '';
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet required' });
      if (!signature) return reply.status(400).send({ ok: false, error: 'Wallet signature required for data export' });
      const expectedMsg = `Export data for ${username.toLowerCase()}`;
      const msgBytes = new TextEncoder().encode(expectedMsg);
      let sigBytes;
      try {
        sigBytes = Uint8Array.from(Buffer.from(signature, 'base64'));
      } catch {
        return reply.status(400).send({ ok: false, error: 'Invalid signature format' });
      }
      let pubkeyBytes;
      try {
        pubkeyBytes = new PublicKey(wallet).toBytes();
      } catch {
        return reply.status(400).send({ ok: false, error: 'Invalid wallet address' });
      }
      const verified = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
      if (!verified) {
        return reply.status(403).send({ ok: false, error: 'Wallet signature verification failed' });
      }
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const profiles = await s`SELECT * FROM user_profiles WHERE username = ${username.toLowerCase()} AND wallet = ${wallet}`;
      if (profiles.length === 0) return reply.status(403).send({ ok: false, error: 'Not authorized or profile not found' });
      const profile = profiles[0];
      const posts = await s`SELECT id, type, title, body, image_url, video_url, category, votes, created_at FROM user_posts WHERE author_wallet = ${wallet} ORDER BY created_at DESC`;
      const reposts = await s`SELECT id, original_post_id, commentary, category_tags, created_at FROM user_reposts WHERE reposter_wallet = ${wallet} ORDER BY created_at DESC`;
      const followers = await s`SELECT follower_wallet, created_at FROM profile_follows WHERE following_wallet = ${wallet}`;
      const following = await s`SELECT following_wallet, created_at FROM profile_follows WHERE follower_wallet = ${wallet}`;
      const exportData = {
        exported_at: new Date().toISOString(),
        profile: {
          username: profile.username,
          display_name: profile.display_name,
          bio: profile.bio,
          avatar_url: profile.avatar_url,
          created_at: profile.created_at,
          updated_at: profile.updated_at,
        },
        posts,
        reposts,
        followers,
        following,
      };
      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="${username}_data_export.json"`);
      return reply.send({ ok: true, data: exportData });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.delete('/profiles/:username/data', async (request, reply) => {
    try {
      const nacl = require('tweetnacl');
      const { username } = request.params;
      const wallet = request.headers['x-wallet-address'] || '';
      const { signature } = request.body || {};
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet header required' });
      if (!signature) return reply.status(400).send({ ok: false, error: 'Wallet signature required for data deletion' });
      const expectedMsg = `Delete all data for ${username.toLowerCase()}`;
      const msgBytes = new TextEncoder().encode(expectedMsg);
      let sigBytes;
      try {
        sigBytes = Uint8Array.from(Buffer.from(signature, 'base64'));
      } catch {
        return reply.status(400).send({ ok: false, error: 'Invalid signature format' });
      }
      let pubkeyBytes;
      try {
        pubkeyBytes = new PublicKey(wallet).toBytes();
      } catch {
        return reply.status(400).send({ ok: false, error: 'Invalid wallet address' });
      }
      const verified = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
      if (!verified) {
        return reply.status(403).send({ ok: false, error: 'Wallet signature verification failed' });
      }
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const profiles = await s`SELECT id, wallet FROM user_profiles WHERE username = ${username.toLowerCase()} AND wallet = ${wallet}`;
      if (profiles.length === 0) return reply.status(403).send({ ok: false, error: 'Not authorized or profile not found' });
      await s.begin(async (tx) => {
        await tx`DELETE FROM user_reposts WHERE reposter_wallet = ${wallet}`;
        await tx`DELETE FROM user_reposts WHERE original_post_id IN (SELECT id FROM user_posts WHERE author_wallet = ${wallet})`;
        await tx`DELETE FROM user_posts WHERE author_wallet = ${wallet}`;
        await tx`DELETE FROM profile_follows WHERE follower_wallet = ${wallet} OR following_wallet = ${wallet}`;
        await tx`DELETE FROM profile_members WHERE member_wallet = ${wallet} OR profile_wallet = ${wallet}`;
        await tx`DELETE FROM user_profiles WHERE wallet = ${wallet}`;
      });
      return reply.send({ ok: true, deleted: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.get('/profiles/:username', async (request, reply) => {
    try {
      const { username } = request.params;
      const viewerWallet = request.headers['x-wallet-address'] || request.query.viewer || '';
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const profiles = await s`SELECT * FROM user_profiles WHERE username = ${username.toLowerCase()}`;
      if (profiles.length === 0) return reply.status(404).send({ ok: false, error: 'Profile not found' });
      const profile = profiles[0];
      const followerCount = await s`SELECT COUNT(*)::int AS count FROM profile_follows WHERE following_wallet = ${profile.wallet}`;
      const followingCount = await s`SELECT COUNT(*)::int AS count FROM profile_follows WHERE follower_wallet = ${profile.wallet}`;
      const memberCount = await s`SELECT COUNT(*)::int AS count FROM profile_members WHERE profile_wallet = ${profile.wallet}`;
      let isFollowing = false;
      let isMember = false;
      if (viewerWallet) {
        const followCheck = await s`SELECT id FROM profile_follows WHERE follower_wallet = ${viewerWallet} AND following_wallet = ${profile.wallet}`;
        isFollowing = followCheck.length > 0;
        const memberCheck = await s`SELECT id FROM profile_members WHERE member_wallet = ${viewerWallet} AND profile_wallet = ${profile.wallet}`;
        isMember = memberCheck.length > 0;
      }
      return reply.send({
        ok: true,
        profile: {
          ...profile,
          followers: followerCount[0].count,
          following: followingCount[0].count,
          members: memberCount[0].count,
          isFollowing,
          isMember,
        },
      });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.get('/profiles/wallet/:wallet', async (request, reply) => {
    try {
      const { wallet } = request.params;
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const profiles = await s`SELECT * FROM user_profiles WHERE wallet = ${wallet}`;
      if (profiles.length === 0) return reply.status(404).send({ ok: false, error: 'No profile for this wallet' });
      return reply.send({ ok: true, profile: profiles[0] });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.put('/profiles/:username', async (request, reply) => {
    try {
      const { username } = request.params;
      const wallet = request.headers['x-wallet-address'] || '';
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet header required' });
      const { displayName, bio, avatarUrl } = request.body || {};
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const result = await s`UPDATE user_profiles SET display_name = COALESCE(${displayName || null}, display_name), bio = COALESCE(${bio || null}, bio), avatar_url = COALESCE(${avatarUrl || null}, avatar_url), updated_at = NOW() WHERE username = ${username.toLowerCase()} AND wallet = ${wallet} RETURNING *`;
      if (result.length === 0) return reply.status(404).send({ ok: false, error: 'Profile not found or not owner' });
      return reply.send({ ok: true, profile: result[0] });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.post('/profiles/:username/follow', async (request, reply) => {
    try {
      const { username } = request.params;
      const followerWallet = request.headers['x-wallet-address'] || (request.body || {}).wallet || '';
      if (!followerWallet) return reply.status(400).send({ ok: false, error: 'wallet required' });
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const profiles = await s`SELECT wallet FROM user_profiles WHERE username = ${username.toLowerCase()}`;
      if (profiles.length === 0) return reply.status(404).send({ ok: false, error: 'Profile not found' });
      const targetWallet = profiles[0].wallet;
      if (targetWallet === followerWallet) return reply.status(400).send({ ok: false, error: 'Cannot follow yourself' });
      await s`INSERT INTO profile_follows (follower_wallet, following_wallet) VALUES (${followerWallet}, ${targetWallet}) ON CONFLICT DO NOTHING`;
      return reply.send({ ok: true, following: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.post('/profiles/:username/join', async (request, reply) => {
    try {
      const { username } = request.params;
      const memberWallet = request.headers['x-wallet-address'] || (request.body || {}).wallet || '';
      if (!memberWallet) return reply.status(400).send({ ok: false, error: 'wallet required' });
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const profiles = await s`SELECT wallet FROM user_profiles WHERE username = ${username.toLowerCase()}`;
      if (profiles.length === 0) return reply.status(404).send({ ok: false, error: 'Profile not found' });
      const targetWallet = profiles[0].wallet;
      if (targetWallet === memberWallet) return reply.status(400).send({ ok: false, error: 'Cannot join your own profile' });
      await s`INSERT INTO profile_members (member_wallet, profile_wallet) VALUES (${memberWallet}, ${targetWallet}) ON CONFLICT DO NOTHING`;
      return reply.send({ ok: true, joined: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.delete('/profiles/:username/join', async (request, reply) => {
    try {
      const { username } = request.params;
      const memberWallet = request.headers['x-wallet-address'] || request.query.wallet || '';
      if (!memberWallet) return reply.status(400).send({ ok: false, error: 'wallet required' });
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const profiles = await s`SELECT wallet FROM user_profiles WHERE username = ${username.toLowerCase()}`;
      if (profiles.length === 0) return reply.status(404).send({ ok: false, error: 'Profile not found' });
      await s`DELETE FROM profile_members WHERE member_wallet = ${memberWallet} AND profile_wallet = ${profiles[0].wallet}`;
      return reply.send({ ok: true, joined: false });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.delete('/profiles/:username/follow', async (request, reply) => {
    try {
      const { username } = request.params;
      const followerWallet = request.headers['x-wallet-address'] || request.query.wallet || '';
      if (!followerWallet) return reply.status(400).send({ ok: false, error: 'wallet required' });
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const profiles = await s`SELECT wallet FROM user_profiles WHERE username = ${username.toLowerCase()}`;
      if (profiles.length === 0) return reply.status(404).send({ ok: false, error: 'Profile not found' });
      await s`DELETE FROM profile_follows WHERE follower_wallet = ${followerWallet} AND following_wallet = ${profiles[0].wallet}`;
      return reply.send({ ok: true, following: false });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- User Posts ----
  app.post('/posts', async (request, reply) => {
    try {
      const wallet = request.headers['x-wallet-address'] || '';
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet header required' });
      const { type, title, body, imageUrl, videoUrl, category } = request.body || {};
      if (!title || !body) return reply.status(400).send({ ok: false, error: 'title and body required' });
      const postType = (type === 'video') ? 'video' : 'blog';
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const profileCheck = await s`SELECT username FROM user_profiles WHERE wallet = ${wallet}`;
      if (profileCheck.length === 0) return reply.status(403).send({ ok: false, error: 'You must create a profile first' });
      let safeVideoUrl = '';
      if (postType === 'video') {
        if (!videoUrl || !videoUrl.trim()) {
          return reply.status(400).send({ ok: false, error: 'Video URL is required for video posts' });
        }
        try {
          const parsed = new URL(videoUrl);
          const allowedHosts = ['youtube.com', 'www.youtube.com', 'youtu.be', 'vimeo.com', 'www.vimeo.com', 'player.vimeo.com', 'res.cloudinary.com'];
          if (!allowedHosts.includes(parsed.hostname)) {
            return reply.status(400).send({ ok: false, error: 'Only YouTube, Vimeo, or uploaded video URLs are allowed' });
          }
          safeVideoUrl = videoUrl.trim().slice(0, 512);
        } catch {
          return reply.status(400).send({ ok: false, error: 'Invalid video URL' });
        }
      }
      const result = await s`INSERT INTO user_posts (author_wallet, type, title, body, image_url, video_url, category) VALUES (${wallet}, ${postType}, ${title.slice(0, 256)}, ${body.slice(0, 10000)}, ${imageUrl || ''}, ${safeVideoUrl}, ${(category || 'General').slice(0, 32)}) RETURNING *`;
      return reply.send({ ok: true, post: result[0] });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.post('/posts/upload-image', async (request, reply) => {
    try {
      const wallet = request.headers['x-wallet-address'] || '';
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet header required' });
      const data = await request.file();
      if (!data) return reply.status(400).send({ ok: false, error: 'No file uploaded' });
      const ext = path.extname(data.filename || '.png').toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        return reply.status(400).send({ ok: false, error: 'Only image files allowed' });
      }
      const filename = `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      const uploadsDir = path.resolve(__dirname, 'uploads', 'posts');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const filepath = path.join(uploadsDir, filename);
      const chunks = [];
      for await (const chunk of data.file) { chunks.push(chunk); }
      fs.writeFileSync(filepath, Buffer.concat(chunks));
      const imageUrl = `/uploads/posts/${filename}`;
      return reply.send({ ok: true, imageUrl });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.post('/posts/upload-media', { bodyLimit: 50 * 1024 * 1024 }, async (request, reply) => {
    try {
      const wallet = request.headers['x-wallet-address'] || '';
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet header required' });
      const data = await request.file({ limits: { fileSize: 50 * 1024 * 1024 } });
      if (!data) return reply.status(400).send({ ok: false, error: 'No file uploaded' });
      const mimeType = data.mimetype || '';
      const isVideo = mimeType.startsWith('video/');
      const isImage = mimeType.startsWith('image/');
      if (!isVideo && !isImage) {
        return reply.status(400).send({ ok: false, error: 'Only image or video files allowed' });
      }
      const { v2: cloudinary } = require('cloudinary');
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dm9wn7axz',
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
      const resourceType = isVideo ? 'video' : 'image';
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: 'community_posts', resource_type: resourceType },
          (err, res) => { if (err) reject(err); else resolve(res); }
        );
        data.file.pipe(uploadStream);
      });
      return reply.send({ ok: true, url: result.secure_url, mediaType: resourceType, publicId: result.public_id });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.get('/posts', async (request, reply) => {
    try {
      const { wallet, limit, offset } = request.query;
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const lim = Math.min(Number(limit) || 50, 100);
      const off = Number(offset) || 0;
      let posts;
      if (wallet) {
        posts = await s`SELECT p.*, u.username, u.display_name, u.avatar_url FROM user_posts p LEFT JOIN user_profiles u ON p.author_wallet = u.wallet WHERE p.author_wallet = ${wallet} ORDER BY p.created_at DESC LIMIT ${lim} OFFSET ${off}`;
      } else {
        posts = await s`SELECT p.*, u.username, u.display_name, u.avatar_url FROM user_posts p LEFT JOIN user_profiles u ON p.author_wallet = u.wallet ORDER BY p.created_at DESC LIMIT ${lim} OFFSET ${off}`;
      }
      return reply.send({ ok: true, posts });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.get('/posts/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const result = await s`SELECT p.*, u.username, u.display_name, u.avatar_url FROM user_posts p LEFT JOIN user_profiles u ON p.author_wallet = u.wallet WHERE p.id = ${id}`;
      if (result.length === 0) return reply.status(404).send({ ok: false, error: 'Post not found' });
      return reply.send({ ok: true, post: result[0] });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.delete('/posts/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const wallet = request.headers['x-wallet-address'] || '';
      if (!wallet) return reply.status(400).send({ ok: false, error: 'wallet header required' });
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const result = await s`DELETE FROM user_posts WHERE id = ${id} AND author_wallet = ${wallet} RETURNING id`;
      if (result.length === 0) return reply.status(404).send({ ok: false, error: 'Post not found or not owner' });
      return reply.send({ ok: true, deleted: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.post('/posts/:id/vote', async (request, reply) => {
    try {
      const { id } = request.params;
      const { direction } = request.body || {};
      if (direction !== 'up' && direction !== 'down') {
        return reply.status(400).send({ ok: false, error: 'direction must be "up" or "down"' });
      }
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const inc = direction === 'up' ? 1 : -1;
      const result = await s`UPDATE user_posts SET votes = votes + ${inc} WHERE id = ${id} RETURNING id, votes`;
      if (result.length === 0) return reply.status(404).send({ ok: false, error: 'Post not found' });
      return reply.send({ ok: true, votes: result[0].votes });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- Reposts ----
  app.post('/reposts', async (request, reply) => {
    try {
      const wallet = request.headers['x-wallet-address'];
      if (!wallet) return reply.status(401).send({ ok: false, error: 'Wallet required' });
      const { original_post_id, commentary, category_tags } = request.body || {};
      if (!original_post_id) return reply.status(400).send({ ok: false, error: 'original_post_id required' });
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const origCheck = await s`SELECT id FROM user_posts WHERE id = ${original_post_id}`;
      if (origCheck.length === 0) return reply.status(404).send({ ok: false, error: 'Original post not found' });
      const tags = Array.isArray(category_tags) ? category_tags.filter(t => typeof t === 'string').slice(0, 5) : [];
      const result = await s`INSERT INTO user_reposts (original_post_id, reposter_wallet, commentary, category_tags) VALUES (${original_post_id}, ${wallet}, ${(commentary || '').slice(0, 2000)}, ${JSON.stringify(tags)}) RETURNING *`;
      return reply.send({ ok: true, repost: result[0] });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.get('/feed', async (request, reply) => {
    try {
      const s = require('./db/init').getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });
      const limit = Math.min(Number(request.query.limit) || 50, 100);
      const posts = await s`SELECT p.*, up.username, up.display_name, up.avatar_url FROM user_posts p LEFT JOIN user_profiles up ON p.author_wallet = up.wallet ORDER BY p.created_at DESC LIMIT ${limit}`;
      const reposts = await s`SELECT r.*, up.username AS reposter_username, up.display_name AS reposter_display_name, up.avatar_url AS reposter_avatar_url, op.id AS orig_id, op.author_wallet AS orig_author_wallet, op.type AS orig_type, op.title AS orig_title, op.body AS orig_body, op.image_url AS orig_image_url, op.video_url AS orig_video_url, op.category AS orig_category, op.votes AS orig_votes, op.created_at AS orig_created_at, opu.username AS orig_username, opu.display_name AS orig_display_name, opu.avatar_url AS orig_avatar_url FROM user_reposts r LEFT JOIN user_profiles up ON r.reposter_wallet = up.wallet LEFT JOIN user_posts op ON r.original_post_id = op.id LEFT JOIN user_profiles opu ON op.author_wallet = opu.wallet WHERE op.id IS NOT NULL ORDER BY r.created_at DESC LIMIT ${limit}`;
      const feedItems = [];
      for (const p of posts) {
        feedItems.push({ ...p, feed_type: 'post', feed_date: p.created_at });
      }
      for (const r of reposts) {
        feedItems.push({
          feed_type: 'repost',
          feed_date: r.created_at,
          repost_id: r.id,
          reposter_wallet: r.reposter_wallet,
          reposter_username: r.reposter_username,
          reposter_display_name: r.reposter_display_name,
          reposter_avatar_url: r.reposter_avatar_url,
          commentary: r.commentary,
          category_tags: r.category_tags,
          reposted_at: r.created_at,
          original: {
            id: r.orig_id,
            author_wallet: r.orig_author_wallet,
            type: r.orig_type,
            title: r.orig_title,
            body: r.orig_body,
            image_url: r.orig_image_url,
            video_url: r.orig_video_url,
            category: r.orig_category,
            votes: r.orig_votes,
            created_at: r.orig_created_at,
            username: r.orig_username,
            display_name: r.orig_display_name,
            avatar_url: r.orig_avatar_url,
          },
        });
      }
      feedItems.sort((a, b) => new Date(b.feed_date) - new Date(a.feed_date));
      return reply.send({ ok: true, items: feedItems.slice(0, limit) });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- Unified Search ----
  app.get('/search/query', async (request, reply) => {
    try {
      const q = (request.query.q || '').trim();
      if (!q || q.length < 2) return reply.send({ ok: true, tokens: [], profiles: [], posts: [], networkPosts: [] });
      const pattern = `%${q}%`;

      const ql = q.toLowerCase();
      let tokens = tokensService.listTokens()
        .filter(t => {
          const sym = (t.symbol || '').toLowerCase();
          const name = (t.name || '').toLowerCase();
          return sym.includes(ql) || name.includes(ql);
        })
        .slice(0, 10)
        .map(t => ({
          symbol: t.symbol,
          name: t.name,
          mint: typeof t.mint === 'string' ? t.mint : t.mint?.toBase58?.() || '',
          image_url: t.imageUrl || t.image_url || '',
          decimals: t.decimals,
        }));

      if (tokens.length === 0 && deps.adminSetupService) {
        const predefined = deps.adminSetupService.getPredefinedTokens() || [];
        tokens = predefined
          .filter(t => {
            const sym = (t.symbol || '').toLowerCase();
            const name = (t.name || '').toLowerCase();
            return sym.includes(ql) || name.includes(ql);
          })
          .slice(0, 10)
          .map(t => ({
            symbol: t.symbol,
            name: t.name,
            mint: t.mint || '',
            image_url: t.image_url || '',
            decimals: t.decimals || 5,
          }));
      }

      const s = require('./db/init').getSql();
      let profiles = [];
      let posts = [];
      let networkPosts = [];
      if (s) {
        if (tokens.length === 0) {
          const dbTokens = await s`SELECT symbol, name, mint_address, image_url, decimals FROM tokens WHERE symbol ILIKE ${pattern} OR name ILIKE ${pattern} LIMIT 10`;
          tokens = dbTokens.map(t => ({
            symbol: t.symbol,
            name: t.name,
            mint: t.mint_address || '',
            image_url: t.image_url || '',
            decimals: t.decimals,
          }));
        }
        profiles = await s`SELECT wallet, username, display_name, bio, avatar_url FROM user_profiles WHERE username ILIKE ${pattern} OR display_name ILIKE ${pattern} LIMIT 10`;
        posts = await s`SELECT p.id, p.author_wallet, p.type, p.title, p.body, p.category, p.votes, p.created_at, up.username, up.display_name, up.avatar_url FROM user_posts p LEFT JOIN user_profiles up ON p.author_wallet = up.wallet WHERE p.title ILIKE ${pattern} OR p.body ILIKE ${pattern} OR p.category ILIKE ${pattern} ORDER BY p.created_at DESC LIMIT 10`;
        networkPosts = await s`SELECT np.id, np.author_wallet, np.title, np.body, np.media_url, np.media_type, np.likes_count, np.comments_count, np.category, np.created_at, up.username, up.display_name, up.avatar_url FROM network_posts np LEFT JOIN user_profiles up ON np.author_wallet = up.wallet WHERE np.title ILIKE ${pattern} OR np.body ILIKE ${pattern} OR np.category ILIKE ${pattern} ORDER BY np.created_at DESC LIMIT 10`;
      }

      return reply.send({ ok: true, tokens, profiles, posts, networkPosts });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  app.setNotFoundHandler((request, reply) => {
    const wasApiCall = request.raw._wasApiRoute || request.url.startsWith('/api/');
    if (isProduction && request.method === 'GET' && !wasApiCall && !request.url.startsWith('/uploads/') && !request.url.startsWith('/coingecko/')) {
      const indexPath = path.join(frontendDist, 'index.html');
      if (fs.existsSync(indexPath)) {
        if (DEBUG_REQUESTS) console.log(`[404→SPA] ${request.method} ${request.url} → serving index.html (wasApiCall=${wasApiCall})`);
        reply.type('text/html').send(fs.createReadStream(indexPath));
        return;
      }
    }
    if (DEBUG_REQUESTS) console.log(`[404] ${request.method} ${request.url} → JSON 404 (wasApiCall=${wasApiCall}, isProduction=${isProduction})`);
    reply.status(404).send({ ok: false, error: 'Not Found' });
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });

  const configuredDomain = process.env.APP_URL || process.env.PUBLIC_DOMAIN || process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || '';
  if (!configuredDomain) {
    console.warn('[WARNING] No public domain configured. Set APP_URL or PUBLIC_DOMAIN env var (e.g., https://cryptoniteswap.xyz) for IPN webhooks to work.');
  }

  console.log(`API listening on http://localhost:${PORT}`);
  console.log('Routes:');
  console.log('  GET  /health');
  console.log('  GET  /tokens');
  console.log('  GET  /tokens/refresh');
  console.log('  GET  /pools?verify=true');
  console.log('  POST /pools');
  console.log('  POST /liquidity'); 
  console.log('  GET  /balances/treasury');
  console.log('  GET  /balances/owner?owner=...');
  console.log('  GET  /quote?mintIn=...&mintOut=...&amountIn=...');
  console.log('  POST /swap');
  console.log('  POST /pools/build     (client-signed)');
  console.log('  POST /liquidity/build         (client-signed)');
  console.log('  POST /liquidity/remove/build  (client-signed)');
  console.log('  GET  /pool/price?poolAddress=...  (on-chain pool price)');
  console.log('  GET  /fees?poolAddress=...    (fees owed)');
  console.log('  POST /fees/collect/build      (client-signed)');
  console.log('  GET  /positions               (list pool positions)');
  console.log('  POST /buy/build               (build buy transfer, buyer signs)');
  console.log('  POST /swap/build              (client-signed)');
  console.log('  POST /send                    (proxy signed tx)');
  console.log('  GET  /chart/candles           (OHLCV candles)');
  console.log('  GET  /chart/sparkline         (sparkline prices)');
  console.log('  GET  /chart/trades            (recent trades)');
  console.log('  GET  /chart/stats             (token 24h/7d stats)');
  console.log('  GET  /chart/stream            (SSE real-time)');
  console.log('  GET  /treasury/multisig       (multisig state via Squads)');
  console.log('  GET  /treasury/balances       (vault token balances)');
  console.log('  GET  /treasury/fees/history   (fee events history)');
  console.log('  POST /treasury/fees/collect   (harvest pool fees)');
  console.log('  POST /treasury/fees/withdraw  (withdraw transfer fees)');
  console.log('  POST /moonpay/transaction          (create moonpay tx record)');
  console.log('  PATCH /moonpay/transaction/:id     (update moonpay tx status)');
  console.log('  GET  /moonpay/transactions/:wallet (list moonpay purchases)');
  console.log('  GET  /moonpay/treasury-vault       (treasury vault address)');
  console.log('  POST /moonpay/transfer/build       (build transfer-to-vault tx)');
  console.log('  POST /admin/squads/create-multisig (create Squads multisig)');
  console.log('  POST /admin/squads/create-vault    (create Squads vault)');
  console.log('  POST /admin/squads/propose         (create vault tx + proposal)');
  console.log('  POST /admin/squads/approve          (approve proposal)');
  console.log('  POST /admin/squads/execute          (execute transaction)');
  console.log('  GET  /admin/squads/state            (get multisig state)');
  console.log('  GET  /admin/squads/vault-balances   (get vault balances)');
  console.log('  GET  /buy/currencies                (NOWPayments currencies)');
  console.log('  GET  /buy/estimate                  (estimate crypto payment)');
  console.log('  POST /buy/create-payment            (create NOWPayments payment)');
  console.log('  GET  /buy/payment-status/:id        (check payment status)');
  console.log('  POST /buy/ipn                       (NOWPayments IPN webhook)');
  console.log('  GET  /buy/purchases/:wallet         (user purchase history)');
  console.log('  GET  /admin/purchases               (all purchases - admin)');

  const shutdown = async () => {
    console.log('Shutting down...');
    const forceExitTimer = setTimeout(() => {
      console.warn('Shutdown timed out after 10s, forcing exit');
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();
    try {
      if (monitorHandle && typeof monitorHandle.stop === 'function') {
        await monitorHandle.stop();
      }
    } catch (_) {}
    try { await cacheService.shutdown(); } catch (_) {}
    try { await dbShutdown(); } catch (_) {}
    for (const client of sseClients) {
      try { client.end(); } catch (_) {}
    }
    sseClients.length = 0;
    await app.close();
    clearTimeout(forceExitTimer);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('API boot failed:', e);
  process.exit(1);
});
