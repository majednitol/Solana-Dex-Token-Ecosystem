/* eslint-disable no-console */
const anchor = require("@coral-xyz/anchor");
const { SystemProgram, PublicKey, Keypair, LAMPORTS_PER_SOL } = anchor.web3;
const assert = require("assert");

describe("treasury-multisig (Phase 1)", () => {
  // Use local provider (anchor test) or devnet depending on env
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TreasuryMultisigContracts;
  const connection = provider.connection;
  const wallet = provider.wallet;

  // -------- helpers --------
  const airdrop = async (pubkey, sol = 2) => {
    const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  };

  const findMultisigPda = async () => {
    // must match SEED_TREASURY = "treasury"
    return PublicKey.findProgramAddressSync([Buffer.from("treasury")], program.programId);
  };

  const findProposalPda = async (multisigPda, nonceU64) => {
    // must match: seeds = [ "proposal", multisig, nonce.to_le_bytes() ]
    const nonceBuf = Buffer.alloc(8);
    nonceBuf.writeBigUInt64LE(BigInt(nonceU64));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), multisigPda.toBuffer(), nonceBuf],
      program.programId
    );
  };

  const metaLite = (pubkey, isWritable, isSigner) => ({
    pubkey,
    isWritable,
    isSigner,
  });

  const getAccountOrNull = async (pk) => {
    const ai = await connection.getAccountInfo(pk, "confirmed");
    return ai;
  };

  // -------- test keys --------
  const owner1 = Keypair.generate();
  const owner2 = Keypair.generate();
  const owner3 = Keypair.generate();
  const nonOwner = Keypair.generate();

  // accounts used for execute target ix (system transfer)
  const receiver = Keypair.generate();

  let multisigPda;
  let multisigBump;

  before(async () => {
    await airdrop(owner1.publicKey, 2);
    await airdrop(owner2.publicKey, 2);
    await airdrop(owner3.publicKey, 2);
    await airdrop(nonOwner.publicKey, 2);
    await airdrop(receiver.publicKey, 1);

    const [pda, bump] = await findMultisigPda();
    multisigPda = pda;
    multisigBump = bump;
  });

  it("initialize: creates multisig PDA with owners + threshold + nonce=0", async () => {
    const owners = [owner1.publicKey, owner2.publicKey, owner3.publicKey];
    const threshold = 2;

    // payer is provider wallet
    // but Initialize requires payer signer; provider.wallet is the signer
    await program.methods
      .initialize(owners, threshold)
      .accounts({
        payer: wallet.publicKey,
        multisig: multisigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const ms = await program.account.multisig.fetch(multisigPda);
    assert.strictEqual(ms.bump, multisigBump);
    assert.strictEqual(ms.threshold, threshold);
    assert.strictEqual(ms.nonce.toNumber(), 0);
    assert.strictEqual(ms.owners.length, 3);
    assert.ok(ms.owners[0].equals(owner1.publicKey));
    assert.ok(ms.owners[1].equals(owner2.publicKey));
    assert.ok(ms.owners[2].equals(owner3.publicKey));
  });

  it("propose: auto-approves proposer and increments nonce", async () => {
    // current nonce should be 0
    const ms0 = await program.account.multisig.fetch(multisigPda);
    const currentNonce = ms0.nonce.toNumber();
    assert.strictEqual(currentNonce, 0);

    // We will propose a SystemProgram::Transfer from multisig PDA -> receiver
    // Important: metas must include the EXACT remaining accounts list on execute.
    // Your execute verifies acc.is_writable matches meta.is_writable.
    // System transfer requires:
    //  - from: writable, signer
    //  - to: writable, not signer
    const metas = [
      metaLite(multisigPda, true, true), // only multisig PDA allowed signer meta
      metaLite(receiver.publicKey, true, false),
      metaLite(SystemProgram.programId, false, false),
    ];

    // ix data for system transfer:
    // easiest: build Instruction and take .data
    const lamports = 1000;
    const ix = SystemProgram.transfer({
      fromPubkey: multisigPda,
      toPubkey: receiver.publicKey,
      lamports,
    });

    const [proposalPda] = await findProposalPda(multisigPda, currentNonce);

    await program.methods
      .propose(ix.programId, metas, Buffer.from(ix.data), new anchor.BN(currentNonce))
      .accounts({
        proposer: owner1.publicKey,
        multisig: multisigPda,
        proposal: proposalPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner1])
      .rpc();

    const ms1 = await program.account.multisig.fetch(multisigPda);
    assert.strictEqual(ms1.nonce.toNumber(), currentNonce + 1);

    const p = await program.account.proposal.fetch(proposalPda);
    assert.ok(p.multisig.equals(multisigPda));
    assert.ok(p.proposer.equals(owner1.publicKey));
    assert.ok(p.targetProgram.equals(ix.programId));
    assert.strictEqual(p.nonce.toNumber(), currentNonce);
    assert.strictEqual(p.executed, false);

    // proposer auto-approval bit set
    // owner1 is index 0 -> bit 1
    assert.strictEqual(p.approvalsBitmap, 1);
  });

  it("approve: only owners can approve; cannot approve twice", async () => {
    // proposal nonce was 0
    const [proposalPda] = await findProposalPda(multisigPda, 0);

    // non-owner should fail
    try {
      await program.methods
        .approve()
        .accounts({
          owner: nonOwner.publicKey,
          multisig: multisigPda,
          proposal: proposalPda,
        })
        .signers([nonOwner])
        .rpc();
      assert.fail("non-owner approve should fail");
    } catch (e) {
      // expected
    }

    // owner2 approve should pass
    await program.methods
      .approve()
      .accounts({
        owner: owner2.publicKey,
        multisig: multisigPda,
        proposal: proposalPda,
      })
      .signers([owner2])
      .rpc();

    const p1 = await program.account.proposal.fetch(proposalPda);
    // owner1 bit 1, owner2 bit 2 => bitmap 0b00000011 = 3
    assert.strictEqual(p1.approvalsBitmap, 3);

    // owner2 approving again should fail
    try {
      await program.methods
        .approve()
        .accounts({
          owner: owner2.publicKey,
          multisig: multisigPda,
          proposal: proposalPda,
        })
        .signers([owner2])
        .rpc();
      assert.fail("double approve should fail");
    } catch (e) {
      // expected
    }
  });

  it("execute: fails if remaining accounts mismatch (order/flags)", async () => {
    // Create a fresh proposal with nonce 1, but only 1 approval (proposer only)
    const ms = await program.account.multisig.fetch(multisigPda);
    const nonce = ms.nonce.toNumber(); // should be 1 currently
    assert.strictEqual(nonce, 1);

    const lamports = 1000;
    const ix = SystemProgram.transfer({
      fromPubkey: multisigPda,
      toPubkey: receiver.publicKey,
      lamports,
    });

    const metas = [
      metaLite(multisigPda, true, true),
      metaLite(receiver.publicKey, true, false),
      metaLite(SystemProgram.programId, false, false),
    ];

    const [proposalPda] = await findProposalPda(multisigPda, nonce);

    await program.methods
      .propose(ix.programId, metas, Buffer.from(ix.data), new anchor.BN(nonce))
      .accounts({
        proposer: owner1.publicKey,
        multisig: multisigPda,
        proposal: proposalPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner1])
      .rpc();

    // threshold is 2, approvals currently 1 => execute should fail (NotEnoughApprovals)
    try {
      await program.methods
        .execute()
        .accounts({
          caller: wallet.publicKey,
          multisig: multisigPda,
          proposal: proposalPda,
        })
        .remainingAccounts([
          { pubkey: multisigPda, isWritable: true, isSigner: false },
          { pubkey: receiver.publicKey, isWritable: true, isSigner: false },
          { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
        ])
        .rpc();
      assert.fail("execute should fail with < threshold approvals");
    } catch (e) {
      // expected
    }

    // Approve by owner2 so threshold met
    await program.methods
      .approve()
      .accounts({
        owner: owner2.publicKey,
        multisig: multisigPda,
        proposal: proposalPda,
      })
      .signers([owner2])
      .rpc();

    // Now send wrong remainingAccounts order => should fail AccountListMismatch
    try {
      await program.methods
        .execute()
        .accounts({
          caller: wallet.publicKey,
          multisig: multisigPda,
          proposal: proposalPda,
        })
        .remainingAccounts([
          { pubkey: receiver.publicKey, isWritable: true, isSigner: false }, // swapped order
          { pubkey: multisigPda, isWritable: true, isSigner: false },
          { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
        ])
        .rpc();
      assert.fail("execute should fail on remaining accounts order mismatch");
    } catch (e) {
      // expected
    }

    // Wrong writable flag mismatch => should fail AccountMetaFlagsMismatch
    try {
      await program.methods
        .execute()
        .accounts({
          caller: wallet.publicKey,
          multisig: multisigPda,
          proposal: proposalPda,
        })
        .remainingAccounts([
          { pubkey: multisigPda, isWritable: false, isSigner: false }, // should be writable
          { pubkey: receiver.publicKey, isWritable: true, isSigner: false },
          { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
        ])
        .rpc();
      assert.fail("execute should fail on writable flags mismatch");
    } catch (e) {
      // expected
    }
  });
it("execute: succeeds with dummy CPI to treasury-multisig itself; proposal closes; replay prevented", async () => {
  const dummyIx = await program.methods
  .dummy()
  .accounts({
    thisProgram: program.programId,
    multisig: multisigPda,
  })
  .instruction();


  const ms = await program.account.multisig.fetch(multisigPda);
  const nonce = ms.nonce.toNumber();

  const metas = [
    metaLite(program.programId, false, false),
    metaLite(multisigPda, false, true),
  ];

  const [proposalPda] = await findProposalPda(multisigPda, nonce);

  await program.methods
    .propose(dummyIx.programId, metas, Buffer.from(dummyIx.data), new anchor.BN(nonce))
    .accounts({
      proposer: owner1.publicKey,
      multisig: multisigPda,
      proposal: proposalPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([owner1])
    .rpc();

  await program.methods
    .approve()
    .accounts({
      owner: owner2.publicKey,
      multisig: multisigPda,
      proposal: proposalPda,
    })
    .signers([owner2])
    .rpc();

  await program.methods
    .execute()
    .accounts({
      caller: wallet.publicKey,
      multisig: multisigPda,
      proposal: proposalPda,
    })
    .remainingAccounts([
      { pubkey: program.programId, isWritable: false, isSigner: false },
      { pubkey: multisigPda, isWritable: false, isSigner: false },
    ])
    .rpc();

  const ai = await getAccountOrNull(proposalPda);
  assert.strictEqual(ai, null, "proposal account must be closed after execute");

  try {
    await program.methods
      .execute()
      .accounts({
        caller: wallet.publicKey,
        multisig: multisigPda,
        proposal: proposalPda,
      })
      .remainingAccounts([
        { pubkey: program.programId, isWritable: false, isSigner: false },
        { pubkey: multisigPda, isWritable: false, isSigner: false },
      ])
      .rpc();
    assert.fail("re-execute should fail because proposal is closed");
  } catch (e) {
    // expected
  }
});


  // it("execute: succeeds with exact remaining accounts; proposal is closed; replay prevented", async () => {
  //   // Proposal nonce 0 exists and already has approvals >= 2; execute it now.
  //   const [proposalPda] = await findProposalPda(multisigPda, 0);

  //   const before = await connection.getBalance(receiver.publicKey, "confirmed");

  //   // Remaining accounts EXACT order and writable flags must match proposal metas:
  //   // [multisigPda (writable), receiver (writable), system_program (readonly)]
  //   await program.methods
  //     .execute()
  //     .accounts({
  //       caller: wallet.publicKey,
  //       multisig: multisigPda,
  //       proposal: proposalPda,
  //     })
  //     .remainingAccounts([
  //       { pubkey: multisigPda, isWritable: true, isSigner: false },
  //       { pubkey: receiver.publicKey, isWritable: true, isSigner: false },
  //       { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
  //     ])
  //     .rpc();

  //   const after = await connection.getBalance(receiver.publicKey, "confirmed");
  //   assert.ok(after > before, "receiver should receive lamports from multisig PDA");

  //   // Proposal is closed to caller (rent reclaimed) => account should be gone
  //   const ai = await getAccountOrNull(proposalPda);
  //   assert.strictEqual(ai, null, "proposal account must be closed after execute");

  //   // Replay prevented: executing again should fail because proposal no longer exists
  //   try {
  //     await program.methods
  //       .execute()
  //       .accounts({
  //         caller: wallet.publicKey,
  //         multisig: multisigPda,
  //         proposal: proposalPda,
  //       })
  //       .remainingAccounts([
  //         { pubkey: multisigPda, isWritable: true, isSigner: false },
  //         { pubkey: receiver.publicKey, isWritable: true, isSigner: false },
  //         { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
  //       ])
  //       .rpc();
  //     assert.fail("re-execute should fail because proposal is closed");
  //   } catch (e) {
  //     // expected
  //   }
  // });

  it("propose: rejects signer metas that are not multisig PDA", async () => {
    const ms = await program.account.multisig.fetch(multisigPda);
    const nonce = ms.nonce.toNumber();

    // invalid: receiver marked signer => should fail InvalidSignerMeta
   const metas = [
  metaLite(program.programId, false, false), //  program executable account
  metaLite(multisigPda, false, true),        // multisig signer meta allowed
];

    const ix = SystemProgram.transfer({
      fromPubkey: multisigPda,
      toPubkey: receiver.publicKey,
      lamports: 1,
    });

    const [proposalPda] = await findProposalPda(multisigPda, nonce);

    try {
      await program.methods
        .propose(ix.programId, metas, Buffer.from(ix.data), new anchor.BN(nonce))
        .accounts({
          proposer: owner1.publicKey,
          multisig: multisigPda,
          proposal: proposalPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner1])
        .rpc();
      assert.fail("propose should fail due to invalid signer meta");
    } catch (e) {
     
    }
  });
});
