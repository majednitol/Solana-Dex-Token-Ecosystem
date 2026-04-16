'use strict';

const fs = require('fs');
const path = require('path');

const { Connection, Keypair } = require('@solana/web3.js');
const { getWalletBytes, getWalletKeypair } = require('../utils/wallet');
const { getRpcUrl, getOrcaWhirlpoolsConfig, createNetworkRpc } = require('../utils/network');
 
const {
  setWhirlpoolsConfig,
  setRpc,
  setPayerFromBytes,
} = require('@orca-so/whirlpools'); 

function mustEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env: ${name}`);
  return String(v).trim();
}

function optEnv(name, def = undefined) {
  const v = process.env[name];
  if (!v || !String(v).trim()) return def;
  return String(v).trim();
}

function readKeypairArray(filePath) {
  try {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const raw = fs.readFileSync(abs, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error(`Invalid keypair json: ${abs}`);
    return arr;
  } catch (_) {
    return Array.from(getWalletBytes());
  }
}

function readKeypairBytes(filePath) {
  const arr = readKeypairArray(filePath);
  const u8 = new Uint8Array(arr);
  return new Uint8Array(u8.buffer.slice(0));
}

function loadWalletKeypair() {
  return getWalletKeypair();
}

function getConnection() {
  const rpc = getRpcUrl();
  const commitment = optEnv('SOLANA_COMMITMENT', 'confirmed');
  return new Connection(rpc, commitment);
}


let cachedCtx = null;

async function create() {
  if (cachedCtx) return cachedCtx;

  const rpcUrl = getRpcUrl();
  const commitment = optEnv('SOLANA_COMMITMENT', 'confirmed');

  await setWhirlpoolsConfig(getOrcaWhirlpoolsConfig());
  await setRpc(rpcUrl);

  const walletBytes = getWalletBytes();
  const signer = await setPayerFromBytes(walletBytes);

  const payerKeypair = getWalletKeypair();
  const connection = new Connection(rpcUrl, commitment);

  const kitRpc = await createNetworkRpc(rpcUrl);

  cachedCtx = {
    rpcUrl,
    commitment,
    signer,       
    payerKeypair,  
    connection,    
    kitRpc,       
  };

  return cachedCtx;
}

async function getContext() {
  return create();
}

module.exports = {
  mustEnv,
  optEnv,
  readKeypairBytes,
  readKeypairArray,
  loadWalletKeypair,
  getConnection,
  create,
  getContext,
};
