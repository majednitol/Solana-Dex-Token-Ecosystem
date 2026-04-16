const FRIENDLY_PATTERNS = [
  { pattern: /User rejected/i, message: null },
  { pattern: /insufficient funds/i, message: 'Insufficient SOL for transaction fees' },
  { pattern: /insufficient lamports/i, message: 'Insufficient SOL for transaction fees' },
  { pattern: /insufficient balance/i, message: 'Insufficient balance' },
  { pattern: /insufficient token/i, message: 'Insufficient token balance' },
  { pattern: /blockhash not found/i, message: 'Transaction expired — please try again' },
  { pattern: /block height exceeded/i, message: 'Transaction expired — please try again' },
  { pattern: /node is behind/i, message: 'Network is congested — please try again in a moment' },
  { pattern: /rate limit/i, message: 'Too many requests — please wait and try again' },
  { pattern: /network error|ECONNREFUSED|ETIMEDOUT|fetch failed/i, message: 'Network error — please check your connection and try again' },
  { pattern: /slippage|SlippageToleranceExceeded|amount.*below.*minimum|0x1786/i, message: 'Price moved too much — try increasing slippage tolerance' },
  { pattern: /not rent exempt/i, message: 'Not enough SOL to cover account rent' },
  { pattern: /missing required signature/i, message: 'Transaction is missing a required signature' },
  { pattern: /simulation failed/i, message: 'Transaction simulation failed — please try again' },
  { pattern: /timeout|timed?\s*out/i, message: 'Transaction timed out — please try again' },
];

const SOLANA_ERROR_REGEX = /Solana error #\d+/i;
const HEX_CODE_REGEX = /#\s*0x[0-9a-fA-F]+/;
const DECODE_INSTRUCTION_REGEX = /Decode this error by running[:\s].*$/i;
const NPX_REGEX = /npx @solana\/errors.*/i;
const RAW_ERROR_REGEX = /0x[0-9a-fA-F]{4,}/;

export function decodeSolanaError(rawError) {
  if (!rawError) return 'Swap failed — please try again';

  const errorStr = typeof rawError === 'string'
    ? rawError
    : (rawError.message || String(rawError));

  for (const { pattern, message } of FRIENDLY_PATTERNS) {
    if (pattern.test(errorStr)) {
      return message;
    }
  }

  if (
    SOLANA_ERROR_REGEX.test(errorStr) ||
    HEX_CODE_REGEX.test(errorStr) ||
    DECODE_INSTRUCTION_REGEX.test(errorStr) ||
    NPX_REGEX.test(errorStr) ||
    RAW_ERROR_REGEX.test(errorStr)
  ) {
    return 'Swap failed — please try again';
  }

  return 'Swap failed — please try again';
}
