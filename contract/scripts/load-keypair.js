'use strict';

const fs = require('fs');
const path = require('path');
const { Keypair } = require('@solana/web3.js');

function _resolveBytes() {
  const privKey = process.env.WALLET_KEY || process.env.TRADE_BOT_PRIVATE_KEY;
  if (privKey) {
    const trimmed = privKey.trim();

    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return new Uint8Array(arr);
      }
    } catch (_) {}

    try {
      const bs58 = require('bs58');
      const decoded = bs58.decode(trimmed);
      if (decoded.length === 64 || decoded.length === 32) {
        return new Uint8Array(decoded);
      }
    } catch (_) {}

    if (/^[0-9,\s\[\]]+$/.test(trimmed)) {
      try {
        const nums = trimmed.replace(/[\[\]\s]/g, '').split(',').map(Number);
        return Uint8Array.from(nums);
      } catch (_) {}
    }
  }

  const fp = process.env.WALLET_KEYPAIR_PATH;
  if (fp) {
    const abs = path.isAbsolute(fp) ? fp : path.resolve(process.cwd(), fp);
    if (fs.existsSync(abs)) {
      const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
      return Uint8Array.from(raw);
    }
  }

  throw new Error(
    'No wallet keypair found. Set WALLET_KEY (base58 or JSON array) in your .env file.'
  );
}

function getWalletBytes() {
  return _resolveBytes();
}

function loadKeypairFromEnv() {
  return Keypair.fromSecretKey(getWalletBytes());
}

module.exports = { loadKeypairFromEnv, getWalletBytes };
