import { Connection } from "@solana/web3.js";
import { AIAgent, AgentLog } from "./AIAgent";
import chalk from "chalk";

export class AgentManager {
  private agents: AIAgent[] = [];
  private connection: Connection;
  private intervalMs: number;
  private isRunning: boolean = false;

  constructor(connection: Connection, numAgents: number, intervalMs: number) {
    this.connection = connection;
    this.intervalMs = intervalMs;

    // Spawn N agents, each with their own isolated wallet
    for (let i = 0; i < numAgents; i++) {
      const agentId = `agent-${i + 1}`;
      this.agents.push(new AIAgent(agentId, connection));
    }
  }

  async initialize(): Promise<void> {
    console.log(chalk.cyan("\n🤖 Initializing Agentic Wallet System\n"));
    console.log(chalk.gray(`Spawning ${this.agents.length} agents...\n`));

    for (const agent of this.agents) {
      const info = await agent.getWalletInfo();
      console.log(
        chalk.green(`✓ ${agent.getAgentId()}`) +
          chalk.gray(` → ${info.publicKey}`) +
          chalk.yellow(` | ${info.solBalance.toFixed(4)} SOL`)
      );
    }

    console.log(
      chalk.cyan(
        `\n📡 Connected to Solana Devnet | Decision interval: ${this.intervalMs / 1000}s\n`
      )
    );
  }

  async runAllAgents(): Promise<void> {
    console.log(chalk.magenta("\n⚡ Running decision cycle for all agents...\n"));

    // Run all agents in parallel
    const promises = this.agents.map((agent) => this.runAgent(agent));
    await Promise.allSettled(promises);
  }

  private async runAgent(agent: AIAgent): Promise<void> {
    try {
      const log = await agent.runCycle();
      this.printAgentLog(log);
    } catch (error: any) {
      console.error(
        chalk.red(`✗ ${agent.getAgentId()} error: ${error.message}`)
      );
    }
  }

  private printAgentLog(log: AgentLog): void {
    const actionColor: Record<string, chalk.Chalk> = {
      swap_sol_to_usdc: chalk.blue,
      swap_usdc_to_sol: chalk.yellow,
      hold: chalk.gray,
      request_airdrop: chalk.green,
      send_sol: chalk.magenta,
    };

    const colorFn = actionColor[log.decision.action] || chalk.white;
    const balanceBefore = log.walletBefore.solBalance.toFixed(4);
    const balanceAfter = log.walletAfter?.solBalance.toFixed(4) || balanceBefore;
    const balanceChange =
      parseFloat(balanceAfter) - parseFloat(balanceBefore);
    const changeStr =
      balanceChange >= 0
        ? chalk.green(`+${balanceChange.toFixed(4)}`)
        : chalk.red(`${balanceChange.toFixed(4)}`);

    console.log(
      chalk.bold(`[${log.agentId}]`) +
        " " +
        colorFn(log.decision.action.toUpperCase()) +
        chalk.gray(` | SOL: ${balanceBefore} → ${balanceAfter} (${changeStr})`)
    );
    console.log(chalk.gray(`  💭 ${log.decision.reasoning}`));
    console.log(chalk.gray(`  ✅ ${log.result}\n`));
  }

  async start(): Promise<void> {
    await this.initialize();
    this.isRunning = true;

    // First cycle immediately
    await this.runAllAgents();

    // Then loop at interval
    const interval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(interval);
        return;
      }
      await this.runAllAgents();
    }, this.intervalMs);

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log(chalk.yellow("\n\n⏹  Shutting down agents gracefully...\n"));
      this.isRunning = false;
      clearInterval(interval);

      this.printSummary();
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
  }

  private printSummary(): void {
    console.log(chalk.cyan("📊 Session Summary\n"));
    for (const agent of this.agents) {
      const history = agent.getDecisionHistory();
      const actions = history.map((h) => h.decision.action);
      const actionCounts = actions.reduce(
        (acc, a) => {
          acc[a] = (acc[a] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      console.log(chalk.bold(`${agent.getAgentId()}:`));
      console.log(
        chalk.gray(`  Total decisions: ${history.length}`)
      );
      Object.entries(actionCounts).forEach(([action, count]) => {
        console.log(chalk.gray(`  ${action}: ${count}x`));
      });
      console.log();
    }
  }

  getAgents(): AIAgent[] {
    return this.agents;
  }
}
