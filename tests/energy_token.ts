import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { EnergyToken } from "../target/types/energy_token";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { assert } from "chai";

describe("energy_token", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.EnergyToken as Program<EnergyToken>;
  const authority = provider.wallet as anchor.Wallet;
  const producer = Keypair.generate();
  const buyer = Keypair.generate();
  const mintKeypair = Keypair.generate();

  let marketplacePda: PublicKey;
  let marketplaceBump: number;

  before(async () => {
    // Airdrop to producer and buyer
    for (const kp of [producer, buyer]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    [marketplacePda, marketplaceBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace"), authority.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Initialize marketplace", async () => {
    const tokenPricelamports = new anchor.BN(10_000_000); // 0.01 SOL per kWh

    await program.methods
      .initializeMarketplace(tokenPricelamports)
      .accounts({
        marketplace: marketplacePda,
        mint: mintKeypair.publicKey,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    const marketplace = await program.account.marketplace.fetch(marketplacePda);
    assert.equal(marketplace.tokenPriceLamports.toNumber(), 10_000_000);
    assert.equal(marketplace.totalMinted.toNumber(), 0);
    console.log("✅ Marketplace initialized");
  });

  it("Mint energy tokens as producer", async () => {
    const amount = new anchor.BN(100);

    const [producerRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("producer"), producer.publicKey.toBuffer()],
      program.programId
    );

    const producerAta = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      producer.publicKey
    );

    await program.methods
      .mintEnergyTokens(amount)
      .accounts({
        marketplace: marketplacePda,
        mint: mintKeypair.publicKey,
        producerTokenAccount: producerAta,
        producerRegistry: producerRegistryPda,
        producer: producer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([producer])
      .rpc();

    const marketplace = await program.account.marketplace.fetch(marketplacePda);
    assert.equal(marketplace.totalMinted.toNumber(), 100);

    const registry = await program.account.producerRegistry.fetch(producerRegistryPda);
    assert.equal(registry.totalMinted.toNumber(), 100);
    console.log("✅ Minted 100 kWh tokens to producer");
  });

  it("Transfer tokens between users", async () => {
    const amount = new anchor.BN(10);

    const producerAta = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      producer.publicKey
    );
    const buyerAta = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      buyer.publicKey
    );

    await program.methods
      .transferTokens(amount)
      .accounts({
        fromTokenAccount: producerAta,
        toTokenAccount: buyerAta,
        mint: mintKeypair.publicKey,
        to: buyer.publicKey,
        from: producer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([producer])
      .rpc();

    console.log("✅ Transferred 10 kWh from producer to buyer");
  });
});
