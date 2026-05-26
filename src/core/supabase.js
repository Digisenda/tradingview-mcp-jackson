/**
 * Supabase client + helpers para persistencia de sesiones de trading.
 *
 * Tablas:  premarket_sessions  — reportes diarios (markdown + JSON)
 *          trades              — operaciones ejecutadas
 *          screenshots         — metadata de imágenes
 * Storage: bucket 'screenshots' — archivos PNG
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ─── Cliente ─────────────────────────────────────────────────────────────────

let _client = null;

function getClient() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key || key === "PENDIENTE_VER_INSTRUCCIONES") {
    return null; // Supabase deshabilitado — seguir sin error
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
  });
  return _client;
}

// ─── Premarket sessions ───────────────────────────────────────────────────────

/**
 * Guarda o actualiza el reporte premarket del día en Supabase.
 * @param {string} date        YYYY-MM-DD
 * @param {string} content     Markdown completo del reporte
 * @param {object} briefData   Objeto JS del morning_brief (opcional)
 * @returns {{ saved: boolean, id?: string, error?: string }}
 */
export async function savePremarketSession(date, content, briefData = null) {
  const sb = getClient();
  if (!sb) return { saved: false, reason: "supabase_not_configured" };

  try {
    const { data, error } = await sb
      .from("premarket_sessions")
      .upsert(
        { date, content, brief_data: briefData },
        { onConflict: "date" }
      )
      .select("id")
      .single();

    if (error) throw error;
    return { saved: true, id: data.id };
  } catch (err) {
    return { saved: false, error: err.message };
  }
}

// ─── Screenshots ──────────────────────────────────────────────────────────────

/**
 * Sube un PNG a Supabase Storage y guarda la metadata en la tabla screenshots.
 * @param {object} opts
 * @param {string} opts.date        YYYY-MM-DD
 * @param {string} opts.ticker      Ej: "AAPL"
 * @param {string} opts.filename    Sin extensión — ej: "premarket-2026-05-24-AAPL"
 * @param {string} opts.localPath   Ruta local del PNG a subir
 * @param {number} [opts.sizeBytes] Tamaño en bytes (opcional)
 * @returns {{ saved: boolean, storage_path?: string, error?: string }}
 */
export async function saveScreenshot({ date, ticker, filename, localPath, sizeBytes } = {}) {
  const sb = getClient();
  if (!sb) return { saved: false, reason: "supabase_not_configured" };

  const storagePath = `${date}/${filename}.png`;

  try {
    // 1. Subir imagen al bucket
    const fileBuffer = readFileSync(localPath);
    const { error: uploadError } = await sb.storage
      .from("screenshots")
      .upload(storagePath, fileBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // 2. Guardar metadata en tabla
    const { error: dbError } = await sb
      .from("screenshots")
      .upsert(
        { date, ticker, filename: `${filename}.png`, storage_path: storagePath, size_bytes: sizeBytes },
        { onConflict: "storage_path" }
      );

    if (dbError) throw dbError;

    return { saved: true, storage_path: storagePath };
  } catch (err) {
    return { saved: false, error: err.message };
  }
}

// ─── Signals ──────────────────────────────────────────────────────────────────

/**
 * Guarda una o varias señales propuestas por Claude.
 * Usa upsert para evitar duplicados si el premarket se regenera.
 * @param {Array<object>} signals  Lista de señales
 * @returns {{ saved: boolean, count: number, error?: string }}
 */
export async function saveSignals(signals = []) {
  const sb = getClient();
  if (!sb || !signals.length) return { saved: false, reason: "supabase_not_configured_or_empty" };

  try {
    const { error } = await sb
      .from("signals")
      .upsert(signals, { onConflict: "signal_code" });

    if (error) throw error;
    return { saved: true, count: signals.length };
  } catch (err) {
    return { saved: false, error: err.message };
  }
}

/**
 * Obtiene las señales de una fecha concreta (para el dashboard y el checklist).
 * @param {string} date  YYYY-MM-DD
 * @returns {{ signals: Array, error?: string }}
 */
export async function getSignalsForDate(date) {
  const sb = getClient();
  if (!sb) return { signals: [], reason: "supabase_not_configured" };

  try {
    const { data, error } = await sb
      .from("signals")
      .select("signal_code, ticker, strategy, side, confidence, note, source")
      .eq("date", date)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return { signals: data };
  } catch (err) {
    return { signals: [], error: err.message };
  }
}

// ─── Trades ───────────────────────────────────────────────────────────────────

/**
 * Inserta un trade en la tabla trades.
 * Acepta campos nuevos: signal_id, status, entry_date, exit_date.
 * @param {object} trade
 * @returns {{ saved: boolean, id?: string, error?: string }}
 */
export async function saveTrade(trade = {}) {
  const sb = getClient();
  if (!sb) return { saved: false, reason: "supabase_not_configured" };

  try {
    const { data, error } = await sb
      .from("trades")
      .insert(trade)
      .select("id")
      .single();

    if (error) throw error;
    return { saved: true, id: data.id };
  } catch (err) {
    return { saved: false, error: err.message };
  }
}

/**
 * Cierra una posición abierta: actualiza premium_exit, exit_date, result_pct, status.
 * @param {string} tradeId   UUID del trade a actualizar
 * @param {object} exitData  { premium_exit, exit_date, result_pct }
 * @returns {{ updated: boolean, error?: string }}
 */
export async function closeTrade(tradeId, exitData = {}) {
  const sb = getClient();
  if (!sb) return { updated: false, reason: "supabase_not_configured" };

  try {
    const { error } = await sb
      .from("trades")
      .update({ ...exitData, status: "closed" })
      .eq("id", tradeId);

    if (error) throw error;
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
  const sb = getClient();
  if (!sb) return { trades: [], reason: "supabase_not_configured" };

  try {
    const { data, error } = await sb
      .from("trades")
      .select("id, date, entry_date, ticker, strategy, side, strike, expiration, premium_entry, contracts, mode, signal_code, notes")
      .eq("status", "open")
      .order("entry_date", { ascending: false });

    if (error) throw error;
    return { trades: data };
  } catch (err) {
    return { trades: [], error: err.message };
  }
}

/**
 * Obtiene los últimos N trades cerrados para retroalimentación.
 * @param {number} limit
 * @returns {{ trades: Array, error?: string }}
 */
export async function getRecentTrades(limit = 10) {
  const sb = getClient();
  if (!sb) return { trades: [], reason: "supabase_not_configured" };

  try {
    const { data, error } = await sb
      .from("trades")
      .select("date, entry_date, exit_date, ticker, strategy, side, result_pct, mode, status, notes")
      .or("status.eq.closed,status.is.null")   // incluye trades legacy sin status (NULL IN (...) = NULL en SQL, no TRUE)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { trades: data };
  } catch (err) {
    return { trades: [], error: err.message };
  }
}
