# @px402/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server that lets any MCP-aware agent (Claude Desktop, Claude Code, Cursor) pay for HTTP APIs via [px402](https://github.com/Allen-Saji/px402).

The agent doesn't need to know about Solana, USDC, or 402. It just calls `px402_fetch(url)` and the MCP server handles the 402 → pay → retry loop with the agent's wallet.

## Install

```sh
pnpm add -g @px402/mcp
```

After install, the `px402-mcp` binary is on your `$PATH`.

## Tools exposed

| Tool | Args | What it does |
|---|---|---|
| `px402_fetch` | `url`, `method?`, `headers?`, `body?` | Calls a paid API. Pays automatically on 402. Returns `{ status, signature, body }`. |
| `px402_balance` | none | Reads the agent wallet's base-chain USDC balance. |

## Wire into Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or equivalent:

```json
{
  "mcpServers": {
    "px402": {
      "command": "px402-mcp",
      "env": {
        "PX402_KEYPAIR_PATH": "/absolute/path/to/agent-keypair.json",
        "PX402_MINT": "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse",
        "PX402_CLUSTER": "devnet"
      }
    }
  }
}
```

Restart Claude. The two tools appear in the tool picker.

## Wire into Claude Code

```json
// ~/.claude/settings.json or .claude/settings.json
{
  "mcpServers": {
    "px402": {
      "command": "px402-mcp",
      "env": {
        "PX402_KEYPAIR_PATH": "/absolute/path/to/agent-keypair.json",
        "PX402_MINT": "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse",
        "PX402_CLUSTER": "devnet"
      }
    }
  }
}
```

## Env vars

| Var | Required | Default |
|---|---|---|
| `PX402_KEYPAIR_PATH` | yes | — |
| `PX402_MINT` | yes | — |
| `PX402_CLUSTER` | no | `devnet` |
| `PX402_API_URL` | no | `https://payments.magicblock.app` |
| `PX402_BASE_RPC_URL` | no | `https://rpc.magicblock.app/devnet` |
| `PX402_EPHEMERAL_RPC_URL` | no | `https://devnet.magicblock.app` |

## Programmatic use

```ts
import { createPx402McpServer, runStdio } from "@px402/mcp";
import { Keypair } from "@solana/web3.js";

const server = createPx402McpServer({
  wallet: Keypair.fromSecretKey(/* ... */),
  mint: "5CmxDcDtDiqwxy9TDVyo1Xjr4AFwQzrH7vKr8cXfkEse",
});
await runStdio(server);
```

## Security

The keypair file is read once at startup. Don't point this at a hot wallet — fund a fresh agent-only keypair with the smallest amount you'd be comfortable burning.

## License

MIT
