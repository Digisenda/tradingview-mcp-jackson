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

// ─── Prompt para Claude Haiku Vision ─────────────────────────────────────────
const ANALYSIS_PROMPT = `Eres un extractor de datos de capturas de pantalla del historial de operaciones de Charles Schwab (opciones).

La pantalla puede mostrar 1 o 2 transacciones del mismo contrato de opción:
- "BOT" o "BUY" con número POSITIVO (+18) = COMPRA = entrada de la posición
- "SOLD" o "SELL" con número NEGATIVO (-18) = VENTA = cierre de la posición

REGLAS CRÍTICAS — léelas despacio:
1. BOT/BUY → SIEMPRE es "premium_entry". SOLD/SELL → SIEMPRE es "premium_exit". NUNCA al revés.
2. El número de contratos es el valor ABSOLUTO del prefijo: "+18" o "-18" → 18 contratos.
3. La prima está después del "@": "@1.80" → 1.80, "@.02" → 0.02.
4. Si ves BOT + SOLD del mismo strike y expiración → status="closed". Calcula result_pct=((premium_exit - premium_entry) / premium_entry * 100) redondeado a 2 decimales.
5. Si solo ves BOT → status="open". premium_exit=null, exit_date=null, result_pct=null.
6. Si solo ves SOLD → status="exit_only". premium_entry=null, entry_date=null, result_pct=null.
7. Las fechas: "05/21/26" → "2026-05-21". La fecha del BOT es entry_date, la del SOLD es exit_date.
8. El ticker es el símbolo del subyacente (NVDA, AAPL, SPY...), no el símbolo de la opción.

Retorna SOLO este JSON exacto (sin markdown, sin explicación, sin texto adicional):
{
  "ticker": "símbolo del subyacente",
  "side": "CALL o PUT",
  "strike": número,
  "expiration": "YYYY-MM-DD",
  "contracts": número entero positivo,
  "status": "open | closed | exit_only",
  "entry_date": "YYYY-MM-DD o null",
  "premium_entry": número o null,
  "exit_date": "YYYY-MM-DD o null",
  "premium_exit": número o null,
  "result_pct": número o null,
  "mode": "real"
}`;

// ─── Claude Vision — extraer campos de captura Schwab ─────────────────────────
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
    throw new Error(`Claude API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Respuesta inesperada de Claude: ${text.slice(0, 200)}`);

  const fields = JSON.parse(match[0]);

  // Validación y corrección del server-side
  // Si Claude calculó result_pct mal o no lo calculó, lo recalculamos
  if (fields.status === "closed" && fields.premium_entry != null && fields.premium_exit != null) {
    const calculated = ((fields.premium_exit - fields.premium_entry) / fields.premium_entry) * 100;
    fields.result_pct = Math.round(calculated * 100) / 100;
  }

  // Contratos siempre positivo
  if (fields.contracts != null) fields.contracts = Math.abs(fields.contracts);

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
