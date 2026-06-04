import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/premarket.js";

export function registerPremarketTools(server) {
  server.tool(
    "premarket_load",
    "Read today's (or a given date's) pre-market analysis TXT file and return the parsed fields as structured JSON. Call this at the start of 'evalúame de hoy' to get the user's forecast without needing file-system access.",
    {
      date: z
        .string()
        .optional()
        .describe('Date in M-D-YY format (e.g. "6-4-26"). Defaults to today.'),
    },
    async ({ date } = {}) => {
      try {
        return jsonResult(core.loadPremarket({ date }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "premarket_score_save",
    "Save the evaluation result for the day to PROGRESO.txt. Call this at the END of 'evalúame de hoy' after calculating the score. Replaces the entry if the date already exists.",
    {
      date: z
        .string()
        .optional()
        .describe('Date in M-D-YY format. Defaults to today.'),
      score: z
        .number()
        .describe("Total score out of 10, e.g. 8.5"),
      dir_gap: z
        .string()
        .describe('DIR_GAP result, e.g. "4/4"'),
      vol_pre: z
        .string()
        .describe('VOL_PRE result, e.g. "1/2"'),
      niv: z
        .string()
        .describe('Levels result, e.g. "1.5/2"'),
      ctx: z
        .string()
        .describe('Context general result, e.g. "2/2"'),
      strength: z
        .string()
        .describe("Short description of what the user did well today"),
      area: z
        .string()
        .describe("Short description of the main area to improve"),
      criteria_version: z
        .string()
        .optional()
        .describe('Scoring criteria version, e.g. "v2". Defaults to "v2".'),
    },
    async ({ date, score, dir_gap, vol_pre, niv, ctx, strength, area, criteria_version } = {}) => {
      try {
        return jsonResult(
          core.saveScore({ date, score, dir_gap, vol_pre, niv, ctx, strength, area, criteria_version }),
        );
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );
}
