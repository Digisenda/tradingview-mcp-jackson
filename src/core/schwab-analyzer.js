/**
 * schwab-analyzer.js — Servidor HTTP local para analizar capturas de Schwab con Claude Vision.
 *
 * Puerto: 9224 (localhost only)
 * Endpoints:
 *   GET  /ping     → health check
 *   POST /analyze  → { image_base64, media_type } → { success, fields }
 *
 * Estructura de fields según status:
 *   "open"      → solo BOT visible  (entry sin exit)
 *   "closed"    → BOT + SOLD visibles (posición completa con result_pct calculado)
 *   "exit_only" → solo SOLD visible  (para vincular a posición abierta existente)
 *
 * Uso: npm run schwab
 * Requiere ANTHROPIC_API_KEY en el entorno o en .env
 */

import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Cargar .env si existe ────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "../../.env");
try {
  const lines = readFileSync(ENV_PATH, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // .env opcional
}

const PORT = 9224;
const API_KEY = process.env.ANTHROPIC_API_KEY;

// ─── Tool schema (fuerza JSON estructurado — más robusto que pedir JSON en el prompt) ────
const EXTRACT_TOOL = {
  name: "extract_schwab_trade",
  description: "Extrae los campos de la operación de opciones de la captura del historial de Charles Schwab. Llama esta función siempre que veas transacciones BOT/SOLD/BUY/SELL de opciones.",
  input_schema: {
    type: "object",
    properties: {
      ticker:        { type: "string",  description: "Símbolo del subyacente (NVDA, AAPL, SPY...)" },
      side:          { type: "string",  enum: ["CALL", "PUT"] },
      strike:        { type: "number",  description: "Precio de ejercicio de la opción" },
      expiration:    { type: "string",  description: "Fecha de expiración YYYY-MM-DD" },
      contracts:     { type: "integer", description: "Número de contratos (siempre positivo)" },
      status:        { type: "string",  enum: ["open", "closed", "exit_only"] },
      entry_date:    { type: ["string", "null"], description: "Fecha entrada YYYY-MM-DD. null si solo hay SOLD." },
      premium_entry: { type: ["number", "null"], description: "Prima de compra (BOT/@precio). null si solo hay SOLD." },
      exit_date:     { type: ["string", "null"], description: "Fecha salida YYYY-MM-DD. null si solo hay BOT." },
      premium_exit:  { type: ["number", "null"], description: "Prima de venta (SOLD/@precio). null si solo hay BOT." },
      result_pct:    { type: ["number", "null"], description: "((premium_exit - premium_entry) / premium_entry * 100). null si no hay ambas primas." },
      mode:          { type: "string",  description: "Siempre 'real' para capturas de Schwab real." },
    },
    required: ["ticker", "side", "strike", "expiration", "contracts", "status", "mode"],
  },
};

const ANALYSIS_PROMPT = `Eres un extractor de datos del historial de operaciones de Charles Schwab (opciones).

Analiza la imagen y llama a extract_schwab_trade con los datos que encuentres.

REGLAS CRÍTICAS:
1. BOT/BUY con número POSITIVO (+18) = COMPRA = entry. premium_entry = precio después del "@". entry_date = fecha de esa fila.
2. SOLD/SELL con número NEGATIVO (-18) = VENTA = exit. premium_exit = precio después del "@". exit_date = fecha de esa fila.
3. Contratos = valor ABSOLUTO del prefijo: "+18" o "-18" → 18.
4. Fechas: "05/21/26" → "2026-05-21".
5. status: BOT+SOLD del mismo contrato → "closed" | solo BOT → "open" | solo SOLD → "exit_only".
6. result_pct SOLO si status="closed": ((premium_exit - premium_entry) / premium_entry * 100), 2 decimales.`;

// ─── Claude Vision — extraer campos de captura Schwab (tool_use) ──────────────
async function analyzeWithClaude(imageBase64, mediaType) {
  if (!API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada en el entorno");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "extract_schwab_trade" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            { type: "text", text: ANALYSIS_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();

  // Con tool_use, el resultado está en content[].input del tool_use block
  const toolBlock = data.content?.find((b) => b.type === "tool_use" && b.name === "extract_schwab_trade");
  if (!toolBlock) {
    const fallbackText = data.content?.find((b) => b.type === "text")?.text || JSON.stringify(data).slice(0, 200);
    throw new Error(`Claude no detectó una captura de Schwab válida. ${fallbackText.slice(0, 150)}`);
  }

  const fields = toolBlock.input;

  // Corrección server-side: recalcular result_pct por seguridad
  if (fields.status === "closed" && fields.premium_entry != null && fields.premium_exit != null) {
    const calculated = ((fields.premium_exit - fields.premium_entry) / fields.premium_entry) * 100;
    fields.result_pct = Math.round(calculated * 100) / 100;
  }

  // Contratos siempre positivo
  if (fields.contracts != null) fields.contracts = Math.abs(fields.contracts);

  // mode default
  if (!fields.mode) fields.mode = "real";

  return fields;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // GET /ping — health check
  if (req.method === "GET" && req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, port: PORT, key_configured: !!API_KEY }));
    return;
  }

  // POST /analyze — analizar imagen
  if (req.method === "POST" && req.url === "/analyze") {
    if (!API_KEY) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "ANTHROPIC_API_KEY no configurada. Agrégala al .env" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { image_base64, media_type = "image/png" } = JSON.parse(body);
        if (!image_base64) throw new Error("image_base64 requerido");

        console.log(`[schwab] Analizando imagen (${media_type})...`);
        const fields = await analyzeWithClaude(image_base64, media_type);
        console.log(`[schwab] → status=${fields.status} | ${fields.ticker} ${fields.side} ${fields.strike} | entry=${fields.premium_entry} exit=${fields.premium_exit} result=${fields.result_pct}%`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, fields }));
      } catch (err) {
        console.error("[schwab] Error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("📷  Schwab Analyzer listo");
  console.log(`    http://127.0.0.1:${PORT}`);
  console.log(`    API key: ${API_KEY ? "✓ configurada" : "✗ falta ANTHROPIC_API_KEY"}`);
  console.log("");
  console.log("    Dashboard → arrastra captura → Analizar");
  console.log("    Ctrl+C para detener");
  console.log("");
});
