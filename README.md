# ⚡ EnergyToken

A decentralized marketplace for trading electricity as Solana tokens.

**1 token = 1 kWh.** Producers mint tokens, users buy and trade them on-chain.

---

## Stack

- Solana Devnet + Anchor
- React + Vite
- Phantom Wallet

## What it does

- Producers connect their wallet and mint kWh tokens
- Buyers purchase tokens with SOL at a fixed rate (0.01 SOL / kWh)
- Anyone can send tokens peer-to-peer
- Sell listings are escrowed on-chain

## Run locally

```bash
# Deploy contract
anchor build && anchor deploy --provider.cluster devnet

# Frontend
cd frontend && npm install && npm run dev
```

After deploying, paste your `PROGRAM_ID` and `MINT_ADDRESS` into `frontend/src/App.jsx`.

## Tokenomics

| | |
|---|---|
| 1 token | 1 kWh |
| Price | 0.01 SOL |
| Network | Solana Devnet |
