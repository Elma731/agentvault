import {
  Connection,
  PublicKey,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import axios from "axios";

// Jupiter v6 API
const JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP_API = "https://quote-api.jup.ag/v6/swap";

// Common devnet token mints
export const DEVNET_TOKENS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // devnet USDC
};

export interface SwapResult {
  success: boolean;
  signature?: string;
  inputAmount: number;
  outputAmount: number;
  error?: string;
}

export interface QuoteResult {
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  priceImpactPct: number;
}

export class JupiterProtocol {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amountInLamports: number
  ): Promise<QuoteResult | null> {
    try {
      const response = await axios.get(JUPITER_QUOTE_API, {
        params: {
          inputMint,
          outputMint,
          amount: amountInLamports,
          slippageBps: 50, // 0.5% slippage
        },
        timeout: 10000,
      });

      const quote = response.data;
      return {
        inputMint,
        outputMint,
        inputAmount: amountInLamports,
        outputAmount: parseInt(quote.outAmount),
        priceImpactPct: parseFloat(quote.priceImpactPct),
      };
    } catch (error) {
      return null;
    }
  }

  async swapSOLtoUSDC(
    keypair: Keypair,
    solAmount: number
  ): Promise<SwapResult> {
    return this.executeSwap(
      keypair,
      DEVNET_TOKENS.SOL,
      DEVNET_TOKENS.USDC,
      solAmount * LAMPORTS_PER_SOL
    );
  }

  async swapUSDCtoSOL(
    keypair: Keypair,
    usdcAmount: number
  ): Promise<SwapResult> {
    const usdcLamports = usdcAmount * 1_000_000; // USDC has 6 decimals
    return this.executeSwap(
      keypair,
      DEVNET_TOKENS.USDC,
      DEVNET_TOKENS.SOL,
      usdcLamports
    );
  }

  private async executeSwap(
    keypair: Keypair,
    inputMint: string,
    outputMint: string,
    amountInLamports: number
  ): Promise<SwapResult> {
    try {
      // 1. Get quote
      const quoteResponse = await axios.get(JUPITER_QUOTE_API, {
        params: {
          inputMint,
          outputMint,
          amount: amountInLamports,
          slippageBps: 50,
        },
        timeout: 10000,
      });

      const quote = quoteResponse.data;

      // 2. Get swap transaction
      const swapResponse = await axios.post(
        JUPITER_SWAP_API,
        {
          quoteResponse: quote,
          userPublicKey: keypair.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: "auto",
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
        }
      );

      const { swapTransaction } = swapResponse.data;

      // 3. Deserialize and sign transaction
      const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([keypair]);

      // 4. Send transaction
      const rawTransaction = transaction.serialize();
      const signature = await this.connection.sendRawTransaction(
        rawTransaction,
        {
          skipPreflight: true,
          maxRetries: 3,
        }
      );

      // 5. Confirm
      const latestBlockhash = await this.connection.getLatestBlockhash();
      await this.connection.confirmTransaction({
        signature,
        ...latestBlockhash,
      });

      return {
        success: true,
        signature,
        inputAmount: amountInLamports,
        outputAmount: parseInt(quote.outAmount),
      };
    } catch (error: any) {
      return {
        success: false,
        inputAmount: amountInLamports,
        outputAmount: 0,
        error: error.message || "Swap failed",
      };
    }
  }
}
