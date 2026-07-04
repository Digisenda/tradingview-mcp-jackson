# TradingView MCP Jackson

If you found this from the YouTube video — welcome. This is the improved fork. Everything you need is below.

Built on top of the original [tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) by [@tradesdontlie](https://github.com/tradesdontlie). Full credit to them for the foundation. This fork adds a morning brief workflow, a rules config, and fixes the launch bug on TradingView Desktop v2.14+.

> [!WARNING]
> **Not affiliated with TradingView Inc. or Anthropic.** This tool connects to your locally running TradingView Desktop app via Chrome DevTools Protocol. Review the [Disclaimer](#disclaimer) before use.

> [!IMPORTANT]
> **Requires a valid TradingView subscription.** This tool does not bypass any TradingView paywall. It reads from and controls the TradingView Desktop app already running on your machine.

> [!NOTE]
> **All data processing happens locally.** Nothing is sent anywhere. No TradingView data leaves your machine.

---

## What's New in This Fork

| Feature | What it does |
|---------|-------------|
| `morning_brief` | One command that scans your watchlist across D1/H1/M15, reads BB + SMAs, and returns structured data + strategy candidates for Claude to apply the full 7-step premarket checklist |
| `session_save` / `session_get` | Saves your daily brief to `~/.tradingview-mcp/sessions/` so you can compare today vs yesterday |
| `rules.json` | Write your trading rules once — watchlist, bias criteria, risk rules, strategies (STRAT-01 to 13), FED calendar, earnings dates. Applied automatically every day |
| Fundamental filters | `morning_brief` auto-checks FED events (±2 business days) and earnings (±7 days) per ticker via `rules.json`. Warns before the analysis if any filter is active |
| HTML dashboard | `premarket_save` generates a static `.html` dashboard alongside the `.md` report — opens in browser with one click. Shows ticker cards, BB levels, strategy badges, live ET clock, and a BID/ASK calculator (MID / STOP −15% / TARGET +12%) |
| Schwab screenshot analyzer | `npm run schwab` starts a local server (port 9224). Drag a Charles Schwab trade history screenshot onto the dashboard → Claude Haiku reads the BOT/SOLD fields and pre-fills the LOG TRADE form automatically |
| Neon Postgres persistence | Trade log, signals, and premarket sessions stored in Neon Postgres. Open positions panel in the dashboard shows live entries and auto-fills close form when you upload the exit screenshot |
| Signal-first architecture | Each premarket analysis generates `signal_code` records (e.g. `20260525-NVDA-CALL-STRAT08`). Trades reference signals, closing the loop between morning analysis and execution |
| Launch bug fix | Fixed `tv_launch` compatibility with TradingView Desktop v2.14+ |
| `tv brief` CLI | Run your morning brief from the terminal in one word |

> **Digisenda fork additions (Fases 3–6):** fundamental filters, HTML dashboard, Neon Postgres trade log, and Schwab screenshot analyzer are specific to this fork — not in the upstream LewisWJackson repo.

---

## One-Shot Setup

Paste this into Claude Code and it will handle everything:

```
Set up TradingView MCP Jackson for me. 
Clone https://github.com/Digisenda/tradingview-mcp-jackson.git to ~/tradingview-mcp-jackson, run npm install, then add it to my MCP config at ~/.claude/.mcp.json (merge with any existing servers, don't overwrite them). 
The config block is: { "mcpServers": { "tradingview": { "command": "node", "args": ["/Users/YOUR_USERNAME/tradingview-mcp-jackson/src/server.js"] } } } — replace YOUR_USERNAME with my actual username.
Then copy rules.example.json to rules.json and open it so I can fill in my trading rules.
Finally restart and verify with tv_health_check.
```

Or follow the manual steps below.

---

## Prerequisites

- **TradingView Desktop app** (paid subscription required for real-time data)
- **Node.js 18+**
- **Claude Code** (for MCP tools) or any terminal (for CLI)
- **macOS, Windows, or Linux**

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/Digisenda/tradingview-mcp-jackson.git ~/tradingview-mcp-jackson
cd ~/tradingview-mcp-jackson
npm install
```

### 2. Set up your rules

```bash
cp rules.example.json rules.json
```

Open `rules.json` and fill in:
- Your **watchlist** (symbols to scan each morning)
- Your **bias criteria** (what makes something bullish/bearish/neutral for you)
- Your **risk rules** (the rules you want Claude to check before every session)

### 3. Launch TradingView with CDP

TradingView must be running with the debug port enabled.

**Mac:**
```bash
./scripts/launch_tv_debug_mac.sh
```

**Windows:**
```bash
scripts\launch_tv_debug.bat
```

**Linux:**
```bash
./scripts/launch_tv_debug_linux.sh
```

Or use the MCP tool after setup: `"Use tv_launch to start TradingView in debug mode"`

### 4. Add to Claude Code

Add to `~/.claude/.mcp.json` (merge with any existing servers):

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

Replace `YOUR_USERNAME` with your actual username. On Mac: `echo $USER` to check.

### 5. Verify

Restart Claude Code, then ask: *"Use tv_health_check to verify TradingView is connected"*

### 6. Run your first morning brief

Ask Claude: *"Run morning_brief and give me my session bias"*

Or from the terminal:
```bash
npm link  # install tv CLI globally (one time)
tv brief
```

---

## Morning Brief Workflow

This is the feature that turns this from a toolkit into a daily habit.

**Before every session:**

1. TradingView is open (launched with debug port)
2. Run: `tv brief` in your terminal (or ask Claude: *"run morning_brief"*)
3. Claude scans every symbol in your watchlist, reads your indicator values, applies your `rules.json` criteria, and prints:

```
BTCUSD  | BIAS: Bearish  | KEY LEVEL: 94,200  | WATCH: RSI crossing 50 on 4H
ETHUSD  | BIAS: Neutral  | KEY LEVEL: 3,180   | WATCH: Ribbon direction on daily
SOLUSD  | BIAS: Bullish  | KEY LEVEL: 178.50  | WATCH: Hold above 20 EMA

Overall: Cautious session. BTC leading bearish, SOL the exception — watch for divergence.
```

4. Save it: *"save this brief"* (uses `session_save`)
5. Next morning, compare: *"get yesterday's session"* (uses `session_get`)

---

## What This Tool Does

- **Morning brief** — scan watchlist, read indicators, apply your rules, print session bias
- **Pine Script development** — write, inject, compile, debug scripts with AI
- **Chart navigation** — change symbols, timeframes, zoom to dates, add/remove indicators
- **Visual analysis** — read indicator values, price levels, drawn levels from custom indicators
- **Draw on charts** — trend lines, horizontal levels, rectangles, text
- **Manage alerts** — create, list, delete price alerts
- **Replay practice** — step through historical bars, practice entries and exits with P&L tracking
- **Screenshots** — capture chart state
- **Multi-pane layouts** — 2x2, 3x1 grids with different symbols per pane
- **Stream data** — JSONL output from your live chart for monitoring scripts
- **CLI access** — every tool is also a `tv` command, pipe-friendly JSON output

---

## How Claude Knows Which Tool to Use

Claude reads `CLAUDE.md` automatically when working in this project. It contains the full decision tree.

| You say... | Claude uses... |
|------------|---------------|
| "Run my morning brief" | `morning_brief` → apply rules → `session_save` |
| "What was my bias yesterday?" | `session_get` |
| "What's on my chart?" | `chart_get_state` → `data_get_study_values` → `quote_get` |
| "Give me a full analysis" | `quote_get` → `data_get_study_values` → `data_get_pine_lines` → `data_get_pine_labels` → `capture_screenshot` |
| "Switch to BTCUSD daily" | `chart_set_symbol` → `chart_set_timeframe` |
| "Write a Pine Script for..." | `pine_set_source` → `pine_smart_compile` → `pine_get_errors` |
| "Start replay at March 1st" | `replay_start` → `replay_step` → `replay_trade` |
| "Set up a 4-chart grid" | `pane_set_layout` → `pane_set_symbol` |
| "Draw a level at 94200" | `draw_shape` (horizontal_line) |

---

## Tool Reference (91 MCP tools)

### Morning Brief (new in this fork)

| Tool | What it does |
|------|-------------|
| `morning_brief` | Scan watchlist, read indicators, return structured data for session bias. Reads `rules.json` automatically. |
| `session_save` | Save the generated brief to `~/.tradingview-mcp/sessions/YYYY-MM-DD.json` |
| `session_get` | Retrieve today's brief (or yesterday's if today not saved yet) |
| `premarket_load` | Read today's (or a given date's) pre-market analysis `.txt` and return parsed fields as JSON |
| `premarket_save` | Save the full premarket checklist report as markdown + generate the HTML dashboard |
| `premarket_score_save` | Save the day's evaluation score (DIR_GAP, VOL_PRE, levels, context) to `PROGRESO.txt` |

### Chart Reading

| Tool | When to use | Output size |
|------|------------|-------------|
| `chart_get_state` | First call — get symbol, timeframe, all indicator names + IDs | ~500B |
| `data_get_study_values` | Read current RSI, MACD, BB, EMA values from all indicators | ~500B |
| `quote_get` | Get latest price, OHLC, volume | ~200B |
| `data_get_ohlcv` | Get price bars. **Use `summary: true`** for compact stats | 500B (summary) / 8KB (100 bars) |
| `data_get_indicator` | Get an indicator/study's info and current input values | ~300B |
| `chart_get_visible_range` | Get the visible date range and bar count on the chart | ~200B |
| `chart_set_visible_range` | Zoom the chart to a specific unix-timestamp date range | ~100B |
| `symbol_search` | Search for symbols by name or keyword | ~1KB |
| `symbol_info` | Get metadata about the current symbol (name, exchange, type, description) | ~300B |
| `depth_get` | Get order book / DOM (Depth of Market) data from the chart | ~1KB |

### Strategy Tester Data

| Tool | When to use |
|------|------------|
| `data_get_strategy_results` | Read performance metrics (net profit, win rate, drawdown) from Strategy Tester |
| `data_get_trades` | Read the trade list from Strategy Tester |
| `data_get_equity` | Read the equity curve from Strategy Tester |

### Custom Indicator Data (Pine Drawings)

Read `line.new()`, `label.new()`, `table.new()`, `box.new()` output from any visible Pine indicator.

| Tool | When to use |
|------|------------|
| `data_get_pine_lines` | Horizontal price levels (support/resistance, session levels) |
| `data_get_pine_labels` | Text annotations + prices ("PDH 24550", "Bias Long") |
| `data_get_pine_tables` | Data tables (session stats, analytics dashboards) |
| `data_get_pine_boxes` | Price zones as {high, low} pairs |

**Always use `study_filter`** to target a specific indicator: `study_filter: "MyIndicator"`.

### Chart Control

| Tool | What it does |
|------|-------------|
| `chart_set_symbol` | Change ticker (BTCUSD, AAPL, ES1!, NYMEX:CL1!) |
| `chart_set_timeframe` | Change resolution (1, 5, 15, 60, D, W, M) |
| `chart_set_type` | Change style (Candles, HeikinAshi, Line, Area, Renko) |
| `chart_manage_indicator` | Add/remove indicators. **Use full names**: "Relative Strength Index" not "RSI" |
| `chart_scroll_to_date` | Jump to a date (ISO: "2025-01-15") |
| `indicator_set_inputs` / `indicator_toggle_visibility` | Change indicator settings, show/hide |

### Pine Script Development

| Tool | Step |
|------|------|
| `pine_set_source` | 1. Inject code into editor |
| `pine_smart_compile` | 2. Compile with auto-detection + error check |
| `pine_get_errors` | 3. Read compilation errors if any |
| `pine_get_console` | 4. Read log.info() output |
| `pine_save` | 5. Save to TradingView cloud |
| `pine_analyze` | Offline static analysis (no chart needed) |
| `pine_check` | Server-side compile check (no chart needed) |
| `pine_get_source` | Read current Pine Script source from the editor (WARNING: can be 200KB+) |
| `pine_compile` | Compile/add the current script to the chart |
| `pine_new` | Create a new blank indicator/strategy/library |
| `pine_open` | Open a saved Pine Script by name |
| `pine_list_scripts` | List your saved Pine Scripts |

### Replay Mode

| Tool | Step |
|------|------|
| `replay_start` | Enter replay at a date |
| `replay_step` | Advance one bar |
| `replay_autoplay` | Auto-advance (set speed in ms) |
| `replay_trade` | Buy/sell/close positions |
| `replay_status` | Check position, P&L, date |
| `replay_stop` | Return to realtime |

### Multi-Pane, Alerts, Drawings, UI

| Tool | What it does |
|------|-------------|
| `pane_set_layout` | Change grid: `s`, `2h`, `2v`, `2x2`, `4`, `6`, `8` |
| `pane_set_symbol` | Set symbol on any pane |
| `pane_list` | List all panes in the current layout with their symbols and active state |
| `pane_focus` | Focus a specific pane by index (0-based) |
| `draw_shape` | Draw horizontal_line, trend_line, rectangle, text |
| `alert_create` / `alert_list` / `alert_delete` | Manage price alerts |
| `batch_run` | Run action across multiple symbols/timeframes |
| `watchlist_get` / `watchlist_add` | Read/modify watchlist |
| `capture_screenshot` | Screenshot (regions: full, chart, strategy_tester) |
| `tv_launch` / `tv_health_check` | Launch TradingView and verify connection |
| `tv_discover` | Report which known TradingView API paths are available on this build |
| `tv_ui_state` | Get current UI state — which panels are open, which buttons are visible/enabled |

### Drawing Management

| Tool | What it does |
|------|-------------|
| `draw_list` | List all shapes/drawings currently on the chart |
| `draw_clear` | Remove all drawings from the chart |
| `draw_remove_one` | Remove one drawing by entity ID |
| `draw_get_properties` | Get properties and points of a specific drawing |
| `drawn_lines_save` | Save the entity IDs of lines Claude drew this session, so next session can clean them up without touching your manual drawings |
| `drawn_lines_clear` | Delete only the lines Claude drew in the previous session (never touches manual drawings) |

### Layouts & Tabs

| Tool | What it does |
|------|-------------|
| `layout_list` | List your saved chart layouts |
| `layout_switch` | Switch to a saved layout by name or ID |
| `tab_list` | List all open chart tabs |
| `tab_new` | Open a new chart tab |
| `tab_close` | Close the current chart tab |
| `tab_switch` | Switch to a tab by index |

### Trade Log & Feedback

| Tool | What it does |
|------|-------------|
| `trade_save` | Save a closed trade to Neon Postgres (plus a local JSONL backup) for statistical feedback |
| `trades_get` | Read recent trades back — used at checklist start to review past performance |

### UI Automation

Lower-level fallbacks for when a dedicated tool doesn't cover what you need — e.g. clicking a button that has no wrapper yet.

| Tool | What it does |
|------|-------------|
| `ui_click` | Click an element by aria-label, `data-name`, text content, or class substring |
| `ui_open_panel` | Open, close, or toggle a TradingView panel (pine-editor, strategy-tester, watchlist, alerts, trading) |
| `ui_fullscreen` | Toggle TradingView fullscreen mode |
| `ui_hover` | Hover over an element by aria-label, `data-name`, or text content |
| `ui_keyboard` | Press keys or shortcuts (Enter, Escape, Alt+S, Ctrl+Z, ...) |
| `ui_type_text` | Type text into the currently focused input/textarea |
| `ui_scroll` | Scroll the chart or page up/down/left/right |
| `ui_mouse_click` | Click at specific x,y coordinates on the TradingView window |
| `ui_find_element` | Find elements by text, aria-label, or CSS selector and return their positions |
| `ui_evaluate` | Execute arbitrary JavaScript in the TradingView page context (advanced/escape hatch) |

### Screener (No TradingView Desktop Required)

Runs against Yahoo Finance data instead of the live chart — useful for pre-session scans before Desktop is open. D1/H1 support 2+ years of history; M15 is limited to ~60 days.

| Tool | What it does |
|------|-------------|
| `screener_get_indicators` | Get BB, SMAs, trendlines and indicator values for one symbol |
| `screener_scan_multi` | Screen multiple tickers for strategy candidates at once |
| `screener_run_backtest` | Run a historical backtest for a symbol + strategy |

---

## CLI Commands

```bash
tv brief                           # run morning brief
tv session get                     # get today's saved brief
tv session save --brief "..."      # save a brief

tv status                          # check connection
tv quote                           # current price
tv symbol BTCUSD                   # change symbol
tv ohlcv --summary                 # price summary
tv screenshot -r chart             # capture chart
tv pine compile                    # compile Pine Script
tv pane layout 2x2                 # 4-chart grid
tv stream quote | jq '.close'      # monitor price ticks
```

Full command list: `tv --help`

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `cdp_connected: false` | TradingView isn't running with `--remote-debugging-port=9222`. Use the launch script. |
| `ECONNREFUSED` | TradingView isn't running or port 9222 is blocked |
| MCP server not showing in Claude Code | Check `~/.claude/.mcp.json` syntax, restart Claude Code |
| `tv` command not found | Run `npm link` from the project directory |
| `morning_brief` — "No rules.json found" | Run `cp rules.example.json rules.json` and fill it in |
| `morning_brief` — watchlist empty | Add symbols to the `watchlist` array in `rules.json` |
| Tools return stale data | TradingView still loading — wait a few seconds |
| Pine Editor tools fail | Open Pine Editor panel first: `ui_open_panel pine-editor open` |
| Schwab analyzer — port 9224 refused | Run `npm run schwab` in a separate terminal; keep it running while using the dashboard |
| Schwab analyzer — HTTP 500 on analyze | Check `ANTHROPIC_API_KEY` in `.env`; upload a Schwab trade history screenshot (not a chart) |
| Dashboard LOG TRADE form — ticker missing | Handled automatically: unknown tickers are added to the dropdown dynamically |

---

## Architecture

```
Claude Code  ←→  MCP Server (stdio)  ←→  CDP (port 9222)  ←→  TradingView Desktop (Electron)
```

- **91 MCP tools total**
- **Transport**: MCP over stdio + CLI (`tv` command)
- **Connection**: Chrome DevTools Protocol on localhost:9222
- **Schwab analyzer**: optional local service on port 9224 — calls Anthropic API (`npm run schwab`)
- **Neon Postgres**: optional cloud persistence for trades, signals, and premarket sessions (`.env` required)

---

## Credits

This fork is built on [tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) by [@tradesdontlie](https://github.com/tradesdontlie). The original tool is the foundation — go star their repo.

---

## Disclaimer

This project is provided **for personal, educational, and research purposes only**.

This tool uses the Chrome DevTools Protocol (CDP), a standard debugging interface built into all Chromium-based applications. It does not reverse engineer any proprietary TradingView protocol, connect to TradingView's servers, or bypass any access controls. The debug port must be explicitly enabled by the user via a standard Chromium command-line flag.

By using this software you agree that:

1. You are solely responsible for ensuring your use complies with [TradingView's Terms of Use](https://www.tradingview.com/policies/) and all applicable laws.
2. This tool accesses undocumented internal TradingView APIs that may change at any time.
3. This tool must not be used to redistribute, resell, or commercially exploit TradingView's market data.
4. The authors are not responsible for any account bans, suspensions, or other consequences.

**Use at your own risk.**

## License

MIT — see [LICENSE](LICENSE). Applies to source code only, not to TradingView's software, data, or trademarks.
