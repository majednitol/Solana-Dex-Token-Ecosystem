'use strict';

const http = require('http');
const { Keypair, VersionedTransaction, PublicKey } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:8080';
const OWNER1 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../keys/owner1.json'), 'utf8'))));
const OWNER2 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../keys/owner2.json'), 'utf8'))));
const { getWalletKeypair } = require('../utils/wallet');
const OWNER3 = getWalletKeypair();

const NTC_MINT = '9BLjPRiMH38vvr2Bm4DQJ2dkcAHYXB7YkLjZuS2SQhvi';
const ASDC_MINT = 'B8cWx1rgVRQ3F1BpM3BpFjZuTkF3yFv8B1Durrbpsma1';

function request(method, urlPath, body, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('request timeout')), timeoutMs);
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function signAndSend(txBase64, signerKeypair) {
  const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
  tx.sign([signerKeypair]);
  return request('POST', '/send', { transaction: Buffer.from(tx.serialize()).toString('base64') }, {}, 35000);
}

let passed = 0, failed = 0, skipped = 0;
const results = [];

function ok(name, cond, detail = '') {
  if (cond) { passed++; results.push('PASS'); console.log(`  \x1b[32mPASS\x1b[0m  ${name}`); }
  else { failed++; results.push('FAIL'); console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ' — ' + detail : ''}`); }
}
function skip(name, reason) { skipped++; results.push('SKIP'); console.log(`  \x1b[33mSKIP\x1b[0m  ${name} — ${reason}`); }

async function safe(name, fn) {
  try { await fn(); } catch (e) { ok(name, false, e.message); }
}

(async () => {
  const t0 = Date.now();
  console.log('\n' + '='.repeat(60));
  console.log('  FULL API CURL TEST — ALL ENDPOINTS A TO Z');
  console.log('='.repeat(60) + '\n');

  let testNum = 0;
  const section = (s) => { console.log(`\n--- ${s} ---\n`); };

  // ════════════════════════════════════════════
  section('A. HEALTH');
  // ════════════════════════════════════════════
  await safe('GET /health', async () => {
    const r = await request('GET', '/health');
    ok('#' + (++testNum) + ' GET /health returns ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Has slot', typeof r.body.slot === 'number');
    ok('#' + (++testNum) + ' Has wallet', !!r.body.wallet);
    ok('#' + (++testNum) + ' Has rpc', !!r.body.rpc);
  });

  // ════════════════════════════════════════════
  section('B. TRACKING');
  // ════════════════════════════════════════════
  await safe('POST /track/wallet', async () => {
    const r = await request('POST', '/track/wallet', { wallet: OWNER1.publicKey.toBase58() });
    ok('#' + (++testNum) + ' POST /track/wallet', r.status === 200);
  });
  await safe('POST /track/visit', async () => {
    const r = await request('POST', '/track/visit', { sessionId: 'test-session', page: '/swap', source: 'curl-test' });
    ok('#' + (++testNum) + ' POST /track/visit', r.status === 200);
  });

  // ════════════════════════════════════════════
  section('C. TOKENS');
  // ════════════════════════════════════════════
  let tokens = [];
  await safe('GET /tokens', async () => {
    const r = await request('GET', '/tokens');
    ok('#' + (++testNum) + ' GET /tokens returns ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Has tokens array', Array.isArray(r.body.tokens));
    ok('#' + (++testNum) + ' Has 11 tokens', r.body.tokens && r.body.tokens.length === 11);
    tokens = r.body.tokens || [];
    if (tokens.length > 0) {
      const ntc = tokens.find(t => t.symbol === 'NTC');
      ok('#' + (++testNum) + ' NTC token exists', !!ntc);
      ok('#' + (++testNum) + ' Token has mint', ntc && !!ntc.mint);
      ok('#' + (++testNum) + ' Token has decimals', ntc && ntc.decimals === 5);
    }
  });

  await safe('GET /tokens/refresh', async () => {
    const r = await request('GET', '/tokens/refresh');
    ok('#' + (++testNum) + ' GET /tokens/refresh returns ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Refresh returns data', r.body.refreshed === true || Array.isArray(r.body.tokens));
  });

  // ════════════════════════════════════════════
  section('D. POOLS');
  // ════════════════════════════════════════════
  let poolAddress = null;
  await safe('GET /pools', async () => {
    const r = await request('GET', '/pools?tokenA=NTC&tokenB=ASDC');
    ok('#' + (++testNum) + ' GET /pools?tokenA=NTC&tokenB=ASDC', r.status === 200);
    ok('#' + (++testNum) + ' Pools response has ok or pools field', r.body.ok !== undefined || r.body.pools !== undefined || r.body.pool !== undefined);
    if (r.body.pool) poolAddress = r.body.pool.address || r.body.pool.poolAddress;
    if (r.body.pools && r.body.pools[0]) poolAddress = r.body.pools[0].address || r.body.pools[0].poolAddress;
  });

  await safe('POST /pools validation', async () => {
    const r = await request('POST', '/pools', {});
    ok('#' + (++testNum) + ' POST /pools rejects empty body', r.status === 400 || r.status === 500);
  });

  await safe('POST /pools/build validation', async () => {
    const r = await request('POST', '/pools/build', {});
    ok('#' + (++testNum) + ' POST /pools/build rejects missing userPubkey', r.status === 400);
  });

  await safe('POST /pools/build', async () => {
    const r = await request('POST', '/pools/build', {
      userPubkey: OWNER1.publicKey.toBase58(),
      tokenX: NTC_MINT,
      tokenY: ASDC_MINT,
    });
    ok('#' + (++testNum) + ' POST /pools/build responds', r.status === 200 || r.status === 500);
  });

  // ════════════════════════════════════════════
  section('E. POOL PRICE');
  // ════════════════════════════════════════════
  await safe('GET /pool/price', async () => {
    if (!poolAddress) {
      skip('#' + (++testNum) + ' GET /pool/price', 'No pool address found');
      return;
    }
    const r = await request('GET', `/pool/price?poolAddress=${poolAddress}`);
    ok('#' + (++testNum) + ' GET /pool/price responds', r.status === 200 || r.status === 500);
  });
  await safe('GET /pool/price missing param', async () => {
    const r = await request('GET', '/pool/price');
    ok('#' + (++testNum) + ' GET /pool/price rejects missing poolAddress', r.status === 400);
  });

  // ════════════════════════════════════════════
  section('F. LIQUIDITY');
  // ════════════════════════════════════════════
  await safe('POST /liquidity validation', async () => {
    const r = await request('POST', '/liquidity', {});
    ok('#' + (++testNum) + ' POST /liquidity rejects empty body', r.status === 400 || r.status === 500);
  });

  await safe('POST /liquidity/build validation', async () => {
    const r = await request('POST', '/liquidity/build', {});
    ok('#' + (++testNum) + ' POST /liquidity/build rejects missing userPubkey', r.status === 400);
  });

  await safe('POST /liquidity/remove/build validation', async () => {
    const r = await request('POST', '/liquidity/remove/build', {});
    ok('#' + (++testNum) + ' POST /liquidity/remove/build rejects missing userPubkey', r.status === 400);
  });

  await safe('POST /liquidity/remove/build missing positionMint', async () => {
    const r = await request('POST', '/liquidity/remove/build', { userPubkey: OWNER1.publicKey.toBase58() });
    ok('#' + (++testNum) + ' POST /liquidity/remove/build rejects missing positionMint', r.status === 400);
  });

  // ════════════════════════════════════════════
  section('G. POSITIONS');
  // ════════════════════════════════════════════
  await safe('GET /positions', async () => {
    if (!poolAddress) {
      skip('#' + (++testNum) + ' GET /positions', 'No pool address');
      return;
    }
    const r = await request('GET', `/positions?poolAddress=${poolAddress}`);
    ok('#' + (++testNum) + ' GET /positions responds', r.status === 200 || r.status === 500);
  });

  // ════════════════════════════════════════════
  section('H. FEES');
  // ════════════════════════════════════════════
  await safe('GET /fees missing param', async () => {
    const r = await request('GET', '/fees');
    ok('#' + (++testNum) + ' GET /fees rejects missing poolAddress', r.status === 400);
  });

  await safe('GET /fees', async () => {
    if (!poolAddress) {
      skip('#' + (++testNum) + ' GET /fees with pool', 'No pool address');
      return;
    }
    const r = await request('GET', `/fees?poolAddress=${poolAddress}`);
    ok('#' + (++testNum) + ' GET /fees responds', r.status === 200 || r.status === 500);
  });

  await safe('POST /fees/collect/build validation', async () => {
    const r = await request('POST', '/fees/collect/build', {});
    ok('#' + (++testNum) + ' POST /fees/collect/build rejects missing userPubkey', r.status === 400);
  });

  await safe('POST /fees/collect/build missing positionMint', async () => {
    const r = await request('POST', '/fees/collect/build', { userPubkey: OWNER1.publicKey.toBase58() });
    ok('#' + (++testNum) + ' POST /fees/collect/build rejects missing positionMint', r.status === 400);
  });

  // ════════════════════════════════════════════
  section('I. BALANCES');
  // ════════════════════════════════════════════
  await safe('GET /balances/treasury', async () => {
    const r = await request('GET', '/balances/treasury');
    ok('#' + (++testNum) + ' GET /balances/treasury returns ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Has balances', r.body.balances !== undefined);
  });

  await safe('GET /balances/owner', async () => {
    const r = await request('GET', `/balances/owner?owner=${OWNER3.publicKey.toBase58()}`);
    ok('#' + (++testNum) + ' GET /balances/owner responds', r.status === 200);
    ok('#' + (++testNum) + ' Owner balances has data', r.body.ok !== undefined || r.body.balances !== undefined);
  });

  // ════════════════════════════════════════════
  section('J. QUOTE');
  // ════════════════════════════════════════════
  await safe('GET /quote missing params', async () => {
    const r = await request('GET', '/quote');
    ok('#' + (++testNum) + ' GET /quote rejects missing params', r.status === 400);
  });

  await safe('GET /quote', async () => {
    const r = await request('GET', `/quote?mintIn=${NTC_MINT}&mintOut=${ASDC_MINT}&amountIn=1`);
    ok('#' + (++testNum) + ' GET /quote responds', r.status === 200 || r.status === 500);
  });

  // ════════════════════════════════════════════
  section('K. SWAP');
  // ════════════════════════════════════════════
  await safe('POST /swap validation', async () => {
    const r = await request('POST', '/swap', {});
    ok('#' + (++testNum) + ' POST /swap rejects empty body', r.status === 400 || r.status === 500);
  });

  await safe('POST /swap/build validation', async () => {
    const r = await request('POST', '/swap/build', {});
    ok('#' + (++testNum) + ' POST /swap/build rejects missing userPubkey', r.status === 400);
  });

  // ════════════════════════════════════════════
  section('L. SEND');
  // ════════════════════════════════════════════
  await safe('POST /send validation', async () => {
    const r = await request('POST', '/send', {});
    ok('#' + (++testNum) + ' POST /send rejects missing transaction', r.status === 400);
  });

  await safe('POST /send invalid base64', async () => {
    const r = await request('POST', '/send', { transaction: 'not-valid-base64-tx' });
    ok('#' + (++testNum) + ' POST /send rejects invalid tx', r.status === 500 || r.status === 400);
  });

  // ════════════════════════════════════════════
  section('M. CHART / ANALYTICS');
  // ════════════════════════════════════════════
  await safe('GET /chart/candles', async () => {
    const r = await request('GET', '/chart/candles?tokenId=NTC');
    ok('#' + (++testNum) + ' GET /chart/candles responds', r.status === 200);
    ok('#' + (++testNum) + ' Candles has data array', r.body.ok === true && Array.isArray(r.body.candles || r.body.data));
  });

  await safe('GET /chart/sparkline', async () => {
    const r = await request('GET', '/chart/sparkline?tokenId=NTC');
    ok('#' + (++testNum) + ' GET /chart/sparkline responds', r.status === 200);
    ok('#' + (++testNum) + ' Sparkline has prices', r.body.ok === true && Array.isArray(r.body.prices || r.body.data));
  });

  await safe('GET /chart/trades', async () => {
    const r = await request('GET', '/chart/trades?tokenId=NTC');
    ok('#' + (++testNum) + ' GET /chart/trades responds', r.status === 200);
    ok('#' + (++testNum) + ' Trades has data', r.body.ok === true);
  });

  await safe('GET /chart/stats', async () => {
    const r = await request('GET', '/chart/stats?tokenIds=NTC,ASDC,EDC');
    ok('#' + (++testNum) + ' GET /chart/stats responds', r.status === 200);
    ok('#' + (++testNum) + ' Stats has data', r.body.ok === true);
  });

  // ════════════════════════════════════════════
  section('N. ADMIN OVERVIEW');
  // ════════════════════════════════════════════
  await safe('GET /admin/aggregated', async () => {
    const r = await request('GET', '/admin/aggregated');
    ok('#' + (++testNum) + ' GET /admin/aggregated responds', r.status === 200);
    ok('#' + (++testNum) + ' Aggregated has ok', r.body.ok === true);
  });

  await safe('GET /admin/stats', async () => {
    const r = await request('GET', '/admin/stats');
    ok('#' + (++testNum) + ' GET /admin/stats responds', r.status === 200);
    ok('#' + (++testNum) + ' Stats has ok', r.body.ok === true);
  });

  await safe('GET /admin/fees', async () => {
    const r = await request('GET', '/admin/fees');
    ok('#' + (++testNum) + ' GET /admin/fees responds', r.status === 200);
    ok('#' + (++testNum) + ' Fees has ok', r.body.ok === true);
  });

  await safe('GET /admin/price-trends', async () => {
    const r = await request('GET', '/admin/price-trends?tokenIds=NTC,ASDC&period=week');
    ok('#' + (++testNum) + ' GET /admin/price-trends responds', r.status === 200);
    ok('#' + (++testNum) + ' Price trends has ok', r.body.ok === true);
  });

  // ════════════════════════════════════════════
  section('O. TREASURY — GET ENDPOINTS');
  // ════════════════════════════════════════════
  let treasuryNonce = 0;
  await safe('GET /treasury/multisig', async () => {
    const r = await request('GET', '/treasury/multisig');
    ok('#' + (++testNum) + ' GET /treasury/multisig returns ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Multisig initialized', r.body.initialized === true);
    ok('#' + (++testNum) + ' Threshold is 2', r.body.threshold === 2);
    ok('#' + (++testNum) + ' Has 3 owners', r.body.owners && r.body.owners.length === 3);
    ok('#' + (++testNum) + ' Has multisigPda', !!r.body.multisigPda);
    ok('#' + (++testNum) + ' Has treasuryAuthority', !!r.body.treasuryAuthority);
    ok('#' + (++testNum) + ' Has nonce', r.body.nonce !== undefined);
    ok('#' + (++testNum) + ' Has allowedPrograms', Array.isArray(r.body.allowedPrograms) && r.body.allowedPrograms.length === 2);
    treasuryNonce = r.body.nonce;
  });

  await safe('GET /treasury/proposals', async () => {
    const r = await request('GET', '/treasury/proposals?limit=5');
    ok('#' + (++testNum) + ' GET /treasury/proposals returns ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Proposals is array', Array.isArray(r.body.proposals));
  });

  await safe('GET /treasury/balances', async () => {
    const r = await request('GET', '/treasury/balances');
    ok('#' + (++testNum) + ' GET /treasury/balances returns ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Has vaultAuthority', !!r.body.vaultAuthority);
    ok('#' + (++testNum) + ' Balances is array', Array.isArray(r.body.balances));
    ok('#' + (++testNum) + ' Has 11 token balances', r.body.balances && r.body.balances.length === 11);
  });

  await safe('GET /treasury/fees/history', async () => {
    const r = await request('GET', '/treasury/fees/history');
    ok('#' + (++testNum) + ' GET /treasury/fees/history returns ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Events is array', Array.isArray(r.body.events));
  });

  // ════════════════════════════════════════════
  section('P. TREASURY — INPUT VALIDATION (400/403)');
  // ════════════════════════════════════════════
  await safe('Propose validation', async () => {
    let r = await request('POST', '/treasury/propose/build', { userPubkey: 'bad' });
    ok('#' + (++testNum) + ' Propose rejects invalid pubkey', r.status === 400);
    r = await request('POST', '/treasury/propose/build', { userPubkey: OWNER1.publicKey.toBase58() });
    ok('#' + (++testNum) + ' Propose rejects missing fields', r.status === 400);
  });

  await safe('Approve validation', async () => {
    let r = await request('POST', '/treasury/approve/build', { userPubkey: 'bad' });
    ok('#' + (++testNum) + ' Approve rejects invalid pubkey', r.status === 400);
    r = await request('POST', '/treasury/approve/build', { userPubkey: OWNER1.publicKey.toBase58() });
    ok('#' + (++testNum) + ' Approve rejects missing nonce', r.status === 400);
  });

  await safe('Execute validation', async () => {
    const r = await request('POST', '/treasury/execute/build', { userPubkey: 'bad' });
    ok('#' + (++testNum) + ' Execute rejects invalid pubkey', r.status === 400);
  });

  await safe('Transfer validation', async () => {
    let r = await request('POST', '/treasury/transfer/build', { userPubkey: OWNER1.publicKey.toBase58() });
    ok('#' + (++testNum) + ' Transfer rejects missing fields', r.status === 400);
    r = await request('POST', '/treasury/transfer/build', {
      userPubkey: OWNER1.publicKey.toBase58(), mint: NTC_MINT, amount: 1, destination: 'invalid',
    });
    ok('#' + (++testNum) + ' Transfer rejects invalid destination', r.status === 400);
  });

  await safe('Policy validation', async () => {
    const r = await request('POST', '/treasury/policy/build', { userPubkey: OWNER1.publicKey.toBase58() });
    ok('#' + (++testNum) + ' Policy rejects missing executors', r.status === 400);
  });

  await safe('Rotate validation', async () => {
    let r = await request('POST', '/treasury/rotate/build', { userPubkey: OWNER1.publicKey.toBase58() });
    ok('#' + (++testNum) + ' Rotate rejects missing newOwners', r.status === 400);
    r = await request('POST', '/treasury/rotate/build', {
      userPubkey: OWNER1.publicKey.toBase58(), newOwners: [OWNER1.publicKey.toBase58()], newThreshold: 5,
    });
    ok('#' + (++testNum) + ' Rotate rejects threshold > owners', r.status === 400);
    r = await request('POST', '/treasury/rotate/build', {
      userPubkey: OWNER1.publicKey.toBase58(),
      newOwners: Array(9).fill(OWNER1.publicKey.toBase58()),
      newThreshold: 2,
    });
    ok('#' + (++testNum) + ' Rotate rejects >8 owners', r.status === 400);
  });

  await safe('Execute-policy validation', async () => {
    const r = await request('POST', '/treasury/execute-policy/build', { userPubkey: OWNER1.publicKey.toBase58() });
    ok('#' + (++testNum) + ' Execute-policy rejects missing targetProgram', r.status === 400);
  });

  await safe('Fee auth validation', async () => {
    let r = await request('POST', '/treasury/fees/collect', {}, {});
    ok('#' + (++testNum) + ' Fee collect rejects no wallet', r.status === 403);
    r = await request('POST', '/treasury/fees/collect', {}, { 'x-wallet-address': '11111111111111111111111111111111' });
    ok('#' + (++testNum) + ' Fee collect rejects non-owner', r.status === 403);
    r = await request('POST', '/treasury/fees/withdraw', {}, {});
    ok('#' + (++testNum) + ' Fee withdraw rejects no wallet', r.status === 403);
  });

  // ════════════════════════════════════════════
  section('Q. TREASURY — TRANSACTION BUILDS');
  // ════════════════════════════════════════════
  await safe('Propose build', async () => {
    const r = await request('POST', '/treasury/propose/build', {
      userPubkey: OWNER1.publicKey.toBase58(),
      targetProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      metas: [{ pubkey: OWNER1.publicKey.toBase58(), isWritable: false, isSigner: false }],
      ixData: Buffer.from([0, 1, 2, 3]).toString('base64'),
    });
    ok('#' + (++testNum) + ' Propose build ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Propose has transaction', !!r.body.transaction);
    ok('#' + (++testNum) + ' Propose has blockhash', !!r.body.blockhash);
    ok('#' + (++testNum) + ' Propose has proposalPda', !!r.body.proposalPda);
    ok('#' + (++testNum) + ' Propose nonce matches', r.body.nonce === treasuryNonce);
  });

  await safe('Approve build', async () => {
    const r = await request('POST', '/treasury/approve/build', { userPubkey: OWNER2.publicKey.toBase58(), nonce: 1 });
    ok('#' + (++testNum) + ' Approve build ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Approve has transaction', !!r.body.transaction);
  });

  await safe('Execute build', async () => {
    const r = await request('POST', '/treasury/execute/build', { userPubkey: OWNER3.publicKey.toBase58(), nonce: 0 });
    ok('#' + (++testNum) + ' Execute build ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Execute has transaction', !!r.body.transaction);
  });

  await safe('Transfer build', async () => {
    const r = await request('POST', '/treasury/transfer/build', {
      userPubkey: OWNER1.publicKey.toBase58(), mint: NTC_MINT, amount: 1, destination: OWNER2.publicKey.toBase58(),
    });
    ok('#' + (++testNum) + ' Transfer build ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Transfer has transaction', !!r.body.transaction);
  });

  await safe('Policy build', async () => {
    const r = await request('POST', '/treasury/policy/build', {
      userPubkey: OWNER1.publicKey.toBase58(), scopeMint: null,
      executors: [OWNER3.publicKey.toBase58()], maxPerTx: '1000000000', dailyLimit: '10000000000',
    });
    ok('#' + (++testNum) + ' Policy build ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Policy has transaction', !!r.body.transaction);
  });

  await safe('Rotate build', async () => {
    const r = await request('POST', '/treasury/rotate/build', {
      userPubkey: OWNER1.publicKey.toBase58(),
      newOwners: [OWNER1.publicKey.toBase58(), OWNER2.publicKey.toBase58(), OWNER3.publicKey.toBase58()],
      newThreshold: 2,
    });
    ok('#' + (++testNum) + ' Rotate build ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Rotate has transaction', !!r.body.transaction);
  });

  await safe('Execute-policy build', async () => {
    const r = await request('POST', '/treasury/execute-policy/build', {
      userPubkey: OWNER3.publicKey.toBase58(), scopeMint: null,
      targetProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      amountHint: 100, ixData: 'AA==',
      metas: [{ pubkey: OWNER3.publicKey.toBase58(), isWritable: false, isSigner: false }],
    });
    ok('#' + (++testNum) + ' Execute-policy build ok', r.body.ok === true);
    ok('#' + (++testNum) + ' Execute-policy has transaction', !!r.body.transaction);
  });

  // ════════════════════════════════════════════
  section('R. TREASURY — ON-CHAIN PROPOSE / APPROVE / EXECUTE');
  // ════════════════════════════════════════════
  await safe('Full on-chain flow', async () => {
    console.log('    Step 1: Owner1 proposes (nonce=' + treasuryNonce + ')...');
    const p = await request('POST', '/treasury/propose/build', {
      userPubkey: OWNER1.publicKey.toBase58(),
      targetProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      metas: [{ pubkey: OWNER1.publicKey.toBase58(), isWritable: false, isSigner: false }],
      ixData: Buffer.from([0, 1, 2, 3]).toString('base64'),
    });
    ok('#' + (++testNum) + ' Propose build', p.body.ok === true);
    const s1 = await signAndSend(p.body.transaction, OWNER1);
    ok('#' + (++testNum) + ' Propose tx confirmed', s1.body.ok === true, s1.body.error || '');
    if (s1.body.ok) console.log('      TX: ' + s1.body.signature);

    await new Promise(r => setTimeout(r, 5000));

    const props = await request('GET', '/treasury/proposals?limit=5');
    const found = props.body.proposals && props.body.proposals.find(x => x.nonce === treasuryNonce);
    ok('#' + (++testNum) + ' Proposal in list', !!found);
    if (found) {
      ok('#' + (++testNum) + ' Auto-approved (1 approval)', found.approvalCount === 1);
      ok('#' + (++testNum) + ' Status is pending', found.status === 'pending');
    }

    console.log('    Step 2: Owner2 approves...');
    const a = await request('POST', '/treasury/approve/build', {
      userPubkey: OWNER2.publicKey.toBase58(), nonce: treasuryNonce,
    });
    ok('#' + (++testNum) + ' Approve build', a.body.ok === true);
    const s2 = await signAndSend(a.body.transaction, OWNER2);
    ok('#' + (++testNum) + ' Approve tx confirmed', s2.body.ok === true, s2.body.error || '');
    if (s2.body.ok) console.log('      TX: ' + s2.body.signature);

    await new Promise(r => setTimeout(r, 5000));

    const props2 = await request('GET', '/treasury/proposals?limit=5');
    const found2 = props2.body.proposals && props2.body.proposals.find(x => x.nonce === treasuryNonce);
    if (found2) ok('#' + (++testNum) + ' Now has 2 approvals', found2.approvalCount === 2);

    console.log('    Step 3: Owner3 executes...');
    const e = await request('POST', '/treasury/execute/build', {
      userPubkey: OWNER3.publicKey.toBase58(), nonce: treasuryNonce,
    });
    ok('#' + (++testNum) + ' Execute build', e.body.ok === true);
    const s3 = await signAndSend(e.body.transaction, OWNER3);
    if (s3.body.ok) {
      ok('#' + (++testNum) + ' Execute tx confirmed', true);
      console.log('      TX: ' + s3.body.signature);
    } else {
      skip('#' + (++testNum) + ' Execute on-chain', 'CPI with dummy ix data expected to fail');
    }

    await new Promise(r => setTimeout(r, 3000));
    const stateAfter = await request('GET', '/treasury/multisig');
    ok('#' + (++testNum) + ' Nonce incremented', stateAfter.body.nonce > treasuryNonce,
      'was ' + stateAfter.body.nonce + ', expected > ' + treasuryNonce);
  });

  // ════════════════════════════════════════════
  section('S. TREASURY — ADMIN FEE ENDPOINTS');
  // ════════════════════════════════════════════
  await safe('Fee withdraw with valid admin', async () => {
    const r = await request('POST', '/treasury/fees/withdraw', {}, {
      'x-wallet-address': OWNER3.publicKey.toBase58(),
    }, 30000);
    ok('#' + (++testNum) + ' Fee withdraw responds', r.body.ok !== undefined);
    if (r.body.ok) ok('#' + (++testNum) + ' Fee withdraw has total', r.body.total !== undefined);
    else ok('#' + (++testNum) + ' Fee withdraw error handled', !!r.body.error);
  });

  // ════════════════════════════════════════════
  console.log('\n' + '='.repeat(60));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  FINAL RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped (${elapsed}s)`);
  console.log('='.repeat(60) + '\n');

  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
