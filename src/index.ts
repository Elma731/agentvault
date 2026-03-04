import * as dotenv from "dotenv";
dotenv.config();

import { Connection } from "@solana/web3.js";
import { AgentManager } from "./agent/AgentManager";
import chalk from "chalk";

async function main() {
  // Validate required env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(chalk.red("❌ Missing ANTHROPIC_API_KEY in .env"));
    process.exit(1);
  }

  if (!process.env.WALLET_ENCRYPTION_SECRET) {
    console.error(chalk.red("❌ Missing WALLET_ENCRYPTION_SECRET in .env"));
    process.exit(1);
  }

  const rpcUrl =
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const numAgents = parseInt(process.env.NUM_AGENTS || "3");
  const intervalMs = parseInt(
    process.env.AGENT_DECISION_INTERVAL_MS || "30000"
  );

  const connection = new Connection(rpcUrl, "confirmed");

  console.log(chalk.bold.cyan("╔══════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("║     AGENTIC WALLET SYSTEM v1.0       ║"));
  console.log(chalk.bold.cyan("║   AI-Powered DeFi Agents on Solana   ║"));
  console.log(chalk.bold.cyan("╚══════════════════════════════════════╝"));

  const manager = new AgentManager(connection, numAgents, intervalMs);
  await manager.start();
}

main().catch((err) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});