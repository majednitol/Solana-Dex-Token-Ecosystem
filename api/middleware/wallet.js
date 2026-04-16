'use strict';

const { PublicKey } = require('@solana/web3.js');

function extractWalletAddress(req, searchParams) {
  const ownerParam = searchParams && typeof searchParams.get === 'function'
    ? searchParams.get('owner')
    : (searchParams && searchParams.owner) || null;

  return (
    ownerParam ||
    req.headers['x-wallet-address'] ||
    null
  );
}

function isValidSolanaPublicKey(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    new PublicKey(str);
    return true;
  } catch {
    return false;
  }
}

function requireWallet(req, searchParams) {
  const address = extractWalletAddress(req, searchParams);

  if (!address) {
    return {
      error: true,
      status: 400,
      body: {
        ok: false,
        error: 'Missing wallet address. Provide ?owner=PUBLIC_KEY query param or x-wallet-address header.',
      },
    };
  }

  if (!isValidSolanaPublicKey(address)) {
    return {
      error: true,
      status: 400,
      body: {
        ok: false,
        error: `Invalid Solana public key: ${address}`,
      },
    };
  }

  return { error: false, walletAddress: address };
}

function optionalWallet(req, searchParams, fallback) {
  const address = extractWalletAddress(req, searchParams);

  if (!address) {
    return { walletAddress: fallback || null };
  }

  if (!isValidSolanaPublicKey(address)) {
    return {
      error: true,
      status: 400,
      body: {
        ok: false,
        error: `Invalid Solana public key: ${address}`,
      },
    };
  }

  return { error: false, walletAddress: address };
}

module.exports = { extractWalletAddress, isValidSolanaPublicKey, requireWallet, optionalWallet };
