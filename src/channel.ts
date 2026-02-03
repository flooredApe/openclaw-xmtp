import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";

import { XmtpConfigSchema } from "./config-schema.js";
import { getXmtpRuntime } from "./runtime.js";
import {
  listXmtpAccountIds,
  resolveDefaultXmtpAccountId,
  resolveXmtpAccount,
  normalizeAddress,
  type ResolvedXmtpAccount,
} from "./types.js";
import { startXmtpClient, type XmtpClientHandle } from "./xmtp-client.js";

// Store active client handles per account
const activeClients = new Map<string, XmtpClientHandle>();

export const xmtpPlugin: ChannelPlugin<ResolvedXmtpAccount> = {
  id: "xmtp",
  meta: {
    id: "xmtp",
    label: "XMTP",
    selectionLabel: "XMTP (Web3 Messaging)",
    docsPath: "/channels/xmtp",
    docsLabel: "xmtp",
    blurb: "Web3 messaging via XMTP protocol",
    order: 95,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: false,
  },
  reload: { configPrefixes: ["channels.xmtp"] },
  configSchema: buildChannelConfigSchema(XmtpConfigSchema),

  config: {
    listAccountIds: (cfg) => listXmtpAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveXmtpAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultXmtpAccountId(cfg),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      address: account.address,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveXmtpAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) =>
        String(entry)
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => {
          if (entry === "*") return "*";
          return normalizeAddress(entry);
        })
        .filter(Boolean),
  },

  pairing: {
    idLabel: "ethereumAddress",
    normalizeAllowEntry: (entry) => normalizeAddress(entry),
    notifyApproval: async ({ id }) => {
      const client = activeClients.get(DEFAULT_ACCOUNT_ID);
      if (client) {
        await client.sendDm(id, "Your pairing request has been approved!");
      }
    },
  },

  security: {
    resolveDmPolicy: ({ account }) => {
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: "channels.xmtp.dmPolicy",
        allowFromPath: "channels.xmtp.allowFrom",
        approveHint: formatPairingApproveHint("xmtp"),
        normalizeEntry: (raw) => normalizeAddress(raw.trim()),
      };
    },
  },

  messaging: {
    normalizeTarget: (target) => normalizeAddress(target.trim()),
    targetResolver: {
      looksLikeId: (input) => {
        const trimmed = input.trim().toLowerCase();
        return trimmed.startsWith("0x") && trimmed.length === 42;
      },
      hint: "<ethereum address 0x...>",
    },
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId }) => {
      const core = getXmtpRuntime();
      const aid = accountId ?? DEFAULT_ACCOUNT_ID;
      const client = activeClients.get(aid);
      if (!client) {
        throw new Error(`XMTP client not running for account ${aid}`);
      }
      const tableMode = core.channel.text.resolveMarkdownTableMode({
        cfg: core.config.loadConfig(),
        channel: "xmtp",
        accountId: aid,
      });
      const message = core.channel.text.convertMarkdownTables(text ?? "", tableMode);
      const normalizedTo = normalizeAddress(to);
      await client.sendDm(normalizedTo, message);
      return { channel: "xmtp", to: normalizedTo };
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        const lastError = typeof account.lastError === "string" ? account.lastError.trim() : "";
        if (!lastError) return [];
        return [
          {
            channel: "xmtp",
            accountId: account.accountId,
            kind: "runtime" as const,
            message: `Channel error: ${lastError}`,
          },
        ];
      }),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      address: snapshot.address ?? null,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      address: account.address,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.setStatus({ accountId: account.accountId });
      ctx.log?.info(`[${account.accountId}] starting XMTP client`);

      if (!account.configured) {
        throw new Error("XMTP private key not configured");
      }

      const runtime = getXmtpRuntime();
      const cfg = runtime.config.loadConfig() as OpenClawConfig;

      const client = await startXmtpClient({
        accountId: account.accountId,
        privateKey: account.privateKey,
        dbPath: account.dbPath,
        onMessage: async (senderAddress, text, reply) => {
          ctx.log?.debug(`[${account.accountId}] DM from ${senderAddress}: ${text.slice(0, 50)}...`);

          // Resolve agent route for this message
          const route = runtime.channel.routing.resolveAgentRoute({
            cfg,
            channel: "xmtp",
            accountId: account.accountId,
            peer: {
              kind: "dm",
              id: senderAddress,
            },
          });

          // Format the message envelope
          const body = runtime.channel.reply.formatAgentEnvelope({
            channel: "XMTP",
            from: senderAddress,
            timestamp: Date.now(),
            envelope: runtime.channel.reply.resolveEnvelopeFormatOptions(cfg),
            body: text,
          });

          // Create inbound context
          const ctxPayload = runtime.channel.reply.finalizeInboundContext({
            Body: body,
            RawBody: text,
            CommandBody: text,
            From: `xmtp:${senderAddress}`,
            To: `xmtp:${account.address}`,
            SessionKey: route.sessionKey,
            AccountId: route.accountId,
            ChatType: "direct",
            ConversationLabel: senderAddress.slice(0, 10) + "...",
            SenderName: senderAddress,
            SenderId: senderAddress,
            Provider: "xmtp",
            Surface: "xmtp",
            OriginatingChannel: "xmtp",
            OriginatingTo: `xmtp:${account.address}`,
          });

          // Record the session
          const storePath = runtime.channel.session.resolveStorePath(cfg.session?.store, {
            agentId: route.agentId,
          });
          await runtime.channel.session.recordInboundSession({
            storePath,
            sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
            ctx: ctxPayload,
            onRecordError: (err) => {
              ctx.log?.error(`[${account.accountId}] Failed updating session meta: ${String(err)}`);
            },
          });

          // Resolve table mode for formatting
          const tableMode = runtime.channel.text.resolveMarkdownTableMode({
            cfg,
            channel: "xmtp",
            accountId: account.accountId,
          });

          // Dispatch to agent and deliver reply
          await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg,
            dispatcherOptions: {
              deliver: async (payload) => {
                if (payload.text) {
                  const responseText = runtime.channel.text.convertMarkdownTables(
                    payload.text,
                    tableMode
                  );
                  await reply(responseText);
                  ctx.setStatus({ lastOutboundAt: Date.now() });
                }
              },
            },
          });
        },
        onError: (error, context) => {
          ctx.log?.error(`[${account.accountId}] XMTP error (${context}): ${error.message}`);
        },
        onStart: (address) => {
          ctx.log?.info(`[${account.accountId}] XMTP client started, address: ${address}`);
          ctx.setStatus({ address });
        },
        onStop: () => {
          ctx.log?.info(`[${account.accountId}] XMTP client stopped`);
        },
      });

      account.address = client.address;
      ctx.setStatus({ address: client.address });
      activeClients.set(account.accountId, client);

      ctx.log?.info(`[${account.accountId}] XMTP client ready, address: ${client.address}`);

      return {
        stop: async () => {
          await client.stop();
          activeClients.delete(account.accountId);
          ctx.log?.info(`[${account.accountId}] XMTP client stopped`);
        },
      };
    },
  },
};

export function getActiveXmtpClients(): Map<string, XmtpClientHandle> {
  return new Map(activeClients);
}
