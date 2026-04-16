'use strict';

const WHIRLPOOL_ERRORS = {
  0x1770: 'Invalid enum value',
  0x1771: 'Invalid start tick index',
  0x1772: 'Tick array already exists for this pool',
  0x1773: 'Tick array index out of bounds',
  0x1774: 'Invalid tick spacing',
  0x1775: 'Close position not empty',
  0x1776: 'Division by zero',
  0x1777: 'Invalid timestamp conversion',
  0x1778: 'Number downcast error',
  0x1779: 'Token max exceeded',
  0x177a: 'Token min not met',
  0x177b: 'Missing or invalid delegate',
  0x177c: 'Invalid position token amount',
  0x177d: 'Invalid timestamp',
  0x177e: 'Invalid claim timestamp',
  0x177f: 'Account not found',
  0x1780: 'Overflow or underflow',
  0x1781: 'Token vault amount mismatch',
  0x1782: 'Invalid fee index',
  0x1783: 'Invalid reward index',
  0x1784: 'Insufficient reward available',
  0x1785: 'Zero tradable amount',
  0x1786: 'Amount out below minimum',
  0x1787: 'Amount in above maximum',
  0x1788: 'Tick not found',
  0x1789: 'Tick index out of bounds',
  0x178a: 'Sqrt price out of bounds',
  0x178b: 'Liquidity zero',
  0x178c: 'Liquidity too high',
  0x178d: 'Liquidity overflow',
  0x178e: 'Liquidity underflow',
  0x178f: 'Tick liquidity net overflow',
  0x1790: 'Exceeds max fee rate',
  0x1791: 'Exceeds max protocol fee rate',
  0x1792: 'Exceeds max proportion',
  0x1793: 'Token pair order mismatch',
  0x1794: 'This pool already exists',
  0x1795: 'Invalid bundle index',
  0x1796: 'Bundle index occupied',
  0x1797: 'Bundle index unoccupied',
  0x1798: 'Unsupported token mint',
};

const SYSTEM_PROGRAM_ERRORS = {
  0: 'Account already in use',
  1: 'Insufficient funds for transaction',
  2: 'Invalid account data length',
  3: 'Insufficient funds for rent',
  4: 'Incorrect program ID',
  5: 'Missing required signature',
  7: 'Account already initialized',
  8: 'Attempt to debit from an account with no funds',
  9: 'Address lookup table not found',
};

const TOKEN_PROGRAM_ERRORS = {
  0: 'Not rent exempt — insufficient SOL for account',
  1: 'Insufficient token balance',
  2: 'Invalid mint',
  3: 'Account owner mismatch',
  4: 'Fixed supply exceeded',
  5: 'Account already initialized',
  6: 'Account not initialized',
  7: 'Account frozen',
  10: 'Account does not have enough SOL',
  13: 'Invalid number of required signers',
  14: 'State is not initialized',
  17: 'Account not associated with this mint',
};

const TOKEN_CORE_ERRORS = {
  6000: 'Unauthorized — you do not have permission for this action',
  6001: 'Invalid amount',
  6002: 'Math overflow',
};

