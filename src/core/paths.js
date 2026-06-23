/**
 * Shared path/date helpers for writing into the TRADINGVIEW work repo
 * (ANALISIS-PREMERCADO weekly folders). Used by morning.js (premarket report)
 * and supabase.js (local trade backup) — kept here so neither module has to
 * import from the other.
 */
import { join } from "node:path";

export const TV_DIR = "D:\\Projects\\TRADINGVIEW";
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
