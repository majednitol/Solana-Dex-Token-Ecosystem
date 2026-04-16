'use strict';

const {
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} = require('@solana/spl-token');
const multisig = require('@sqds/multisig');

class SquadsService {
  constructor({ connection, wallet }) {
    this.connection = connection;
    this.wallet = wallet;
    this.multisigPda = null;
    this.vaultPda = null;
    this.createKey = null;
  }

  setMultisig(multisigPda) {
    this.multisigPda = new PublicKey(multisigPda);
    const [vault] = multisig.getVaultPda({
      multisigPda: this.multisigPda,
      index: 0,
    });
    this.vaultPda = vault;
    console.log(`[Squads] Multisig set: ${this.multisigPda.toBase58()}`);
    console.log(`[Squads] Vault PDA: ${this.vaultPda.toBase58()}`);
  }

  getVaultAddress() {
    if (!this.multisigPda) return null;
    const [vault] = multisig.getVaultPda({
      multisigPda: this.multisigPda,
      index: 0,
    });
    return vault;
  }

  async _checkMultisigLanded(msPda, sig) {
    if (sig) {
      try {
        const sigStatus = await this.connection.getSignatureStatus(sig, { searchTransactionHistory: true });
        if (sigStatus && sigStatus.value) {
          if (sigStatus.value.err) {
            console.log(`[Squads] Signature ${sig} has on-chain error: ${JSON.stringify(sigStatus.value.err)}`);
            return false;
          }
          const level = sigStatus.value.confirmationStatus;
          if (level === 'confirmed' || level === 'finalized') {
            console.log(`[Squads] Signature ${sig} is ${level} — transaction landed`);
            return true;
          }
        }
      } catch (_) {}
    }

    const FALLBACK_ATTEMPTS = 5;
    const FALLBACK_DELAY_MS = 3000;
    for (let i = 0; i < FALLBACK_ATTEMPTS; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, FALLBACK_DELAY_MS));
      }
      try {
        const existing = await multisig.accounts.Multisig.fromAccountAddress(
          this.connection,
          msPda
        );
        if (existing) {
          console.log(`[Squads] Multisig PDA exists on-chain (check ${i + 1}/${FALLBACK_ATTEMPTS})`);
          return true;
        }
      } catch (_) {}

      if (sig) {
        try {
          const sigStatus = await this.connection.getSignatureStatus(sig, { searchTransactionHistory: true });
          if (sigStatus && sigStatus.value) {
            if (sigStatus.value.err) {
              console.log(`[Squads] Signature ${sig} has on-chain error on retry ${i + 1}`);
              return false;
            }
            const level = sigStatus.value.confirmationStatus;
            if (level === 'confirmed' || level === 'finalized') {
              console.log(`[Squads] Signature ${sig} is ${level} on retry ${i + 1}`);
              return true;
            }
          }
        } catch (_) {}
      }
    }
    return false;
  }

  async buildCreateMultisigTransaction({ owners, threshold = 2, userPubkey }) {
    if (!owners || owners.length < 2) {
      throw new Error('At least 2 owners required');
    }
    if (threshold < 1 || threshold > owners.length) {
      throw new Error(`Threshold must be between 1 and ${owners.length}`);
    }

    const creatorPubkey = new PublicKey(userPubkey);
    const ck = Keypair.generate();
    this.createKey = ck;

    const [msPda] = multisig.getMultisigPda({
      createKey: ck.publicKey,
    });

    const [vaultPda] = multisig.getVaultPda({
      multisigPda: msPda,
      index: 0,
    });

    const members = owners.map((ownerKey) => ({
      key: new PublicKey(ownerKey),
      permissions: multisig.types.Permissions.all(),
    }));

    const [programConfigPda] = multisig.getProgramConfigPda({});
    const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
      this.connection,
      programConfigPda
    );

    const ix = multisig.instructions.multisigCreateV2({
      createKey: ck.publicKey,
      creator: creatorPubkey,
      multisigPda: msPda,
      configAuthority: null,
      timeLock: 0,
      members,
      threshold,
      rentCollector: null,
      treasury: programConfig.treasury,
    });

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('finalized');

    const msg = new TransactionMessage({
      payerKey: creatorPubkey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    tx.sign([ck]);

    const serialized = Buffer.from(tx.serialize()).toString('base64');

    console.log(`[Squads] buildCreateMultisigTransaction: multisigPda=${msPda.toBase58()}, vaultPda=${vaultPda.toBase58()}, createKey=${ck.publicKey.toBase58()}, payer=${userPubkey}`);

    return {
      ok: true,
      transaction: serialized,
      blockhash,
      lastValidBlockHeight,
      multisigPda: msPda.toBase58(),
      vaultPda: vaultPda.toBase58(),
      createKey: ck.publicKey.toBase58(),
    };
  }

  async createMultisig({ owners, threshold = 2, createKeyPair = null }) {
    if (!owners || owners.length < 2) {
      throw new Error('At least 2 owners required');
    }
    if (threshold < 1 || threshold > owners.length) {
      throw new Error(`Threshold must be between 1 and ${owners.length}`);
    }

    const ck = createKeyPair || Keypair.generate();
    this.createKey = ck;

    const [msPda] = multisig.getMultisigPda({
      createKey: ck.publicKey,
    });

    const members = owners.map((ownerKey) => ({
      key: new PublicKey(ownerKey),
      permissions: multisig.types.Permissions.all(),
    }));

    const [programConfigPda] = multisig.getProgramConfigPda({});
    const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
      this.connection,
      programConfigPda
    );

    const ix = multisig.instructions.multisigCreateV2({
      createKey: ck.publicKey,
      creator: this.wallet.publicKey,
      multisigPda: msPda,
      configAuthority: null,
      timeLock: 0,
      members,
      threshold,
      rentCollector: null,
      treasury: programConfig.treasury,
    });

    const MAX_ATTEMPTS = 3;
    const RESEND_INTERVAL_MS = 1000;
    let lastError;
    let sig;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { blockhash, lastValidBlockHeight } =
          await this.connection.getLatestBlockhash('finalized');

        const msg = new TransactionMessage({
          payerKey: this.wallet.publicKey,
          recentBlockhash: blockhash,
          instructions: [ix],
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);
        tx.sign([this.wallet, ck]);
        const serializedTx = Buffer.from(tx.serialize());

        if (attempt > 1) {
          console.log(`[Squads] createMultisig attempt ${attempt}/${MAX_ATTEMPTS} — retrying with fresh blockhash`);
        }

        sig = await this.connection.sendRawTransaction(serializedTx, {
          skipPreflight: true,
          maxRetries: 0,
        });
        console.log(`[Squads] Transaction sent: ${sig}`);

        const resendInterval = setInterval(async () => {
          try {
            await this.connection.sendRawTransaction(serializedTx, {
              skipPreflight: true,
              maxRetries: 0,
            });
          } catch (_) {}
        }, RESEND_INTERVAL_MS);

        try {
          const confirmResult = await this.connection.confirmTransaction(
            { signature: sig, blockhash, lastValidBlockHeight },
            'confirmed'
          );
          if (confirmResult && confirmResult.value && confirmResult.value.err) {
            const onChainErr = JSON.stringify(confirmResult.value.err);
            const isAlreadyInit =
              onChainErr.includes('already in use') ||
              onChainErr.includes('already initialized') ||
              onChainErr.includes('AccountAlreadyInitialized');
            if (isAlreadyInit) {
              console.log(`[Squads] On-chain error indicates account already exists — checking PDA`);
              const landed = await this._checkMultisigLanded(msPda, null);
              if (landed) {
                lastError = null;
                break;
              }
            }
            throw new Error(`Transaction failed on-chain: ${onChainErr}`);
          }
          console.log(`[Squads] Transaction confirmed: ${sig}`);
        } catch (confirmErr) {
          const errMsg = confirmErr.message || '';
          const isExpiry =
            errMsg.includes('block height exceeded') ||
            errMsg.includes('BlockhashNotFound') ||
            errMsg.includes('Transaction was not confirmed') ||
            errMsg.includes('TransactionExpiredBlockheight');

          if (isExpiry) {
            console.log(`[Squads] Confirmation expired, checking if transaction actually landed...`);
            const landed = await this._checkMultisigLanded(msPda, sig);
            if (landed) {
              console.log(`[Squads] Transaction landed despite expiry — treating as success`);
              lastError = null;
              break;
            }
          }
          throw confirmErr;
        } finally {
          clearInterval(resendInterval);
        }

        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        const errMsg = err.message || '';
        const isExpiry =
          errMsg.includes('block height exceeded') ||
          errMsg.includes('BlockhashNotFound') ||
          errMsg.includes('Transaction was not confirmed') ||
          errMsg.includes('TransactionExpiredBlockheight') ||
          errMsg.includes('timeout');

        const isAlreadyInitialized =
          errMsg.includes('already in use') ||
          errMsg.includes('already initialized') ||
          errMsg.includes('AccountAlreadyInitialized');

        if (isAlreadyInitialized || isExpiry) {
          const landed = await this._checkMultisigLanded(msPda, sig);
          if (landed) {
            console.log(`[Squads] Multisig exists on-chain (catch handler), treating as success`);
            lastError = null;
            break;
          }
        }

        if (!isExpiry || attempt === MAX_ATTEMPTS) {
          throw isExpiry
            ? new Error('Network is very congested right now. Please wait a moment and try again.')
            : err;
        }
        console.warn(`[Squads] createMultisig attempt ${attempt} failed (blockhash expired), retrying...`);
      }
    }

    this.multisigPda = msPda;
    const [vault] = multisig.getVaultPda({ multisigPda: msPda, index: 0 });
    this.vaultPda = vault;

    console.log(`[Squads] Multisig created: ${msPda.toBase58()}`);
    console.log(`[Squads] Vault: ${vault.toBase58()}`);
    console.log(`[Squads] CreateKey: ${ck.publicKey.toBase58()}`);
    console.log(`[Squads] Owners: ${owners.length}, Threshold: ${threshold}`);

    return {
      ok: true,
      multisigPda: msPda.toBase58(),
      vaultPda: vault.toBase58(),
      createKey: ck.publicKey.toBase58(),
      signature: sig,
    };
  }

  async createVault(index = 0) {
    if (!this.multisigPda) throw new Error('Multisig not initialized');

    const [vault] = multisig.getVaultPda({
      multisigPda: this.multisigPda,
      index,
    });

    console.log(`[Squads] Vault PDA (index ${index}): ${vault.toBase58()}`);
    return { ok: true, vaultPda: vault.toBase58(), index };
  }

  async createVaultTransaction({ creator, instructions: ixs }) {
    if (!this.multisigPda) throw new Error('Multisig not initialized');

    const msAccount = await multisig.accounts.Multisig.fromAccountAddress(
      this.connection,
      this.multisigPda
    );

    const currentIndex = Number(msAccount.transactionIndex) + 1;
    const transactionIndex = BigInt(currentIndex);

    const creatorPubkey = new PublicKey(creator);

    const ix = multisig.instructions.vaultTransactionCreate({
      multisigPda: this.multisigPda,
      transactionIndex,
      creator: creatorPubkey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: new TransactionMessage({
        payerKey: this.vaultPda,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: ixs,
      }),
    });

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();

    const msg = new TransactionMessage({
      payerKey: creatorPubkey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();

    const serialized = Buffer.from(
      new VersionedTransaction(msg).serialize()
    ).toString('base64');

    console.log(`[Squads] Vault transaction built: index=${currentIndex}`);

    return {
      ok: true,
      transactionIndex: currentIndex,
      transaction: serialized,
      blockhash,
      lastValidBlockHeight,
    };
  }

  async createProposal({ creator, transactionIndex }) {
    if (!this.multisigPda) throw new Error('Multisig not initialized');

    const creatorPubkey = new PublicKey(creator);
    const txIndex = BigInt(transactionIndex);

    const createIx = multisig.instructions.proposalCreate({
      multisigPda: this.multisigPda,
      transactionIndex: txIndex,
      creator: creatorPubkey,
    });

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();

    const msg = new TransactionMessage({
      payerKey: creatorPubkey,
      recentBlockhash: blockhash,
      instructions: [createIx],
    }).compileToV0Message();

    const serialized = Buffer.from(
      new VersionedTransaction(msg).serialize()
    ).toString('base64');

    console.log(`[Squads v4] Proposal created for tx index ${transactionIndex} (auto-activates with timeLock=0)`);

    return {
      ok: true,
      transactionIndex,
      transaction: serialized,
      blockhash,
      lastValidBlockHeight,
    };
  }

  async approveProposal({ member, transactionIndex }) {
    if (!this.multisigPda) throw new Error('Multisig not initialized');

    const memberPubkey = new PublicKey(member);
    const txIndex = BigInt(transactionIndex);

    const ix = multisig.instructions.proposalApprove({
      multisigPda: this.multisigPda,
      transactionIndex: txIndex,
      member: memberPubkey,
    });

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();

    const msg = new TransactionMessage({
      payerKey: memberPubkey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();

    const serialized = Buffer.from(
      new VersionedTransaction(msg).serialize()
    ).toString('base64');

    console.log(
      `[Squads v4] Approval built: member=${memberPubkey
        .toBase58()
        .slice(0, 8)}..., tx=${transactionIndex}`
    );

    return {
      ok: true,
      transactionIndex,
      transaction: serialized,
      blockhash,
      lastValidBlockHeight,
    };
  }

  async executeTransaction({ member, transactionIndex }) {
    if (!this.multisigPda) throw new Error('Multisig not initialized');

    const memberPubkey = new PublicKey(member);
    const txIndex = BigInt(transactionIndex);

    const { instruction: ix, lookupTableAccounts } = await multisig.instructions.vaultTransactionExecute({
      connection: this.connection,
      multisigPda: this.multisigPda,
      transactionIndex: txIndex,
      member: memberPubkey,
    });

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();

    const msg = new TransactionMessage({
      payerKey: memberPubkey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message(lookupTableAccounts);

    const serialized = Buffer.from(
      new VersionedTransaction(msg).serialize()
    ).toString('base64');

    console.log(`[Squads v4] Execute built: tx=${transactionIndex}`);

    return {
      ok: true,
      transactionIndex,
      transaction: serialized,
      blockhash,
      lastValidBlockHeight,
    };
  }

  async buildTransferProposal({ creator, mint, destination, amount, decimals = 5 }) {
    if (!this.multisigPda || !this.vaultPda) throw new Error('Multisig not initialized');

    const mintPk = new PublicKey(mint);
    const destPk = new PublicKey(destination);
    const creatorPk = new PublicKey(creator);

    const tokenProgram = TOKEN_2022_PROGRAM_ID;
    const vaultAta = getAssociatedTokenAddressSync(mintPk, this.vaultPda, true, tokenProgram);
    const destAta = getAssociatedTokenAddressSync(mintPk, destPk, false, tokenProgram);

    const destAtaInfo = await this.connection.getAccountInfo(destAta);
    const ixs = [];

    if (!destAtaInfo) {
      ixs.push(
        createAssociatedTokenAccountInstruction(
          this.vaultPda,
          destAta,
          destPk,
          mintPk,
          tokenProgram
        )
      );
    }

    const rawAmount = BigInt(Math.round(Number(amount) * (10 ** decimals)));
    ixs.push(
      createTransferCheckedInstruction(
        vaultAta,
        mintPk,
        destAta,
        this.vaultPda,
        rawAmount,
        decimals,
        [],
        tokenProgram
      )
    );

    const vtResult = await this.createVaultTransaction({ creator, instructions: ixs });
    const propResult = await this.createProposal({ creator, transactionIndex: vtResult.transactionIndex });

    console.log(`[Squads v4] Transfer proposal built: ${amount} (${decimals}d) of ${mint.slice(0,8)}... → ${destination.slice(0,8)}..., txIndex=${vtResult.transactionIndex}`);

    return {
      ok: true,
      transactionIndex: vtResult.transactionIndex,
      vaultTransaction: vtResult.transaction,
      proposalTransaction: propResult.transaction,
      blockhash: propResult.blockhash,
      lastValidBlockHeight: propResult.lastValidBlockHeight,
    };
  }

  async getProposalState(transactionIndex) {
    if (!this.multisigPda) throw new Error('Multisig not initialized');

    const txIndex = BigInt(transactionIndex);
    const [proposalPda] = multisig.getProposalPda({
      multisigPda: this.multisigPda,
      transactionIndex: txIndex,
    });

    try {
      const proposal = await multisig.accounts.Proposal.fromAccountAddress(
        this.connection,
        proposalPda
      );

      const approved = proposal.approved || [];
      const rejected = proposal.rejected || [];

      return {
        ok: true,
        status: proposal.status?.__kind || 'Unknown',
        approvedMembers: approved.map(k => k.toBase58()),
        rejectedMembers: rejected.map(k => k.toBase58()),
        approvalCount: approved.length,
        rejectionCount: rejected.length,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async getMultisigState() {
    if (!this.multisigPda) {
      return { initialized: false, error: 'Multisig PDA not set' };
    }

    try {
      const msAccount = await multisig.accounts.Multisig.fromAccountAddress(
        this.connection,
        this.multisigPda
      );

      return {
        initialized: true,
        threshold: msAccount.threshold,
        transactionIndex: Number(msAccount.transactionIndex),
        members: msAccount.members.map((m) => ({
          key: m.key.toBase58(),
          permissions: m.permissions,
        })),
        timeLock: msAccount.timeLock,
        vaultPda: this.vaultPda?.toBase58() || null,
      };
    } catch (e) {
      return { initialized: false, error: e.message };
    }
  }

  async getVaultBalances(mints = []) {
    if (!this.vaultPda) {
      return { ok: false, error: 'Vault not initialized' };
    }

    const solBalance = await this.connection.getBalance(this.vaultPda);
    const balances = [
      {
        mint: 'SOL',
        balance: solBalance / LAMPORTS_PER_SOL,
        raw: solBalance,
      },
    ];

    for (const mintStr of mints) {
      try {
        const mint = new PublicKey(mintStr);
        let ata, info;
        const ata2022 = getAssociatedTokenAddressSync(mint, this.vaultPda, true, TOKEN_2022_PROGRAM_ID);
        try {
          info = await this.connection.getTokenAccountBalance(ata2022);
          ata = ata2022;
        } catch {
          const ataSpl = getAssociatedTokenAddressSync(mint, this.vaultPda, true, TOKEN_PROGRAM_ID);
          info = await this.connection.getTokenAccountBalance(ataSpl);
          ata = ataSpl;
        }
        balances.push({
          mint: mintStr,
          ata: ata.toBase58(),
          balance: info.value.uiAmount || 0,
          raw: info.value.amount,
          decimals: info.value.decimals,
        });
      } catch {
        balances.push({
          mint: mintStr,
          balance: 0,
          raw: '0',
        });
      }
    }

    return { ok: true, vault: this.vaultPda.toBase58(), balances };
  }

  async ensureVaultAtas({ mints, payer }) {
    if (!this.vaultPda) throw new Error('Vault not initialized');

    const payerPubkey = new PublicKey(payer);
    const created = [];
    const existing = [];
    const ixs = [];

    for (const mintStr of mints) {
      const mint = new PublicKey(mintStr);
      const ata = getAssociatedTokenAddressSync(mint, this.vaultPda, true);
      const acctInfo = await this.connection.getAccountInfo(ata);
      if (acctInfo) {
        existing.push({ mint: mintStr, ata: ata.toBase58() });
      } else {
        ixs.push(
          createAssociatedTokenAccountInstruction(
            payerPubkey,
            ata,
            this.vaultPda,
            mint
          )
        );
        created.push({ mint: mintStr, ata: ata.toBase58() });
      }
    }

    if (ixs.length === 0) {
      return { ok: true, created: [], existing, message: 'All ATAs exist' };
    }

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();

    const msg = new TransactionMessage({
      payerKey: payerPubkey,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const serialized = Buffer.from(
      new VersionedTransaction(msg).serialize()
    ).toString('base64');

    console.log(`[Squads] Built ATA creation for ${created.length} mints`);

    return {
      ok: true,
      created,
      existing,
      transaction: serialized,
      blockhash,
      lastValidBlockHeight,
    };
  }
}

module.exports = { SquadsService };
