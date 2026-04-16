'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');
const { optEnv } = require('./client');


const WHIRLPOOL_PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');

class OrcaSwapMonitor {
  constructor({ onSignature }) {
    if (typeof onSignature !== 'function') throw new Error('onSignature must be function');

    const { getRpcUrl } = require('../utils/network');
    const rpc = getRpcUrl();
    const commitment = optEnv('SOLANA_COMMITMENT', 'confirmed');

    this.onSignature = onSignature;
    this.connection = new Connection(rpc, commitment);
    this.programId = WHIRLPOOL_PROGRAM_ID;
    this.subId = null;
  }

  start() {
    if (this.subId) return;

    this.subId = this.connection.onLogs(
      this.programId,
      async (logInfo) => {
        try {
          const sig = logInfo.signature;
          await this.onSignature(sig, logInfo);
        } catch (_) {}
      },
      'confirmed'
    );
  }

  async stop() {
    if (!this.subId) return;
    await this.connection.removeOnLogsListener(this.subId);
    this.subId = null;
  }
}


let instance = null;

async function start({ onSwap }) {
  instance = new OrcaSwapMonitor({
    onSignature: async (signature, logInfo) => {
      await onSwap?.({ signature, logInfo });
    },
  });

  instance.start();

  return {
    stop: async () => {
      await instance?.stop();
      instance = null;
    },
  };
}

module.exports = {
  OrcaSwapMonitor,
  start,
};
