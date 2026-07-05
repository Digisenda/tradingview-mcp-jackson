/**
 * Shared path/date helpers for writing into the TRADINGVIEW work repo
 * (ANALISIS-PREMERCADO weekly folders). Used by morning.js (premarket report)
 * and supabase.js (local trade backup) — kept here so neither module has to
 * import from the other.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

/**
 * TV_WORK_DIR overrides everything (set by setup.sh when registering the MCP).
 * Otherwise probe the conventional locations before falling back to
 * ~/TRADINGVIEW, so a fresh machine still gets a sane default.
 */
function resolveTvDir() {
  if (process.env.TV_WORK_DIR) return process.env.TV_WORK_DIR;
  const candidates = ["D:\\Projects\\TRADINGVIEW", join(homedir(), "TRADINGVIEW")];
  return candidates.find(existsSync) ?? candidates[candidates.length - 1];
}

export const TV_DIR = resolveTvDir();
export const ANALISIS_PREMERCADO_DIR = join(TV_DIR, "ANALISIS-PREMERCADO");

/** Monday (ISO week start) for a "YYYY-MM-DD" date string, as "YYYY-MM-DD". */
export function mondayOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sunday ... 6=Saturday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split("T")[0];
}

/** Absolute path to the ANALISIS-PREMERCADO weekly folder for a given date. */
export function weekDirFor(dateStr) {
  return join(ANALISIS_PREMERCADO_DIR, `semana-${mondayOfWeek(dateStr)}`);
}
