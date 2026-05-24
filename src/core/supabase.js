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

// ─── Trades ───────────────────────────────────────────────────────────────────

/**
 * Inserta un trade en la tabla trades.
 * @param {object} trade  Campos del schema: ticker, strategy, side, etc.
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
 * Obtiene los últimos N trades para retroalimentación al inicio de sesión.
 * @param {number} limit
 * @returns {{ trades: Array, error?: string }}
 */
export async function getRecentTrades(limit = 10) {
  const sb = getClient();
  if (!sb) return { trades: [], reason: "supabase_not_configured" };

  try {
    const { data, error } = await sb
      .from("trades")
      .select("date, ticker, strategy, side, result_pct, mode, notes")
      .order("date", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { trades: data };
  } catch (err) {
    return { trades: [], error: err.message };
  }
}
