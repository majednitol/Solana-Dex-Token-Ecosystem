'use strict';

const fs = require('fs');
const path = require('path');
const { getProgramIds, getMints, getPoolAddresses } = require('./config-utils');

const ENV_PATH = path.resolve(__dirname, '../../api/.env');

const MANAGED_KEYS = new Set([
  'TOKEN_CORE_PROGRAM_ID',
  'ORCA_WHIRLPOOLS',
]);

function main() {
  console.log('[sync-env] Reading config files...');

  const programIds = getProgramIds();
  const mints = getMints();
  const poolAddresses = getPoolAddresses();

  const generated = {};

  generated['TOKEN_CORE_PROGRAM_ID'] = programIds.tokenCore;

  for (const [symbol, mint] of Object.entries(mints)) {
    generated[`${symbol}_MINT`] = mint;
    MANAGED_KEYS.add(`${symbol}_MINT`);
  }

  if (poolAddresses.length > 0) {
    generated['ORCA_WHIRLPOOLS'] = poolAddresses.join(',');
  }

  let existingLines = [];
  if (fs.existsSync(ENV_PATH)) {
    existingLines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  }

  const preserved = [];
  const seen = new Set();

  for (const line of existingLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      preserved.push(line);
      continue;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      preserved.push(line);
      continue;
    }

    const key = trimmed.substring(0, eqIdx);

    if (MANAGED_KEYS.has(key)) {
      if (!seen.has(key) && generated[key]) {
        preserved.push(`${key}=${generated[key]}`);
        seen.add(key);
      }
    } else {
      preserved.push(line);
      seen.add(key);
    }
  }

  for (const [key, value] of Object.entries(generated)) {
    if (!seen.has(key) && value) {
      preserved.push(`${key}=${value}`);
      seen.add(key);
    }
  }

  const content = preserved.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  fs.writeFileSync(ENV_PATH, content, 'utf8');

  console.log('[sync-env] Updated:', ENV_PATH);
  console.log('[sync-env] Program IDs:', Object.keys(programIds).length);
  console.log('[sync-env] Mints:', Object.keys(mints).length);
  console.log('[sync-env] Pools:', poolAddresses.length);
  console.log('[sync-env] Done.');
}

main();
