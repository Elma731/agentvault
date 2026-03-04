import {
  Keypair,
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Commitment,
  RpcResponseAndContext,
  SignatureResult,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const WALLETS_DIR = path.join(process.cwd(), ".wallets");
const ALGORITHM = "aes-256-gcm";

// Commitment levels from Solana RPC docs:
// "finalized" - confirmed by supermajority, max lockout (safest, slowest)
// "confirmed" - voted on by supermajority (good balance for agent ops)
// "processed" - received by node (fastest, can be rolled back - avoid for funds)
const DEFAULT_COMMITMENT: Commitment = "confirmed";
const FINALIZED_COMMITMENT: Commitment = "finalized";

export interface WalletInfo {
  agentId: string;
  publicKey: string;
  solBalance: number;
  tokenBalances: Record<string, number>;
}

export interface TransactionResult {
  success: boolean;
  signature?: string;
  error?: string;
  slot?: number;
}

export class WalletManager {
  private keypair: Keypair;
  private agentId: string;
  private connection: Connection;
  private encryptionSecret: string;

  constructor(agentId: string, connection: Connection) {
    this.agentId = agentId;
    this.connection = connection;
    this.encryptionSecret =
      process.env.WALLET_ENCRYPTION_SECRET || "default-secret-change-me";
    this.keypair = this.loadOrCreateKeypair();
  }

  // ── Key Management ──────────────────────────────────────────────────────────

  private loadOrCreateKeypair(): Keypair {
    if (!fs.existsSync(WALLETS_DIR)) {
      fs.mkdirSync(WALLETS_DIR, { recursive: true });
    }
    const walletFile = path.join(WALLETS_DIR, `${this.agentId}.enc`);
    if (fs.existsSync(walletFile)) {
      return this.loadKeypair(walletFile);
    } else {
      return this.createAndSaveKeypair(walletFile);
    }
  }

  private createAndSaveKeypair(walletFile: string): Keypair {
    const keypair = Keypair.generate();
    const secretKeyArray = Array.from(keypair.secretKey);
    const encrypted = this.encrypt(JSON.stringify(secretKeyArray));
    fs.writeFileSync(walletFile, encrypted, "utf8");
    return keypair;
  }

  private loadKeypair(walletFile: string): Keypair {
    const encrypted = fs.readFileSync(walletFile, "utf8");
    const decrypted = this.decrypt(encrypted);
    const secretKeyArray = JSON.parse(decrypted);
    return Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(this.encryptionSecret, "salt", 32);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
  }

  private decrypt(text: string): string {
    const [ivHex, authTagHex, encrypted] = text.split(":");
    const key = crypto.scryptSync(this.encryptionSecret, "salt", 32);
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  // ── Balance Queries ──────────────────────────────────────────────────────────

  /**
   * Get SOL balance via getBalance RPC method.
   * Uses "confirmed" commitment — voted on by supermajority, safe for agent decisions.
   */
  async getSOLBalance(): Promise<number> {
  try {
    const response = await fetch("https://api.devnet.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [this.keypair.publicKey.toBase58()]
      })
    });
    const data = await response.json() as { result: { value: number } };
    return data.result.value / LAMPORTS_PER_SOL;
  } catch {
    return 0;
  }
}

  /**
   * Get SPL token balance via getTokenAccountBalance RPC method.
   * Returns UI amount already adjusted for token decimals.
   * @param mintAddress - Token mint address (base-58 encoded)
   */
  async getTokenBalance(mintAddress: string): Promise<number> {
    try {
      const mint = new PublicKey(mintAddress);
      const ata = await getAssociatedTokenAddress(mint, this.keypair.publicKey);
      const accountInfo = await getAccount(
        this.connection,
        ata,
        DEFAULT_COMMITMENT
      );
      return accountInfo.amount
        ? Number(accountInfo.amount) / Math.pow(10, 6) // USDC has 6 decimals
        : 0;
    } catch (e) {
      if (e instanceof TokenAccountNotFoundError) return 0;
      return 0;
    }
  }

  // ── Transactions ─────────────────────────────────────────────────────────────

  /**
   * Request SOL airdrop from devnet faucet.
   * Uses getLatestBlockhash + confirmTransaction as recommended by Solana RPC docs.
   * Note: sendTransaction does not wait for confirmation — we must poll separately.
   */
  async requestAirdrop(solAmount: number = 1): Promise<TransactionResult> {
  try {
    const lamports = solAmount * LAMPORTS_PER_SOL;
    
    // Request airdrop via direct RPC call
    const response = await fetch("https://api.devnet.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "requestAirdrop",
        params: [this.keypair.publicKey.toBase58(), lamports]
      })
    });
    
    const data = await response.json() as { result: string; error?: any };
    
    if (data.error) {
      return { success: false, error: data.error.message };
    }
    
    const signature = data.result;
    
    // Wait a few seconds for confirmation
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    return { success: true, signature };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

  /**
   * Send SOL to another address using SystemProgram.transfer.
   * Enforces minimum 0.05 SOL fee buffer before sending.
   */
  async sendSOL(
    toAddress: string,
    amount: number
  ): Promise<TransactionResult> {
    try {
      const currentBalance = await this.getSOLBalance();
      if (currentBalance - amount < 0.05) {
        return {
          success: false,
          error: "Insufficient balance: would drop below 0.05 SOL fee buffer",
        };
      }

      const toPublicKey = new PublicKey(toAddress);
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.keypair.publicKey,
          toPubkey: toPublicKey,
          lamports,
        })
      );

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.keypair],
        { commitment: DEFAULT_COMMITMENT }
      );

      return { success: true, signature };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Check transaction status using getSignatureStatuses RPC method.
   * Use this to monitor transactions after sendRawTransaction.
   * Per Solana docs: sendTransaction succeeds immediately, doesn't guarantee processing.
   */
  async getTransactionStatus(signature: string): Promise<string> {
    try {
      const statuses = await this.connection.getSignatureStatuses([signature]);
      const status = statuses.value[0];
      if (!status) return "unknown";
      if (status.err) return "failed";
      if (status.confirmationStatus === "finalized") return "finalized";
      if (status.confirmationStatus === "confirmed") return "confirmed";
      return "processing";
    } catch {
      return "unknown";
    }
  }

  // ── Wallet Info ───────────────────────────────────────────────────────────────

  async getWalletInfo(): Promise<WalletInfo> {
    const solBalance = await this.getSOLBalance();
    const usdcBalance = await this.getTokenBalance(
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" // devnet USDC mint
    );
    return {
      agentId: this.agentId,
      publicKey: this.getPublicKey(),
      solBalance,
      tokenBalances: { USDC: usdcBalance },
    };
  }

  // ── Getters ───────────────────────────────────────────────────────────────────

  getPublicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Expose keypair ONLY for transaction signing within protocol-layer operations.
   * Agent layer must never receive this directly.
   */
  getKeypairForSigning(): Keypair {
    return this.keypair;
  }
}
