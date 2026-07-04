# Setup Guide for Claude Code

This file is a step-by-step guide for Claude Code (or any LLM agent) to install and configure the TradingView MCP server. If a user asks you to install or set up this project, follow these steps exactly.

## Step 1: Clone and Install

```bash
git clone https://github.com/Digisenda/tradingview-mcp-jackson.git ~/tradingview-mcp-jackson
cd ~/tradingview-mcp-jackson
npm install
```

If the user specifies a different install path, use that instead of `~/tradingview-mcp-jackson`.

## Step 2: Set Up Rules

> [!WARNING]
> `rules.example.json` is a **crypto/swing trading example** (EMA, RSI, BTCUSD watchlist). Do NOT use it as a template if you trade options on equities. Build `rules.json` from scratch using the fields described below.

If this is a fresh install with no existing `rules.json`, create one manually. The required fields are:

- `watchlist` — array of symbols you trade (e.g. `["AAPL", "NVDA", "SPY", "QQQ", "IWM", "DIA"]`)
- `bias_criteria` — bullish/bearish/neutral conditions based on your indicators
- `risk_rules` — account size, position sizing, max concurrent positions
- `asset_config` — per-ticker option premium ranges and contract count

Tell the user: "Open `rules.json` and fill in your watchlist, bias criteria (what makes something bullish/bearish for you), and risk rules. This is what the morning brief uses every day."

## Step 3: Configure environment variables (optional services)

The MCP server works without this step. You only need `.env` if you want:
- **Neon Postgres persistence** — trade log, signals, and premarket sessions stored in the cloud
- **Schwab screenshot analyzer** — drag-and-drop trade screenshots to pre-fill the LOG TRADE form
- **Vigía email alerts** — `watcher.js` notifies you by email (optional; works without it)

```bash
cp .env.example .env
```

Open `.env` and fill in:

```
DATABASE_URL=postgresql://neondb_owner:CHANGE_ME@ep-XXXX.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

- **`DATABASE_URL`**: from your Neon project → Dashboard → Connection string (console.neon.tech)
- **`ANTHROPIC_API_KEY`**: from [console.anthropic.com](https://console.anthropic.com/settings/keys) — needed for the Schwab screenshot analyzer only
- **`NODEMAILER_HOST` / `NODEMAILER_USER` / `NODEMAILER_PASS` / `NODEMAILER_TO`** (optional): SMTP credentials so `watcher.js` can email alerts. Requires `npm install nodemailer`. Without these, the vigía still runs, just without email.

> Supabase is legacy — the project migrated to Neon Postgres. `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are no longer read by the server.

To start the Schwab analyzer service (keep running alongside the dashboard):

```bash
npm run schwab
# Listening on http://127.0.0.1:9224
```

---

## Step 4: Add to MCP Config

Add the server to the user's Claude Code MCP configuration. The config file is at `~/.claude/.mcp.json` (global) or `.mcp.json` (project-level).

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/tradingview-mcp-jackson/src/server.js"]
    }
  }
}
```

Replace `YOUR_USERNAME` with the user's actual system username. Run `echo $USER` (Mac/Linux) or `echo %USERNAME%` (Windows) to find it.

If the config file already exists and has other servers, merge the `tradingview` entry into the existing `mcpServers` object. Do not overwrite other servers.

## Step 5: Launch TradingView Desktop

TradingView Desktop must be running with Chrome DevTools Protocol enabled.

**Auto-detect and launch (recommended):**
After the MCP server is connected, use the `tv_launch` tool — it auto-detects TradingView on Mac, Windows, and Linux.

**Manual launch by platform:**

Mac:
```bash
/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222
```

Windows:
```bash
%LOCALAPPDATA%\TradingView\TradingView.exe --remote-debugging-port=9222
```

Linux:
```bash
/opt/TradingView/tradingview --remote-debugging-port=9222
# or: tradingview --remote-debugging-port=9222
```

## Step 6: Restart Claude Code

The MCP server only loads when Claude Code starts. After adding the config:

1. Exit Claude Code (Ctrl+C)
2. Relaunch Claude Code
3. The tradingview MCP server should connect automatically

## Step 7: Verify Connection

Use the `tv_health_check` tool. Expected response:

```json
{
  "success": true,
  "cdp_connected": true,
  "chart_symbol": "...",
  "api_available": true
}
```

If `cdp_connected: false`, TradingView is not running with `--remote-debugging-port=9222`.

## Step 8: Run Your First Morning Brief

Ask Claude: *"Run morning_brief and give me my session bias"*

Claude will scan your watchlist, read your indicators, apply your `rules.json` criteria, and print your bias for each symbol.

To save it: *"Save this brief using session_save"*

To retrieve tomorrow: *"Get yesterday's session using session_get"*

## Step 9: Install CLI (Optional)

To use the `tv` CLI command globally:

```bash
cd ~/tradingview-mcp-jackson
npm link
```

Then `tv status`, `tv quote`, `tv pine compile`, etc. work from anywhere.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `cdp_connected: false` | Launch TradingView with `--remote-debugging-port=9222` |
| `ECONNREFUSED` | TradingView isn't running or port 9222 is blocked |
| MCP server not showing in Claude Code | Check `~/.claude/.mcp.json` syntax, restart Claude Code |
| `tv` command not found | Run `npm link` from the project directory |
| Tools return stale data | TradingView may still be loading — wait a few seconds |
| Pine Editor tools fail | Open the Pine Editor panel first (`ui_open_panel pine-editor open`) |
| Schwab analyzer — connection refused | Run `npm run schwab` in a separate terminal before using the dashboard |
| Schwab analyzer — HTTP 500 | `ANTHROPIC_API_KEY` missing or invalid in `.env` |

## What to Read Next

- `rules.json` — Your personal trading rules (fill this in before using morning_brief)
- `CLAUDE.md` — Decision tree for which tool to use when (auto-loaded by Claude Code)
- `README.md` — Full tool reference including morning brief workflow
- `RESEARCH.md` — Research context and open questions
