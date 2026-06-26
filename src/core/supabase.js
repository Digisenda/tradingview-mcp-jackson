/**
 * Neon Postgres helpers — persistencia de sesiones de trading.
 *
 * Tablas:  premarket_sessions  — reportes diarios (markdown + JSON)
 *          trades              — operaciones ejecutadas
 *          screenshots         — metadata de imágenes (archivo en disco local)
 *          signals             — señales propuestas por Claude
 *
 * Driver: @neondatabase/serverless — neon() tagged template (HTTP, sin pooling).
 * Cada query es un HTTP round-trip; suficiente para ~30 queries/día.
 */
import { neon } from "@neondatabase/serverless";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { weekDirFor, mondayOfWeek } from "./paths.js";

// ─── Cliente ─────────────────────────────────────────────────────────────────

let _sql = null;

function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

// ─── Premarket sessions ───────────────────────────────────────────────────────

/**
 * Guarda o actualiza el reporte premarket del día en Neon.
 * @param {string} date        YYYY-MM-DD
 * @param {string} content     Markdown completo del reporte
 * @param {object} briefData   Objeto JS del morning_brief (opcional)
 * @returns {{ saved: boolean, id?: string, error?: string }}
 */
export async function savePremarketSession(date, content, briefData = null) {
  const sql = getSql();
  if (!sql) return { saved: false, reason: "db_not_configured" };

  try {
    const briefJson = briefData != null ? JSON.stringify(briefData) : null;
    const rows = await sql`
      INSERT INTO premarket_sessions (date, content, brief_data)
      VALUES (${date}, ${content}, ${briefJson}::jsonb)
      ON CONFLICT (date) DO UPDATE
        SET content    = EXCLUDED.content,
            brief_data = EXCLUDED.brief_data
      RETURNING id
    `;
    return { saved: true, id: rows[0]?.id ?? null };
  } catch (err) {
    return { saved: false, error: err.message };
  }
}

// ─── Screenshots ──────────────────────────────────────────────────────────────

/**
 * Guarda metadata de un screenshot en Neon.
 * El archivo PNG vive en screenshots/ local — no hay upload a Storage (D2).
 * @param {object} opts
 * @param {string} opts.date        YYYY-MM-DD
 * @param {string} opts.ticker      Ej: "AAPL"
 * @param {string} opts.filename    Sin extensión — ej: "premarket-2026-05-24-AAPL"
 * @param {string} opts.localPath   Ruta local (no se usa, se mantiene por compatibilidad)
 * @param {number} [opts.sizeBytes] Tamaño en bytes
 * @returns {{ saved: boolean, storage_path?: string, error?: string }}
 */
export async function saveScreenshot({ date, ticker, filename, localPath, sizeBytes } = {}) {
  const sql = getSql();
  if (!sql) return { saved: false, reason: "db_not_configured" };

  const storagePath = `${date}/${filename}.png`;

  try {
    await sql`
      INSERT INTO screenshots (date, ticker, filename, storage_path, size_bytes)
      VALUES (${date}, ${ticker}, ${filename + ".png"}, ${storagePath}, ${sizeBytes ?? null})
      ON CONFLICT (storage_path) DO UPDATE
        SET size_bytes = EXCLUDED.size_bytes
    `;
    return { saved: true, storage_path: storagePath };
  } catch (err) {
    return { saved: false, error: err.message };
  }
}

// ─── Signals ──────────────────────────────────────────────────────────────────

/**
 * Guarda una o varias señales propuestas por Claude.
 * Batch INSERT — un solo round-trip HTTP, atómico (OV-2).
 * @param {Array<object>} signals  Lista de señales
 * @returns {{ saved: boolean, count: number, error?: string }}
 */
export async function saveSignals(signals = []) {
  const sql = getSql();
  if (!sql || !signals.length) return { saved: false, reason: "db_not_configured_or_empty" };

  try {
    const cols = ["signal_code", "date", "ticker", "strategy", "side", "confidence", "note", "source"];
    const nCols = cols.length;
    const placeholders = signals
      .map((_, i) => `(${cols.map((__, j) => `$${i * nCols + j + 1}`).join(", ")})`)
      .join(", ");
    const values = signals.flatMap(s => [
      s.signal_code,
      s.date ?? null,
      s.ticker ?? null,
      s.strategy ?? null,
      s.side ?? null,
      s.confidence ?? null,
      s.note ?? null,
      s.source ?? null,
    ]);

    await sql(
      `INSERT INTO signals (${cols.join(", ")}) VALUES ${placeholders}
       ON CONFLICT (signal_code) DO UPDATE
         SET confidence = EXCLUDED.confidence,
             note       = EXCLUDED.note,
             source     = EXCLUDED.source`,
      values
    );
    return { saved: true, count: signals.length };
  } catch (err) {
    return { saved: false, error: err.message };
  }
}

/**
 * Obtiene las señales de una fecha concreta.
 * @param {string} date  YYYY-MM-DD
 * @returns {{ signals: Array, error?: string }}
 */
export async function getSignalsForDate(date) {
  const sql = getSql();
  if (!sql) return { signals: [], reason: "db_not_configured" };

  try {
    const rows = await sql`
      SELECT signal_code, ticker, strategy, side, confidence, note, source
      FROM signals
      WHERE date = ${date}
      ORDER BY created_at ASC
    `;
    return { signals: rows };
  } catch (err) {
    return { signals: [], error: err.message };
  }
}

