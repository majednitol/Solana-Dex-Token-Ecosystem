'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const PROD_URL = 'https://api.nowpayments.io/v1/';
const SANDBOX_URL = 'https://api-sandbox.nowpayments.io/v1/';

function loadSdk(useSandbox) {
  const distPath = require.resolve('@nowpaymentsio/nowpayments-api-js');

  if (!useSandbox) {
    return require(distPath);
  }

  let source = fs.readFileSync(distPath, 'utf8');
  source = source.replace(PROD_URL, SANDBOX_URL);

  const m = new Module(distPath + '-sandbox', module);
  m.filename = distPath;
  m.paths = Module._nodeModulePaths(path.dirname(distPath));
  m._compile(source, distPath);

  return m.exports;
}

function verifySdkPatchable() {
  const distPath = require.resolve('@nowpaymentsio/nowpayments-api-js');
  const source = require('fs').readFileSync(distPath, 'utf8');
  if (!source.includes(PROD_URL)) {
    throw new Error(
      `[NOWPayments] SDK patch verification failed: base URL '${PROD_URL}' not found in SDK bundle. ` +
      'The SDK may have been updated — sandbox patching will not work. Pin to v1.0.5.'
    );
  }
}

module.exports = { loadSdk, verifySdkPatchable };
