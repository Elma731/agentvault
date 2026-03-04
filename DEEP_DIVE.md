# Deep Dive — Agentic Wallet System

## What Problem Does This Solve?

As AI agents become autonomous participants in blockchain ecosystems, they need more than just access to a wallet — they need to *own* one. Traditional wallets are designed for humans: they require manual approval for every transaction, store keys in browser extensions, and assume someone is watching.

Agentic wallets flip this model. The wallet is designed to be operated by code, not people. The agent is the user.

---

## Wallet Design

### Key Generation & Storage

Every agent gets a unique ed25519 keypair generated via `@solana/web3.js`. The keypair is immediately serialized and encrypted using **AES-256-GCM** before being written to disk.

```
Raw Keypair → serialize to Uint8Array
           → encrypt with AES-256-GCM (random IV per write)
           → store as hex string: <iv>:<authTag>:<ciphertext>
```

Key derivation uses `crypto.scryptSync` with a salt to derive a 256-bit key from the user-supplied `WALLET_ENCRYPTION_SECRET`. This means even if the `.wallets/` directory is leaked, the keypairs are useless without the secret.

### Why AES-256-GCM?

GCM (Galois/Counter Mode) provides both **confidentiality and integrity**. If an attacker tampers with the encrypted keypair file, decryption will fail with an auth tag mismatch — protecting against malicious key substitution attacks.

### Separation of Concerns

The raw `Keypair` object lives exclusively inside `WalletManager`. The agent layer never receives the private key — it calls `wallet.sendSOL()` or passes the keypair to the `JupiterProtocol` only for transaction signing. This minimizes the attack surface.

---

## How Claude Is Integrated

The agent brain is a prompt engineering pattern:

1. **State injection** — current portfolio, recent history, available actions, and behavioral rules are all injected into the system prompt
2. **Constrained output** — Claude is instructed to return only valid JSON matching a known schema
3. **Personality differentiation** — each agent has a slightly different trading personality (conservative, aggressive, balanced) to create diverse behavior across the agent fleet
4. **Memory via history** — the last 3 decisions are passed back into the prompt, so Claude can reason about what it just did

This means the agent isn't just executing scripts — it's *reasoning*. It can weigh tradeoffs, adapt to its balance, and explain its logic.

### Fallback Safety

If the Claude API fails or returns malformed JSON, the agent defaults to `hold`. This ensures a network outage or API error never causes an agent to take unsafe action.

---

## Jupiter Integration

Jupiter is Solana's leading DEX aggregator. The swap flow:

1. `GET /v6/quote` — get best route and expected output for the swap
2. `POST /v6/swap` — get a pre-built `VersionedTransaction`
3. Sign the transaction with the agent's keypair
4. `sendRawTransaction` → `confirmTransaction`

Using `wrapAndUnwrapSol: true` handles the SOL ↔ wSOL conversion automatically, so the agent works with native SOL.

---

## Multi-Agent Architecture

The `AgentManager` spawns N agents and runs them concurrently via `Promise.allSettled`. Each agent:

- Has its own encrypted keypair file
- Makes independent decisions via its own Claude API call
- Runs on the same decision interval but is not blocked by other agents

`Promise.allSettled` (vs `Promise.all`) ensures one agent failing doesn't crash the others.

### Scalability Path

To scale to hundreds of agents:
- Move keypair storage to a database (encrypted fields)
- Use a job queue (e.g. BullMQ) instead of setInterval
- Rate-limit Claude API calls with a token bucket
- Share a single RPC connection pool across agents

---

## Security Considerations

| Risk | Mitigation |
|------|-----------|
| Private key leak | Keys only exist in memory; never logged or returned via API |
| Encrypted file tampering | AES-GCM auth tag detects modifications |
| Agent draining its own wallet | Min 0.05 SOL buffer enforced at decision prompt level |
| Runaway swapping | Claude instructed never to swap >80% of balance in one action |
| API key exposure | All secrets via environment variables, never hardcoded |

### What This Prototype Does NOT Cover (Production Considerations)

- **HSM / KMS** — production systems should use a Hardware Security Module or cloud KMS (e.g. AWS KMS, Google Cloud KMS) instead of file-based encrypted keys
- **Multi-sig** — high-value agents should require multiple signers for large transactions
- **Rate limiting** — no protection against an agent spamming transactions in a loop
- **Audit logging** — decision logs are in-memory only; production needs durable logging

---

## Conclusion

This system demonstrates that an AI agent can autonomously:
- Own and manage a Solana wallet
- Reason about its portfolio using an LLM
- Execute real on-chain DeFi operations
- Do all of this securely, without human intervention

The clean separation between agent brain, wallet layer, and protocol layer makes the system modular — the Claude brain can be swapped for any LLM, and the Jupiter protocol layer can be extended to support any Solana dApp.

---

## Solana RPC — Key Design Decisions

The system uses the Solana JSON RPC API throughout. A few important choices made based on the official docs:

**Commitment Levels**

Solana nodes select bank state based on a `commitment` parameter. The system uses two levels:
- `"confirmed"` for balance reads and transaction sending — voted on by supermajority, fast enough for agent decisions
- `"finalized"` for airdrop confirmations — max lockout, cluster has recognized the block as final

Using `"processed"` (received by node only) is deliberately avoided for fund operations since it can be rolled back.

**Transaction Confirmation Pattern**

Per Solana RPC docs, `sendTransaction` succeeds immediately without waiting for confirmation. The system uses `getLatestBlockhash` + `confirmTransaction` with a blockhash expiry window for reliable confirmation, rather than the deprecated polling approach.

**getSignatureStatuses Monitoring**

After `sendRawTransaction` (used in Jupiter swaps), transaction status can be monitored using `getSignatureStatuses`. This is important because Jupiter swap transactions are sent with `skipPreflight: true` for speed, so confirmation must be verified explicitly.

---

## Kora Fee Abstraction (Extension Path)

The bounty references Kora, the Solana Foundation's fee relayer and gas abstraction layer. In the current prototype, each agent holds SOL to pay its own transaction fees. A production extension could integrate Kora to enable truly gasless agent operations:

**How Kora works**: Kora acts as a fee payer that validates transactions against security rules before co-signing. The agent constructs a transaction, Kora validates it against an allowlist of programs/tokens and spending limits, then co-signs and broadcasts it. The agent never needs to hold SOL for fees — it can pay in USDC or other SPL tokens instead.

**Relevant Kora configuration for agentic wallets** (via `kora.toml`):
- `token allowlists` — which SPL tokens agents can use to pay fees
- `program allowlists` — which Solana programs agents are permitted to call (e.g. Jupiter, SPL Token)
- `transaction limits` — max fees the relayer covers per transaction
- `per-wallet usage limits` — prevents any single agent from draining the fee pool

**Why this matters**: An agent that doesn't need to maintain a SOL balance for fees is significantly easier to bootstrap and scale. New agents can start operating with only USDC, removing the bootstrapping problem (need SOL to swap, need to swap to operate).

**Integration path**: Replace the current airdrop-based SOL funding with a Kora node that co-signs agent transactions. The agent layer stays identical — only the `JupiterProtocol` and `WalletManager` signing flow needs updating to route through the Kora RPC endpoint before broadcasting.
