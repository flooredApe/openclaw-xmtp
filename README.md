# openclaw-xmtp

XMTP channel plugin for [OpenClaw](https://github.com/openclaw/openclaw) — enables web3 messaging via the XMTP protocol.

## Installation

```bash
openclaw plugins install @openclaw/xmtp
# or from local path
openclaw plugins install --link /path/to/openclaw-xmtp
```

## Configuration

Add to your `openclaw.json`:

```json
{
  "channels": {
    "xmtp": {
      "enabled": true,
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "accounts": {
        "default": {
          "privateKey": "${XMTP_PRIVATE_KEY}",
          "enabled": true,
          "name": "My Agent"
        }
      }
    }
  },
  "plugins": {
    "entries": {
      "xmtp": { "enabled": true }
    }
  }
}
```

### Multi-agent routing

Bind specific XMTP accounts to different agents:

```json
{
  "bindings": [
    {
      "agentId": "support-agent",
      "match": { "channel": "xmtp", "accountId": "support" }
    }
  ]
}
```

## Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `accounts.<id>.privateKey` | string | Ethereum private key (hex with 0x prefix) |
| `accounts.<id>.enabled` | boolean | Enable/disable this account |
| `accounts.<id>.name` | string | Display name |
| `accounts.<id>.dbPath` | string | Path to persist XMTP database |
| `dmPolicy` | string | `"pairing"`, `"allowlist"`, `"open"`, or `"disabled"` |
| `allowFrom` | string[] | Allowed sender addresses (use `["*"]` for open) |

## Dependencies

- `@xmtp/agent-sdk` — XMTP Agent SDK
- `viem` — Ethereum wallet library
- `zod` — Schema validation

## Development

```bash
cd ~/.openclaw/extensions/xmtp
npm install
```

After code changes, clear jiti cache and restart gateway:

```bash
rm -rf /tmp/jiti*
openclaw gateway restart
```

## License

MIT
