import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/morning.js";

export function registerMorningTools(server) {
  server.tool(
    "morning_brief",
    "Scan your watchlist across D1, H1 and M15 timeframes. Returns BB values, SMA order, bb_width (volatility filter) and strategy_candidates per ticker. Claude applies the 7-step premarket checklist to generate the session brief.",
    {
      rules_path: z
        .string()
        .optional()
        .describe(
          "Optional path to rules.json. Defaults to rules.json in the project root.",
        ),
    },
    async ({ rules_path } = {}) => {
      try {
        return jsonResult(await core.runBrief({ rules_path }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "premarket_save",
    "Save the full premarket checklist report as a markdown file in docs/sessions/premarket-YYYY-MM-DD.md inside the project repo. Pass brief_data (JSON string from morning_brief output) to also generate an HTML dashboard.",
    {
      content: z
        .string()
        .describe("Full markdown content of the premarket checklist report."),
      date: z
        .string()
        .optional()
        .describe("Date string YYYY-MM-DD. Defaults to today."),
      brief_data: z
        .string()
        .optional()
        .describe(
          "JSON string of the morning_brief structured output (symbols_scanned + fundamental_filters). When provided, also generates an HTML dashboard at premarket-YYYY-MM-DD.html.",
        ),
    },
    async ({ content, date, brief_data } = {}) => {
      try {
        return jsonResult(await core.savePremarketReport({ content, date, brief_data }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "session_save",
    "Save today's morning brief to ~/.tradingview-mcp/sessions/YYYY-MM-DD.json for future reference.",
    {
      brief: z
        .string()
        .describe(
          "The brief text to save (output from morning_brief after Claude applies the rules).",
        ),
      date: z
        .string()
        .optional()
        .describe("Date string YYYY-MM-DD. Defaults to today."),
    },
    async ({ brief, date } = {}) => {
      try {
        return jsonResult(core.saveSession({ brief, date }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "session_get",
    "Retrieve a saved session brief. Returns today's if available, otherwise yesterday's.",
    {
      date: z
        .string()
        .optional()
        .describe("Date string YYYY-MM-DD. Defaults to today."),
    },
    async ({ date } = {}) => {
      try {
        return jsonResult(core.getSession({ date }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "trade_save",
    "Save a trade to Supabase, and always to a local JSONL backup in ANALISIS-PREMERCADO\\semana-YYYY-MM-DD\\ (so the trade is never lost if Supabase/Neon is down). Call after closing a position to record the result for statistical feedback.",
    {
      ticker:        z.string().describe("Ticker symbol, e.g. AAPL"),
      strategy:      z.string().describe("Strategy ID, e.g. STRAT-02"),
      side:          z.enum(["CALL","PUT"]),
      mode:          z.enum(["real","paper"]),
      strike:        z.number().optional(),
      expiration:    z.string().optional().describe("YYYY-MM-DD"),
      premium_entry: z.number().optional(),
      premium_exit:  z.number().optional(),
      contracts:     z.number().int().default(1),
      result_pct:    z.number().optional().describe("e.g. 12.0 for +12%, -25.0 for -25%"),
      bb_d1_width:   z.number().optional(),
      bb_h1_width:   z.number().optional(),
      bb_m15_width:  z.number().optional(),
      gap_direction: z.enum(["up","down","flat"]).optional(),
      notes:         z.string().optional(),
      date:          z.string().optional().describe("YYYY-MM-DD, defaults to today"),
    },
    async (args) => {
      try {
        const { saveTrade } = await import("../core/supabase.js");
        const dateStr = args.date || new Date().toISOString().split("T")[0];
        return jsonResult(await saveTrade({ ...args, date: dateStr }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "trades_get",
    "Get recent trades from Supabase for statistical feedback. Call at the start of the checklist to review past performance.",
    {
      limit: z.number().int().default(10).describe("Number of recent trades to return"),
    },
    async ({ limit = 10 } = {}) => {
      try {
        const { getRecentTrades } = await import("../core/supabase.js");
        return jsonResult(await getRecentTrades(limit));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "drawn_lines_save",
    "Save entity IDs of all lines drawn by Claude during the checklist. Call once at the END of the checklist with all entity IDs created. These will be automatically deleted at the start of the next session, preserving manual user drawings.",
    {
      entity_ids: z
        .array(z.string())
        .describe("Array of entity IDs returned by draw_shape during this session."),
    },
    async ({ entity_ids } = {}) => {
      try {
        return jsonResult(core.saveDrawnLines(entity_ids));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "drawn_lines_clear",
    "Delete ONLY the lines drawn by Claude in the previous session (saved by drawn_lines_save). Does NOT touch manual user drawings. Call once at the START of the checklist before drawing new lines.",
    {},
    async () => {
      try {
        return jsonResult(await core.clearDrawnLines());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );
}
