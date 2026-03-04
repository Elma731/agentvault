import Anthropic from "@anthropic-ai/sdk";
import { WalletManager, WalletInfo } from "../wallet/WalletManager";
import { JupiterProtocol } from "../protocols/JupiterProtocol";
import { Connection } from "@solana/web3.js";

export type AgentAction =
  | "swap_sol_to_usdc"
  | "swap_usdc_to_sol"
  | "hold"
  | "request_airdrop"
  | "send_sol";

export interface AgentDecision {
  action: AgentAction;
  amount?: number;
  toAddress?: string;
  reasoning: string;
}

export interface AgentLog {
  agentId: string;
  timestamp: string;
  decision: AgentDecision;
  result: string;
  walletBefore: WalletInfo;
  walletAfter?: WalletInfo;
}

export class AIAgent {
  private agentId: string;
  private wallet: WalletManager;
  private jupiter: JupiterProtocol;
  private anthropic: Anthropic;
  private decisionHistory: AgentLog[] = [];
  private personality: string;

  constructor(agentId: string, connection: Connection) {
    this.agentId = agentId;
    this.wallet = new WalletManager(agentId, connection);
    this.jupiter = new JupiterProtocol(connection);
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Give each agent a slightly different personality/strategy
    const personalities = [
      "You are a conservative agent. You prefer holding SOL and only swap when you have excess. Minimize risk.",
      "You are an aggressive trader. You actively swap between SOL and USDC to maximise returns.",
      "You are a balanced agent. You try to maintain a 50/50 split between SOL and USDC.",
    ];
    const index = parseInt(agentId.replace(/\D/g, "")) % personalities.length;
    this.personality = personalities[index] || personalities[0];
  }

  // ── Decision Making ──────────────────────────────────────────────────────────

  async makeDecision(): Promise<AgentDecision> {
    const walletInfo = await this.wallet.getWalletInfo();
    const recentHistory = this.decisionHistory.slice(-3).map((log) => ({
      action: log.decision.action,
      result: log.result,
      time: log.timestamp,
    }));

    const prompt = `${this.personality}

You are an autonomous DeFi agent on Solana devnet managing your own wallet.

CURRENT PORTFOLIO:
- SOL Balance: ${walletInfo.solBalance.toFixed(4)} SOL
- USDC Balance: ${(walletInfo.tokenBalances.USDC || 0).toFixed(2)} USDC
- Public Key: ${walletInfo.publicKey}

RECENT ACTIONS:
${recentHistory.length > 0 ? JSON.stringify(recentHistory, null, 2) : "No recent actions"}

AVAILABLE ACTIONS:
1. "swap_sol_to_usdc" - Swap some SOL to USDC (specify amount in SOL, min 0.01)
2. "swap_usdc_to_sol" - Swap some USDC to SOL (specify amount in USDC)
3. "hold" - Do nothing this cycle
4. "request_airdrop" - Request 1 SOL airdrop from devnet faucet (only if balance < 0.5 SOL)

RULES:
- Always keep at least 0.05 SOL for transaction fees
- Never swap more than 80% of your SOL balance at once
- If balance is critically low (< 0.1 SOL), request an airdrop
- Respond ONLY with valid JSON, no markdown, no extra text

Respond with this exact JSON structure:
{
  "action": "one of the actions above",
  "amount": 0.1,
  "reasoning": "brief explanation of why"
}`;

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      const clean = text.replace(/```json|```/g, "").trim();
      const decision: AgentDecision = JSON.parse(clean);
      return decision;
    } catch (error: any) {
      console.error("Claude API error:", error.message || error);
      return {
        action: "hold",
        reasoning: "API error, holding as safe default",
      };
    }
  }

  // ── Action Execution ─────────────────────────────────────────────────────────

  async executeDecision(decision: AgentDecision): Promise<string> {
    const { action, amount } = decision;

    switch (action) {
      case "request_airdrop": {
        const result = await this.wallet.requestAirdrop(1);
        if (result.success) {
          return `Airdrop successful (slot ${result.slot}). Tx: ${result.signature?.slice(0, 20)}...`;
        }
        return `Airdrop failed: ${result.error}`;
      }

      case "swap_sol_to_usdc": {
        if (!amount || amount <= 0) return "Invalid amount for swap";
        const keypair = this.wallet.getKeypairForSigning();
        const result = await this.jupiter.swapSOLtoUSDC(keypair, amount);
        if (result.success) {
          return `Swapped ${amount} SOL → USDC. Tx: ${result.signature?.slice(0, 20)}...`;
        }
        return `Swap failed: ${result.error}`;
      }

      case "swap_usdc_to_sol": {
        if (!amount || amount <= 0) return "Invalid amount for swap";
        const keypair = this.wallet.getKeypairForSigning();
        const result = await this.jupiter.swapUSDCtoSOL(keypair, amount);
        if (result.success) {
          return `Swapped ${amount} USDC → SOL. Tx: ${result.signature?.slice(0, 20)}...`;
        }
        return `Swap failed: ${result.error}`;
      }

      case "send_sol": {
        if (!amount || !decision.toAddress) return "Missing amount or address";
        const result = await this.wallet.sendSOL(decision.toAddress, amount);
        if (result.success) {
          return `Sent ${amount} SOL to ${decision.toAddress.slice(0, 8)}... Tx: ${result.signature?.slice(0, 20)}...`;
        }
        return `Send failed: ${result.error}`;
      }

      case "hold":
      default:
        return "Holding position. No action taken.";
    }
  }

  // ── Main Cycle ───────────────────────────────────────────────────────────────

  async runCycle(): Promise<AgentLog> {
    const walletBefore = await this.wallet.getWalletInfo();
    const decision = await this.makeDecision();
    const result = await this.executeDecision(decision);
    const walletAfter = await this.wallet.getWalletInfo();

    const log: AgentLog = {
      agentId: this.agentId,
      timestamp: new Date().toISOString(),
      decision,
      result,
      walletBefore,
      walletAfter,
    };

    this.decisionHistory.push(log);
    return log;
  }

  // ── Getters ──────────────────────────────────────────────────────────────────

  getAgentId(): string {
    return this.agentId;
  }

  getPublicKey(): string {
    return this.wallet.getPublicKey();
  }

  async getWalletInfo(): Promise<WalletInfo> {
    return this.wallet.getWalletInfo();
  }

  getDecisionHistory(): AgentLog[] {
    return this.decisionHistory;
  }
}