const FRIENDLY_PATTERNS = [
  { pattern: /insufficient lamports/i, message: 'Insufficient SOL for transaction fees' },
  { pattern: /Token\w*Program.*custom program error:\s*0x1\b|custom program error:\s*0x1\b.*[Tt]oken|Instruction #\d+.*custom program error:\s*0x1\b/i, message: 'Insufficient token balance — you may have less available due to transfer fees withheld by Token-2022' },
  { pattern: /insufficient funds/i, message: 'Insufficient funds for transaction' },
  { pattern: /account already in use/i, message: 'This pool or account already exists' },
  { pattern: /already initialized/i, message: 'This pool or account is already initialized' },
  { pattern: /blockhash not found/i, message: 'Transaction expired — please try again' },
  { pattern: /block height exceeded/i, message: 'Transaction expired — please try again' },
  { pattern: /node is behind/i, message: 'Network is congested — please try again in a moment' },
  { pattern: /rate limit/i, message: 'Too many requests — please wait and try again' },
  { pattern: /network error|ECONNREFUSED|ETIMEDOUT|fetch failed/i, message: 'Network error — please check your connection and try again' },
  { pattern: /account not found/i, message: 'Required account not found on-chain' },
  { pattern: /not rent exempt/i, message: 'Not enough SOL to cover account rent' },
  { pattern: /privilege escalation/i, message: 'Unauthorized transaction — missing required signer' },
  { pattern: /missing required signature/i, message: 'Transaction is missing a required signature' },
];

function extractErrorCodes(errorStr) {
  const results = [];

  const hexHashMatch = errorStr.match(/#\s*0x([0-9a-fA-F]+)/);
  if (hexHashMatch) {
    results.push({ code: parseInt(hexHashMatch[1], 16), raw: '0x' + hexHashMatch[1] });
  }

  const solanaErrMatch = errorStr.match(/Solana error #(\d+)/i);
  if (solanaErrMatch) {
    const dec = parseInt(solanaErrMatch[1], 10);
    results.push({ code: dec, raw: solanaErrMatch[1] });
  }

  const customHexMatch = errorStr.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
  if (customHexMatch) {
    results.push({ code: parseInt(customHexMatch[1], 16), raw: '0x' + customHexMatch[1] });
  }

  const customDecMatch = errorStr.match(/custom program error:\s*(\d+)(?!\s*x)/i);
  if (customDecMatch && !customHexMatch) {
    results.push({ code: parseInt(customDecMatch[1], 10), raw: customDecMatch[1] });
  }

  const rawHexMatch = errorStr.match(/\b0x([0-9a-fA-F]{4,})\b/);
  if (rawHexMatch && !hexHashMatch && !customHexMatch) {
    results.push({ code: parseInt(rawHexMatch[1], 16), raw: '0x' + rawHexMatch[1] });
  }

  return results;
}

function lookupErrorCode(code) {
  if (WHIRLPOOL_ERRORS[code]) return WHIRLPOOL_ERRORS[code];

  if (code >= 0x1770 && code <= 0x17ff) {
    return `Orca Whirlpool error (code: 0x${code.toString(16)})`;
  }

  if (TOKEN_CORE_ERRORS[code] !== undefined) return TOKEN_CORE_ERRORS[code];

  if (code <= 20) {
    if (TOKEN_PROGRAM_ERRORS[code] !== undefined) return TOKEN_PROGRAM_ERRORS[code];
    if (SYSTEM_PROGRAM_ERRORS[code] !== undefined) return SYSTEM_PROGRAM_ERRORS[code];
  }

  return null;
}

function parseJsonTxError(errorStr) {
  try {
    const parsed = typeof errorStr === 'string' ? JSON.parse(errorStr) : errorStr;
    if (parsed?.InstructionError) {
      const [, detail] = parsed.InstructionError;
      if (detail?.Custom !== undefined) {
        return lookupErrorCode(detail.Custom);
      }
      if (typeof detail === 'string') {
        const known = { InsufficientFunds: 'Insufficient funds for transaction', InvalidAccountData: 'Invalid account data' };
        return known[detail] || detail;
      }
    }
  } catch {}
  return null;
}

function decodeSolanaError(rawError) {
  if (!rawError) return 'Transaction failed';

  const jsonResult = parseJsonTxError(rawError);
  if (jsonResult) return jsonResult;

  const errorStr = typeof rawError === 'string' ? rawError : (rawError.message || String(rawError));

  if (errorStr.includes('User rejected')) return null;

  for (const { pattern, message } of FRIENDLY_PATTERNS) {
    if (pattern.test(errorStr)) {
      if (message) return message;
    }
  }

  const codes = extractErrorCodes(errorStr);
  for (const { code, raw } of codes) {
    const friendly = lookupErrorCode(code);
    if (friendly) return friendly;
  }

  if (codes.length > 0) {
    return 'Transaction failed — please try again';
  }

  const cleanMsg = errorStr
    .replace(/Decode this error by running[:\s].*$/i, '')
    .replace(/npx @solana\/errors decode.*/i, '')
    .replace(/Solana error #\d+;?\s*/gi, '')
    .replace(/0x[0-9a-fA-F]{4,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanMsg || cleanMsg.length < 5 || /^[\W\d\s]+$/.test(cleanMsg)) {
    return 'Transaction failed — please try again';
  }

  if (cleanMsg.length > 120) {
    return 'Transaction failed — please try again';
  }

  return cleanMsg;
}

module.exports = { decodeSolanaError, extractErrorCodes, lookupErrorCode };
