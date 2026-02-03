import { Agent, createSigner, filter } from "@xmtp/agent-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { mainnet } from "viem/chains";

export interface XmtpClientOptions {
  accountId: string;
  privateKey: string;
  dbPath?: string;
  onMessage: (senderAddress: string, text: string, reply: (text: string) => Promise<void>) => Promise<void>;
  onError?: (error: Error, context: string) => void;
  onStart?: (address: string) => void;
  onStop?: () => void;
}

export interface XmtpClientHandle {
  address: string;
  stop: () => Promise<void>;
  sendDm: (to: string, text: string) => Promise<void>;
}

/**
 * Create a user object compatible with XMTP's createSigner
 */
function createUserFromPrivateKey(privateKey: string) {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  });
  
  return {
    key: privateKey,
    account,
    wallet,
  };
}

/**
 * Simple seen message tracker to deduplicate messages
 */
class SeenTracker {
  private seen = new Map<string, number>();
  private maxSize = 10000;
  private ttlMs = 60 * 60 * 1000; // 1 hour

  hasSeen(id: string): boolean {
    const ts = this.seen.get(id);
    if (!ts) return false;
    if (Date.now() - ts > this.ttlMs) {
      this.seen.delete(id);
      return false;
    }
    return true;
  }

  markSeen(id: string): void {
    // Prune if too large
    if (this.seen.size >= this.maxSize) {
      const now = Date.now();
      for (const [key, ts] of this.seen) {
        if (now - ts > this.ttlMs) {
          this.seen.delete(key);
        }
      }
      // If still too large, delete oldest
      if (this.seen.size >= this.maxSize) {
        const oldest = this.seen.keys().next().value;
        if (oldest) this.seen.delete(oldest);
      }
    }
    this.seen.set(id, Date.now());
  }
}

export async function startXmtpClient(options: XmtpClientOptions): Promise<XmtpClientHandle> {
  const { accountId, privateKey, dbPath, onMessage, onError, onStart, onStop } = options;

  // Create user object from private key
  const user = createUserFromPrivateKey(privateKey);
  const address = user.account.address;
  
  // Create signer
  const signer = createSigner(user);

  // Determine db path
  const resolvedDbPath = dbPath ?? `/root/.openclaw/agents/${accountId}/xmtp-db`;

  // Create agent
  const agent = await Agent.create(signer, {
    env: "production",
    dbPath: resolvedDbPath,
  });

  // Message deduplication tracker
  const seenTracker = new SeenTracker();

  // Handle text messages
  agent.on("text", async (ctx) => {
    // Ignore messages from self
    if (filter.fromSelf(ctx.message, ctx.client)) {
      return;
    }

    // Deduplicate by message ID
    const messageId = ctx.message.id;
    if (seenTracker.hasSeen(messageId)) {
      return; // Already processed
    }
    seenTracker.markSeen(messageId);

    // getSenderAddress returns a Promise, must await
    const senderAddress = await ctx.getSenderAddress();
    const text = ctx.message.content as string;

    // Send "processing" reaction after 1 second delay
    setTimeout(async () => {
      try {
        await ctx.sendReaction("👀");
      } catch (error) {
        onError?.(error as Error, "reaction");
      }
    }, 1000);

    const reply = async (responseText: string) => {
      await ctx.sendTextReply(responseText);
    };

    try {
      await onMessage(senderAddress ?? "unknown", text, reply);
    } catch (error) {
      onError?.(error as Error, "message-handler");
    }
  });

  // Handle new DM conversations
  agent.on("dm", async (ctx) => {
    // Log new conversation but don't send automatic welcome
  });

  // Handle errors
  agent.on("unhandledError", (error) => {
    onError?.(error as Error, "unhandled");
  });

  // Handle start
  agent.on("start", () => {
    onStart?.(address);
  });

  // Handle stop
  agent.on("stop", () => {
    onStop?.();
  });

  // Start the agent
  await agent.start();

  return {
    address,
    stop: async () => {
      await agent.stop();
    },
    sendDm: async (to: string, text: string) => {
      const dm = await agent.createDmWithAddress(to);
      await dm.send(text);
    },
  };
}
