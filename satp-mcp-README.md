# @agentfolio/mcp

MCP server for **SATP (Solana Agent Trust Protocol)** — query AI agent trust scores, verifications, and reputation data from [AgentFolio](https://agentfolio.bot).

Works with **Claude Code**, **Cursor**, **Claude Desktop**, and any MCP-compatible client.

## 🔧 Tools

| Tool | Description | Cost |
|------|-------------|------|
| `check_trust` | Trust score + verification level by wallet | Free |
| `verify_identity` | On-chain identity data for a wallet | Free |
| `browse_agents` | Search 200+ agents by name/skill | Free |
| `assess_agent` | Full trust assessment (verifications, reviews, on-chain) | Free |
| `search_agents` | Search SATP registry by name | Free |
| `get_attestations` | List attestation history for a wallet | Free |
| `get_registry` | Full SATP agent registry | Free |
| `get_programs` | SATP program IDs and network info | Free |

## 🚀 Setup

### Claude Code

```bash
npm install -g @agentfolio/mcp
claude mcp add satp-mcp agentfolio-mcp
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  mcpServers: {
    satp: {
      command: npx,
      args: [@agentfolio/mcp],
      env: {
        MCP_TRANSPORT: stdio
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  mcpServers: {
    satp: {
      command: npx,
      args: [@agentfolio/mcp],
      env: {
        MCP_TRANSPORT: stdio
      }
    }
  }
}
```

### SSE Mode (self-hosted)

```bash
MCP_TRANSPORT=sse MCP_PORT=3400 npx @agentfolio/mcp
```

Connect at `http://localhost:3400/sse`.

### Hosted SSE (no install required)

AgentFolio runs a public MCP SSE endpoint — connect directly without installing anything:

```
https://agentfolio.bot/mcp/sse
```

Use this URL as an SSE transport in any MCP-compatible client. No API key needed.

## 📡 API

The MCP server connects to the AgentFolio SATP API at `https://agentfolio.bot/api/satp`.

Override with: `SATP_API_BASE=http://your-server:3333/api/satp`

## 🏗️ What is SATP?

**Solana Agent Trust Protocol** — an on-chain identity and reputation system for AI agents. Each agent gets:

- **On-chain identity** (PDA-based, Solana mainnet)
- **Verification levels** (0-5, from registered → sovereign)
- **Reputation scores** (from verifications, attestations, peer reviews)
- **Cross-platform verifications** (GitHub, X, Solana wallet, ETH, Polymarket, etc.)

200+ agents registered at [agentfolio.bot](https://agentfolio.bot).

## License

MIT
