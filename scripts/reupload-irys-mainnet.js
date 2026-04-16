#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '..', 'api', '.env') });

if (process.env.SOLANA_NETWORK !== 'mainnet') {
  console.error('SOLANA_NETWORK must be "mainnet" for this script. Current:', process.env.SOLANA_NETWORK);
  process.exit(1);
}

const { Connection } = require('@solana/web3.js');
const { getWalletKeypair } = require('../api/utils/wallet');
const { getRpcUrl } = require('../api/utils/network');
const { TokenCreationService } = require('../api/services/token-creation.service');

const MINTED_TOKENS_PATH = path.resolve(__dirname, '..', 'contract', 'minted.tokens.json');
const LOGOS_DIR = path.resolve(__dirname, '..', 'contract', 'logos');
const COMMITMENT = 'confirmed';

async function main() {
  const wallet = getWalletKeypair();
  const rpcUrl = getRpcUrl();
  const connection = new Connection(rpcUrl, COMMITMENT);

  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('RPC:', rpcUrl);

  const tokens = JSON.parse(fs.readFileSync(MINTED_TOKENS_PATH, 'utf8'));
  console.log(`\nFound ${tokens.length} tokens to re-upload.\n`);

  console.log('Checking on-chain mint existence...');
  const { PublicKey } = require('@solana/web3.js');
  const onChainStatus = {};
  for (const token of tokens) {
    try {
      const acct = await connection.getAccountInfo(new PublicKey(token.mint));
      onChainStatus[token.mint] = !!acct;
      console.log(`  ${token.symbol} (${token.mint}): ${acct ? 'EXISTS' : 'NOT FOUND on mainnet'}`);
    } catch (e) {
      onChainStatus[token.mint] = false;
      console.log(`  ${token.symbol} (${token.mint}): ERROR - ${e.message}`);
    }
  }
  const existCount = Object.values(onChainStatus).filter(Boolean).length;
  console.log(`\n${existCount}/${tokens.length} mints exist on mainnet.`);
  if (existCount === 0) {
    console.log('NOTE: No mints found on mainnet. On-chain URI updates are not applicable.');
    console.log('Tokens will need to be re-minted on mainnet. Proceeding with Irys uploads\n'
      + 'so metadata is ready for when tokens are minted.\n');
  }

  const tokenService = new TokenCreationService({
    connection,
    wallet,
    tokenCoreProgramId: null,
    apiBaseUrl: '',
  });

  const results = [];

  for (const token of tokens) {
    const { symbol, name, mint } = token;
    console.log(`\n========== ${symbol} (${name}) ==========`);
    console.log(`Mint: ${mint} (on-chain: ${onChainStatus[mint] ? 'EXISTS' : 'NOT FOUND'})`);

    const logoFile = path.join(LOGOS_DIR, `${symbol.toUpperCase()}.png`);
    if (!fs.existsSync(logoFile)) {
      console.error(`  Logo not found: ${logoFile} — SKIPPING`);
      results.push({ symbol, mint, error: 'Logo file not found' });
      continue;
    }

    try {
      console.log('  1) Uploading logo to Irys mainnet...');
      const newImageUrl = await tokenService.uploadLogoToIrys(logoFile, symbol);
      console.log(`     New image URL: ${newImageUrl}`);

      console.log('  2) Uploading metadata JSON to Irys mainnet...');
      const metadataJson = {
        name,
        symbol: symbol.toUpperCase(),
        description: `${name} (${symbol.toUpperCase()}) token.`,
        image: newImageUrl,
        external_url: 'https://cryptoniteswap.com',
        attributes: [
          { trait_type: 'decimals', value: '5' },
          { trait_type: 'transferFeeBps', value: '5' },
        ],
      };
      const newMetadataUri = await tokenService.uploadMetadataToIrys(metadataJson, symbol);
      console.log(`     New metadata URI: ${newMetadataUri}`);

      results.push({ symbol, mint, newImageUrl, newMetadataUri });
    } catch (err) {
      console.error(`  ERROR for ${symbol}:`, err.message);
      results.push({ symbol, mint, error: err.message });
    }
  }

  const successful = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);
  console.log(`\nSummary: ${successful.length} succeeded, ${failed.length} failed out of ${tokens.length} tokens.`);

  if (successful.length > 0) {
    console.log('\n3) Updating minted.tokens.json...');
    for (const res of successful) {
      const tok = tokens.find(t => t.mint === res.mint);
      if (tok) {
        tok.metadataUri = res.newMetadataUri;
        tok.imageUrl = res.newImageUrl;
      }
    }
    fs.writeFileSync(MINTED_TOKENS_PATH, JSON.stringify(tokens, null, 2) + '\n');
    console.log('   minted.tokens.json updated.');

    console.log('\n4) Updating database records...');
    try {
      const { initDatabase, query, shutdown } = require('../api/db/init');
      await initDatabase();

      for (const res of successful) {
        await query(
          'UPDATE tokens SET metadata_uri = $1, image_url = $2 WHERE mint_address = $3',
          [res.newMetadataUri, res.newImageUrl, res.mint]
        );
        console.log(`   DB updated for ${res.symbol} (${res.mint})`);
      }

      await shutdown();
    } catch (dbErr) {
      console.error('   DB update error:', dbErr.message);
    }
  }

  if (successful.length > 0) {
    console.log('\n=== IMPORTANT ===');
    console.log('Logos and metadata are now on Irys mainnet.');
    const mintsOnChain = successful.filter(r => onChainStatus[r.mint]);
    if (mintsOnChain.length > 0) {
      console.log('\nTokens with on-chain mints — update URI via admin panel "Update Metadata":');
      for (const res of mintsOnChain) {
        console.log(`  ${res.symbol}: ${res.newMetadataUri}`);
      }
    }
    const mintsNotOnChain = successful.filter(r => !onChainStatus[r.mint]);
    if (mintsNotOnChain.length > 0) {
      console.log('\nTokens NOT found on mainnet (need re-minting via admin panel):');
      for (const res of mintsNotOnChain) {
        console.log(`  ${res.symbol}: on-chain update not applicable — mint does not exist on mainnet`);
      }
      console.log('\nWhen re-minting these tokens, the Irys mainnet metadata is already uploaded');
      console.log('and will be used automatically by the token creation flow.');
    }
  }

  if (failed.length > 0) {
    console.log('\nFailed tokens:');
    for (const f of failed) {
      console.log(`  - ${f.symbol} (${f.mint}): ${f.error}`);
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
