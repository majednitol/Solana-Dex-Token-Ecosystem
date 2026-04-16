'use strict';

const fs = require('fs');
const path = require('path');

let _cachedBytes = null;

function getWalletBytes() {
  if (_cachedBytes) return new Uint8Array(_cachedBytes);

  const privKey = process.env.WALLET_KEY || process.env.TRADE_BOT_PRIVATE_KEY;
  if (privKey) {
    const trimmed = privKey.trim();
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        _cachedBytes = new Uint8Array(arr);
        console.log('[Wallet] Loaded from WALLET_KEY (JSON array)');
        return new Uint8Array(_cachedBytes);
      }
    } catch (_) {}

    try {
      const bs58 = require('bs58');
      const decoded = bs58.decode(trimmed);
      if (decoded.length === 64 || decoded.length === 32) {
        _cachedBytes = new Uint8Array(decoded);
        console.log('[Wallet] Loaded from WALLET_KEY (base58)');
        return new Uint8Array(_cachedBytes);
      }
    } catch (_) {}

    if (/^[0-9,\s\[\]]+$/.test(trimmed)) {
      try {
        const nums = trimmed.replace(/[\[\]\s]/g, '').split(',').map(Number);
        _cachedBytes = new Uint8Array(nums);
        console.log('[Wallet] Loaded from WALLET_KEY (comma-separated)');
        return new Uint8Array(_cachedBytes);
      } catch (_) {}
    }
  }

  throw new Error('Missing wallet: set WALLET_KEY (base58 or JSON array) in your .env file');
}

function getWalletKeypair() {
  const { Keypair } = require('@solana/web3.js');
  return Keypair.fromSecretKey(getWalletBytes());
}

module.exports = { getWalletBytes, getWalletKeypair };
