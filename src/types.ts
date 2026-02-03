import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { XmtpAccountConfig, XmtpConfig } from "./config-schema.js";

export interface ResolvedXmtpAccount {
  accountId: string;
  name: string | undefined;
  enabled: boolean;
  configured: boolean;
  privateKey: string;
  dbPath: string | undefined;
  address: string | undefined;
  config: {
    privateKey: string;
    dmPolicy?: string;
    allowFrom?: string[];
  };
}

function getXmtpConfig(cfg: OpenClawConfig): XmtpConfig | undefined {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  return channels?.xmtp as XmtpConfig | undefined;
}

export function listXmtpAccountIds(cfg: OpenClawConfig): string[] {
  const xmtp = getXmtpConfig(cfg);
  if (!xmtp?.accounts) return [];
  return Object.keys(xmtp.accounts);
}

export function resolveDefaultXmtpAccountId(cfg: OpenClawConfig): string {
  const accountIds = listXmtpAccountIds(cfg);
  return accountIds[0] ?? "default";
}

export function resolveXmtpAccount({
  cfg,
  accountId,
}: {
  cfg: OpenClawConfig;
  accountId?: string;
}): ResolvedXmtpAccount {
  const xmtp = getXmtpConfig(cfg);
  const aid = accountId ?? resolveDefaultXmtpAccountId(cfg);
  const accountConfig = xmtp?.accounts?.[aid];

  if (!accountConfig) {
    return {
      accountId: aid,
      name: undefined,
      enabled: false,
      configured: false,
      privateKey: "",
      dbPath: undefined,
      address: undefined,
      config: {
        privateKey: "",
        dmPolicy: xmtp?.dmPolicy ?? "pairing",
        allowFrom: xmtp?.allowFrom ?? [],
      },
    };
  }

  // Resolve environment variables in privateKey
  let privateKey = accountConfig.privateKey ?? "";
  if (privateKey.startsWith("${") && privateKey.endsWith("}")) {
    const envVar = privateKey.slice(2, -1);
    privateKey = process.env[envVar] ?? "";
  }

  const configured = !!privateKey && privateKey.startsWith("0x") && privateKey.length === 66;

  return {
    accountId: aid,
    name: accountConfig.name,
    enabled: accountConfig.enabled !== false,
    configured,
    privateKey,
    dbPath: accountConfig.dbPath,
    address: undefined, // Will be set at runtime
    config: {
      privateKey,
      dmPolicy: xmtp?.dmPolicy ?? "pairing",
      allowFrom: xmtp?.allowFrom ?? [],
    },
  };
}

export function normalizeAddress(address: string): string {
  // Normalize Ethereum address to lowercase
  return address.toLowerCase().trim();
}
