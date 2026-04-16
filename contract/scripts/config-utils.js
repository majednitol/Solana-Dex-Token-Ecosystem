'use strict';

const fs = require('fs');
const path = require('path');

const CONTRACT_DIR = path.resolve(__dirname, '..');
const MINTED_TOKENS_PATH = path.join(CONTRACT_DIR, 'minted.tokens.json');
const NETWORK = (process.env.SOLANA_NETWORK || 'mainnet').toLowerCase();
const POOLS_PATH = path.join(__dirname, `orca-pools.${NETWORK}.json`);
const ANCHOR_TOML_PATH = path.join(CONTRACT_DIR, 'Anchor.toml');

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getProgramIds() {
  const toml = fs.readFileSync(ANCHOR_TOML_PATH, 'utf8');
  const ids = {};
  const section = NETWORK === 'mainnet' ? 'mainnet' : 'devnet';
  const sectionMatch = toml.match(new RegExp(`\\[programs\\.${section}\\]([\\s\\S]*?)(?=\\n\\[|$)`));
  if (!sectionMatch) throw new Error(`No [programs.${section}] section in Anchor.toml`);

  const lines = sectionMatch[1].trim().split('\n');
  for (const line of lines) {
    const m = line.match(/^([\w-]+)\s*=\s*"([^"]+)"/);
    if (m) {
      const key = m[1].replace(/-/g, '_');
      ids[key] = m[2];
    }
  }

  return {
    tokenCore: ids.token_core_contracts || null,
  };
}

function getMints() {
  const data = readJsonSafe(MINTED_TOKENS_PATH);
  if (!data || !Array.isArray(data)) return {};

  const mints = {};
  for (const token of data) {
    mints[token.symbol] = token.mint;
  }
  return mints;
}

function getMintsFull() {
  const data = readJsonSafe(MINTED_TOKENS_PATH);
  if (!data || !Array.isArray(data)) return [];
  return data;
}

function getPools() {
  const data = readJsonSafe(POOLS_PATH);
  if (!data || !data.results) return [];

  return data.results
    .filter(r => r.ok && r.poolAddress)
    .map(r => ({
      pair: r.pair,
      poolAddress: r.poolAddress,
      mintA: r.mintA,
      mintB: r.mintB,
    }));
}

function getPoolAddresses() {
  return getPools().map(p => p.poolAddress);
}

module.exports = {
  CONTRACT_DIR,
  MINTED_TOKENS_PATH,
  POOLS_PATH,
  ANCHOR_TOML_PATH,
  getProgramIds,
  getMints,
  getMintsFull,
  getPools,
  getPoolAddresses,
};
