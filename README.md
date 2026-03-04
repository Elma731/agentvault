# 🤖 Agentic Wallet System — AI-Powered DeFi Agents on Solana

A prototype agentic wallet system where AI agents autonomously manage their own Solana wallets — signing transactions, holding funds, and executing DeFi operations on devnet without human intervention.

Each agent is powered by **Claude (Anthropic)** for decision-making and interacts with **Jupiter** for on-chain swaps.

---

## ✨ Features

- **Autonomous wallet creation** — each agent generates and owns its own keypair
- **AES-256-GCM encrypted key storage** — private keys never leave the system unencrypted
- **Claude-powered decisions** — agents reason about their portfolio and decide what to do
- **Jupiter swap integration** — real SOL ↔ USDC swaps on Solana devnet
- **Multi-agent support** — spin up N agents running independently in parallel
- **Live CLI dashboard** — observe every agent's decisions and actions in real time
- **Persistent wallets** — agent keypairs survive restarts

---

## 🏗 Architecture

```
┌─────────────────────────────────────┐
│            Agent Layer              │
│  AIAgent → Claude API → Decision    │
├─────────────────────────────────────┤
│            Wallet Layer             │
│  WalletManager → Keypair + Signing  │
├─────────────────────────────────────┤
│           Protocol Layer            │
│  JupiterProtocol → Solana RPC       │
└─────────────────────────────────────┘
```

**Agent Layer** — Claude reasons about portfolio state and returns a structured JSON decision  
**Wallet Layer** — Handles encrypted key storage, transaction building, and signing  
**Protocol Layer** — Talks to Solana devnet and Jupiter swap API

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/agentic-wallet
cd agentic-wallet
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
ANTHROPIC_API_KEY=your_anthropic_api_key
WALLET_ENCRYPTION_SECRET=a_strong_random_secret
SOLANA_RPC_URL=https://api.devnet.solana.com
NUM_AGENTS=3
AGENT_DECISION_INTERVAL_MS=30000
```

### 3. Run

```bash
npm run dev
```

You'll see the agents boot up, print their wallet addresses, and start making decisions every 30 seconds.

---

## 📁 Project Structure

```
agentic-wallet/
├── src/
│   ├── agent/
│   │   ├── AIAgent.ts          # Claude-powered agent brain
│   │   └── AgentManager.ts     # Multi-agent orchestrator
│   ├── wallet/
│   │   └── WalletManager.ts    # Key mgmt, signing, SOL ops
│   ├── protocols/
│   │   └── JupiterProtocol.ts  # Jupiter swap integration
│   └── index.ts                # Entry point
├── .wallets/                   # Encrypted keypair storage (gitignored)
├── SKILLS.md                   # Agent-readable capability docs
├── .env.example
└── README.md
```

---

## 🔐 Security Design

| Concern | Solution |
|---------|----------|
| Key storage | AES-256-GCM encryption at rest |
| Key exposure | Private keys never leave `WalletManager` |
| Transaction safety | Min 0.05 SOL buffer always maintained |
| Agent isolation | Each agent has its own encrypted keypair file |
| Input validation | Amount and address checks before every tx |

**The private key is only ever held in memory inside `WalletManager` and is never logged, serialized unencrypted, or passed outside the wallet module.**

---

## 🤖 How Agent Decisions Work

Each agent runs a decision loop every N seconds:

1. **Observe** — reads current SOL/token balances
2. **Reason** — sends portfolio state to Claude API with personality + rules
3. **Decide** — Claude returns a structured JSON action
4. **Execute** — wallet layer carries out the action on-chain
5. **Log** — result is stored in decision history for context on next cycle

Example Claude prompt response:
```json
{
  "action": "swap_sol_to_usdc",
  "amount": 0.5,
  "reasoning": "SOL balance is high, diversifying into USDC to reduce volatility exposure"
}
```

---

## 🧪 Devnet Testing

All activity happens on **Solana devnet** — no real funds involved.

Agents will automatically request airdrops when their balance is low. You can also manually airdrop:

```bash
solana airdrop 2 <AGENT_PUBLIC_KEY> --url devnet
```

---

## 📖 Deep Dive

See [DEEP_DIVE.md](./DEEP_DIVE.md) for a full technical walkthrough of:
- Wallet design decisions
- Security model
- How Claude is integrated as the agent brain
- Scalability considerations

---

## 📜 License

MIT
