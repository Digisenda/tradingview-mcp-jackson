/**
 * Premarket evaluation I/O — reads the daily TXT analysis file and
 * writes scoring results to PROGRESO.txt.
 * No TradingView calls here; all market data logic lives in Claude.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TV_DIR } from "./paths.js";

const PROGRESO_PATH = join(TV_DIR, "PROGRESO.txt");

// ─── Filename helpers ─────────────────────────────────────────────────────────

/** Build filename from a Date: "premercado M-D-YY.txt" */
function buildFilename(date) {
  const d = date instanceof Date ? date : new Date();
  const yy = String(d.getFullYear()).slice(2);
  return `premercado ${d.getMonth() + 1}-${d.getDate()}-${yy}.txt`;
}

/** Parse "M-D-YY" string into a Date (local). Returns today if falsy. */
function parseDate(dateStr) {
  if (!dateStr) return new Date();
  const parts = dateStr.split("-");
  if (parts.length !== 3) throw new Error(`Formato de fecha inválido: "${dateStr}". Usa M-D-YY (ej. 6-4-26).`);
  const [m, d, yy] = parts.map(Number);
  return new Date(2000 + yy, m - 1, d);
}

/** Format a Date as "DD/MM/YYYY" for PROGRESO.txt entries. */
function formatDisplayDate(date) {
  const d = date instanceof Date ? date : new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a v2 premercado TXT line for a single ticker.
 * Expected: "QQQ | DIR_GAP: bajista | VOL_PRE: baja | PISO: 751.54 | TECHO: N/A | ENTRADA: ..."
 * Also handles legacy v1 format: "QQQ | DIR: bajista | VOL: baja | PISO: ..."
 */
function parseTicker(line) {
  const parts = line.split("|").map((s) => s.trim());
  if (parts.length < 2) return null;

  const ticker = parts[0].toUpperCase();
  const fields = {};

  for (const part of parts.slice(1)) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const key = part.slice(0, colon).trim().toUpperCase().replace(/\s+/g, "_");
    const val = part.slice(colon + 1).trim();
    fields[key] = val;
  }

  // Support both v2 (DIR_GAP/VOL_PRE/ENTRADA) and v1 (DIR/VOL/ESTRATEGIA)
  return {
    ticker,
    dir_gap:   fields["DIR_GAP"]   || fields["DIR"]        || null,
    vol_pre:   fields["VOL_PRE"]   || fields["VOL"]        || null,
    piso:      fields["PISO"]                              || null,
    techo:     fields["TECHO"]                             || null,
    entrada:   fields["ENTRADA"]   || fields["ESTRATEGIA"] || null,
  };
}

/**
 * Parse the full TXT file content into a structured object.
 */
function parseContent(raw) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const result = {
    success: true,
    date: null,
    alcance: "gap de apertura + primera vela (9:30-9:45 ET)",
    context_dir: null,
    context_reason: null,
    tickers: [],
    notes: null,
    format_version: "v1",
  };

  for (const line of lines) {
    // PRE-MERCADO DD/MM/YYYY
    if (line.startsWith("PRE-MERCADO")) {
      result.date = line.replace("PRE-MERCADO", "").trim();
      continue;
    }

    // ALCANCE: ...
    if (line.startsWith("ALCANCE:")) {
      result.alcance = line.slice("ALCANCE:".length).trim();
      result.format_version = "v2";
      continue;
    }

    // CONTEXTO GENERAL: dir — reason
    if (line.startsWith("CONTEXTO GENERAL:")) {
      const rest = line.slice("CONTEXTO GENERAL:".length).trim();
      const dashIdx = rest.indexOf("—");
      if (dashIdx !== -1) {
        result.context_dir    = rest.slice(0, dashIdx).trim();
        result.context_reason = rest.slice(dashIdx + 1).trim();
      } else {
        result.context_dir = rest;
      }
      continue;
    }

    // NOTAS: ...
    if (line.startsWith("NOTAS:")) {
      result.notes = line.slice("NOTAS:".length).trim();
      if (result.notes === "N/A" || result.notes === "[opcional]") result.notes = null;
      continue;
    }

    // Ticker lines contain "|" and at least one of: DIR_GAP, DIR, PISO
    if (line.includes("|") && (
      line.includes("DIR") || line.includes("PISO")
    )) {
      const ticker = parseTicker(line);
      if (ticker && ticker.ticker.length <= 8) {
        if (ticker.format_version !== "v1" && line.includes("DIR_GAP")) {
          result.format_version = "v2";
        }
        result.tickers.push(ticker);
      }
    }
  }

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read and parse today's (or a specified) premercado TXT file.
 * @param {{ date?: string }} opts  date in "M-D-YY" format, defaults to today
 */
export function loadPremarket({ date } = {}) {
  const parsed = parseDate(date);
  const filename = buildFilename(parsed);
  const filepath = join(TV_DIR, filename);

  if (!existsSync(filepath)) {
    return {
      success: false,
      error: `Archivo no encontrado: ${filepath}`,
      hint: `Genera el análisis de hoy con premarket_dashboard.hta antes de evaluar.`,
      expected_path: filepath,
    };
  }

  const raw = readFileSync(filepath, "utf8");
  const result = parseContent(raw);
  result.file_path = filepath;
  return result;
}

/**
 * Append (or replace) a scoring result line in PROGRESO.txt.
 */
export function saveScore({
  date,
  score,
  dir_gap,
  vol_pre,
  niv,
  ctx,
  strength,
  area,
  criteria_version = "v2",
} = {}) {
  const parsed = parseDate(date);
  const displayDate = formatDisplayDate(parsed);

  const line =
    `${displayDate} | ${score}/10 | DIR_GAP: ${dir_gap} | VOL_PRE: ${vol_pre}` +
    ` | NIV: ${niv} | CTX: ${ctx}` +
    ` | [${criteria_version}] Fortaleza: ${strength} | Área: ${area}`;

  if (!existsSync(PROGRESO_PATH)) {
    throw new Error(`PROGRESO.txt no encontrado en ${PROGRESO_PATH}`);
  }

  let content = readFileSync(PROGRESO_PATH, "utf8");
  const lines = content.split(/\r?\n/);

  // Replace existing entry for this date if present
  const prefix = `${displayDate} |`;
  const existingIdx = lines.findIndex((l) => l.startsWith(prefix));

  if (existingIdx !== -1) {
    lines[existingIdx] = line;
    content = lines.join("\n");
  } else {
    // Insert after the separator line that follows the header block
    const sepIdx = lines.findIndex((l) => l.startsWith("─────") && lines[lines.indexOf(l) - 1]?.trim() === "");
    const insertAfter = sepIdx !== -1 ? sepIdx : 4;
    lines.splice(insertAfter + 1, 0, line);
    content = lines.join("\n");
  }

  writeFileSync(PROGRESO_PATH, content, "utf8");

  return { success: true, path: PROGRESO_PATH, line, date: displayDate };
}