// ─── Trades ───────────────────────────────────────────────────────────────────

/**
 * Respaldo local del trade en ANALISIS-PREMERCADO\semana-YYYY-MM-DD\trades-semana-YYYY-MM-DD.jsonl
 * Corre SIEMPRE antes de intentar la BD, independiente de si esa llamada tiene éxito.
 */
function appendTradeBackup(trade) {
  try {
    const dateStr = trade.date || new Date().toISOString().split("T")[0];
    const dir = weekDirFor(dateStr);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `trades-semana-${mondayOfWeek(dateStr)}.jsonl`);
    appendFileSync(file, JSON.stringify({ ...trade, backed_up_at: new Date().toISOString() }) + "\n", "utf8");
    return { backed_up: true, path: file };
  } catch (err) {
    return { backed_up: false, error: err.message };
  }
}

/**
 * Inserta un trade en trades. Siempre escribe el respaldo local primero.
 * ON CONFLICT (date, ticker, strategy, entry_date) DO NOTHING — entry_date es NULL
 * en trades nuevos, así que el constraint rara vez dispara aquí (NULL != NULL en índices
 * UNIQUE de Postgres). El constraint protege principalmente contra duplicados con entry_date
 * conocida (vía closeTrade).
 * @param {object} trade
 * @returns {{ saved: boolean, id?: string, error?: string, local_backup: object }}
 */
export async function saveTrade(trade = {}) {
  const local_backup = appendTradeBackup(trade);

  const sql = getSql();
  if (!sql) return { saved: false, reason: "db_not_configured", local_backup };

  try {
    const rows = await sql`
      INSERT INTO trades (
        date, ticker, strategy, side, mode,
        strike, expiration, premium_entry, premium_exit, contracts,
        result_pct, bb_d1_width, bb_h1_width, bb_m15_width,
        gap_direction, notes
      ) VALUES (
        ${trade.date}, ${trade.ticker}, ${trade.strategy}, ${trade.side}, ${trade.mode},
        ${trade.strike ?? null}, ${trade.expiration ?? null},
        ${trade.premium_entry ?? null}, ${trade.premium_exit ?? null},
        ${trade.contracts ?? 1},
        ${trade.result_pct ?? null}, ${trade.bb_d1_width ?? null},
        ${trade.bb_h1_width ?? null}, ${trade.bb_m15_width ?? null},
        ${trade.gap_direction ?? null}, ${trade.notes ?? null}
      )
      ON CONFLICT (date, ticker, strategy, entry_date) DO NOTHING
      RETURNING id
    `;
    // rows es [] cuando ON CONFLICT DO NOTHING dispara — id:null es intencional
    return { saved: true, id: rows[0]?.id ?? null, local_backup };
  } catch (err) {
    return { saved: false, error: err.message, local_backup };
  }
}

/**
 * Cierra una posición abierta: actualiza premium_exit, exit_date, result_pct, status.
 * @param {string} tradeId   UUID del trade a actualizar
 * @param {object} exitData  { premium_exit, exit_date, result_pct }
 * @returns {{ updated: boolean, error?: string }}
 */
export async function closeTrade(tradeId, exitData = {}) {
  const sql = getSql();
  if (!sql) return { updated: false, reason: "db_not_configured" };

  try {
    await sql`
      UPDATE trades
      SET status       = 'closed',
          premium_exit = ${exitData.premium_exit ?? null},
          exit_date    = ${exitData.exit_date ?? null},
          result_pct   = ${exitData.result_pct ?? null}
      WHERE id = ${tradeId}
    `;
    return { updated: true };
  } catch (err) {
    return { updated: false, error: err.message };
  }
}

/**
 * Obtiene las posiciones abiertas (status='open') para el dashboard.
 * @returns {{ trades: Array, error?: string }}
 */
export async function getOpenPositions() {
  const sql = getSql();
  if (!sql) return { trades: [], reason: "db_not_configured" };

  try {
    const rows = await sql`
      SELECT id, date, entry_date, ticker, strategy, side, strike,
             expiration, premium_entry, contracts, mode, signal_code, notes
      FROM trades
      WHERE status = 'open'
      ORDER BY entry_date DESC
    `;
    return { trades: rows };
  } catch (err) {
    return { trades: [], error: err.message };
  }
}

/**
 * Obtiene los últimos N trades cerrados para retroalimentación.
 * WHERE status = 'closed' OR status IS NULL — incluye trades legacy sin status.
 * (IN con NULL nunca matchea en SQL; se usa OR IS NULL explícito.)
 * @param {number} limit
 * @returns {{ trades: Array, error?: string }}
 */
export async function getRecentTrades(limit = 10) {
  const sql = getSql();
  if (!sql) return { trades: [], reason: "db_not_configured" };

  try {
    const rows = await sql`
      SELECT date, entry_date, exit_date, ticker, strategy, side,
             result_pct, mode, status, notes
      FROM trades
      WHERE status = 'closed' OR status IS NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return { trades: rows };
  } catch (err) {
    return { trades: [], error: err.message };
  }
}
