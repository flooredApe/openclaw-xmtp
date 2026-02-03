import { MarkdownConfigSchema, buildChannelConfigSchema } from "openclaw/plugin-sdk";
import { z } from "zod";

/**
 * Schema for a single XMTP account
 */
export const XmtpAccountConfigSchema = z.object({
  /** Ethereum private key (hex with 0x prefix) */
  privateKey: z.string(),
  
  /** Whether this account is enabled */
  enabled: z.boolean().optional(),
  
  /** Display name for this account */
  name: z.string().optional(),
  
  /** Path to persist XMTP database */
  dbPath: z.string().optional(),
});

export type XmtpAccountConfig = z.infer<typeof XmtpAccountConfigSchema>;

/**
 * Zod schema for channels.xmtp.* configuration
 */
export const XmtpConfigSchema = z.object({
  /** Account name (optional display name) */
  name: z.string().optional(),

  /** Whether this channel is enabled */
  enabled: z.boolean().optional(),

  /** Markdown formatting overrides (tables). */
  markdown: MarkdownConfigSchema,

  /** XMTP accounts keyed by account ID */
  accounts: z.record(z.string(), XmtpAccountConfigSchema).optional(),

  /** DM access policy: pairing, allowlist, open, or disabled */
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),

  /** Allowed sender addresses (Ethereum addresses) */
  allowFrom: z.array(z.string()).optional(),
});

export type XmtpConfig = z.infer<typeof XmtpConfigSchema>;

/**
 * JSON Schema for Control UI (converted from Zod)
 */
export const xmtpChannelConfigSchema = buildChannelConfigSchema(XmtpConfigSchema);
