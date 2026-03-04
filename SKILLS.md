# SKILLS.md — Agentic Wallet System

> This file is intended to be read by AI agents to understand how to interact with this wallet system.

## Overview

This system provides autonomous wallet management for AI agents on Solana (devnet). Each agent gets an isolated, encrypted keypair and can sign transactions, hold SOL/SPL tokens, and interact with DeFi protocols without human intervention.

---

## Capabilities

### Wallet Operations
- `getWalletInfo()` → Returns `{ agentId, publicKey, solBalance, tokenBalances }`
- `getSOLBalance()` → Returns current SOL balance as a number
- `requestAirdrop(amount?)` → Requests SOL from devnet faucet (default: 1 SOL)
- `sendSOL(toAddress, amount)` → Transfers SOL to another address

### DeFi Operations (via Jupiter)
- `swapSOLtoUSDC(keypair, solAmount)` → Swaps SOL → USDC on Jupiter
- `swapUSDCtoSOL(keypair, usdcAmount)` → Swaps USDC → SOL on Jupiter
- `getQuote(inputMint, outputMint, amount)` → Gets a price quote before swapping

---

## Decision Protocol

When making a decision, an agent should provide a JSON object:

```json
{
  "action": "swap_sol_to_usdc | swap_usdc_to_sol | hold | request_airdrop | send_sol",
  "amount": 0.1,
  "toAddress": "optional, only for send_sol",
  "reasoning": "brief explanation"
}
```

### Action Rules
| Action | Condition |
|--------|-----------|
| `request_airdrop` | Only when SOL balance < 0.5 |
| `swap_sol_to_usdc` | Never swap more than 80% of SOL balance |
| `swap_usdc_to_sol` | Provide amount in USDC (6 decimal token) |
| `hold` | Default safe action when uncertain |
| `send_sol` | Requires `toAddress` field |

### Safety Constraints
- Always maintain at least **0.05 SOL** for transaction fees
- Never expose or log the raw private key
- Prefer `hold` over risky actions when portfolio state is unclear

---

## Key Management

- Keypairs are stored encrypted at rest using **AES-256-GCM**
- Encryption key is derived from `WALLET_ENCRYPTION_SECRET` env var
- Each agent has a unique keypair file in `.wallets/<agentId>.enc`
- Private keys are never exposed outside the `WalletManager` class

---

## Token Addresses (Devnet)

| Token | Mint Address |
|-------|-------------|
| SOL (wrapped) | `So11111111111111111111111111111111111111112` |
| USDC | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ | Claude API key for agent decisions |
| `WALLET_ENCRYPTION_SECRET` | ✅ | Secret for encrypting wallet keypairs |
| `SOLANA_RPC_URL` | ❌ | Defaults to `https://api.devnet.solana.com` |
| `NUM_AGENTS` | ❌ | Number of agents to spawn (default: 3) |
| `AGENT_DECISION_INTERVAL_MS` | ❌ | Decision loop interval in ms (default: 30000) |

---

## Error Handling

If an action fails, the agent should:
1. Log the error in `reasoning`
2. Default to `hold` on the next cycle
3. If balance is critically low, prioritize `request_airdrop`

---

## Inter-Agent Communication

Agents do NOT communicate with each other by default. Each agent:
- Has its own isolated wallet
- Makes decisions independently
- Runs concurrently via `Promise.allSettled`

To enable agent coordination, extend `AgentManager` to share state between agents.
