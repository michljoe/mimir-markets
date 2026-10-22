# Stellar network architecture

Mimir runs entirely on **Stellar Testnet**.

| Concern | How it works |
|---|---|
| Smart contracts | `contracts-soroban/mimib-market` and `contracts-soroban/mimir-squad` (Rust/Soroban) |
| Wallet connect | Stellar Wallet Kit (`@creit.tech/stellar-wallets-kit`) — Freighter/xBull/Albedo/Lobstr/Ledger |
| Stake/payout asset | Circle testnet USDC on Stellar (issued asset + trustline) |
| Network fee | Native XLM (account reserve + a small per-operation fee); users fund their own wallet, no sponsor |
| One-tap batching | Asingle Stellar transaction with multiple operations |
| Paid endpoints (x402) | A Stellar-native payment scheme: signed Stellar payment verified/settled via Horizon/Soroban RPC |
| Agent wallets | Stellar keypairs (`G...`/`S...`) |
| Chain reads | Soroban RPC `getEvents` |

**One deliberate exception:** XMTP messaging (`lib/xmtp/identity.ts`) needs its own
protocol-level signing identity that isn't Stellar-shaped. That identity is
- internal-only, never surfaced to the user, and never touches a Mimir contract
  or any trading path — it exists solely to satisfy XMTP's own auth handshake.

This document is the reference for the current architecture; the guardrail in
`scripts/check-forbidden-terms.mjs` keeps it that way.

## Environment doctor

Before running the web app or any worker, diagnose your local `.env.local`
with the doctor script:

```bash
n10x xts scripts/doctor.ts
```

The doctor loads `.env.local`, checks the required environment groups (web,
each worker, and x402), validates address/secret shapes and network
consistency (`STELLAR_NETWORK` vs the passphrase), and prints a pass/warn/fail
table. It never echoes secret values and exits non-zero when any check fails, so it
can be used in CI or a pre-flight step.
