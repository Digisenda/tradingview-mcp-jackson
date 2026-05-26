/**
 * schwab-analyzer.js — Servidor HTTP local para analizar capturas de Schwab con Claude Vision.
 *
 * Puerto: 9224 (localhost only)
 * Endpoints:
 *   GET  /ping     → health check
 *   POST /analyze  → { image_base64, media_type } → { success, fields }
 *
 * Uso: npm run schwab
 *
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
  // .env opcional — seguir sin él
}

const PORT = 9224;
const API_KEY = process.env.ANTHROPIC_API_KEY;

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
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            {
              type: "text",
              text: `Analiza esta captura de pantalla de Charles Schwab (plataforma de opciones).
Extrae los datos de la operación y retorna SOLO un objeto JSON con estos campos exactos:
{
  "ticker": "símbolo del activo subyacente (ej: AAPL, SPY, NVDA, QQQ)",
  "side": "CALL o PUT (en mayúsculas)",
  "strike": número del precio strike (solo el número, ej: 195.0),
  "expiration": "fecha de expiración en formato YYYY-MM-DD",
  "premium_entry": precio de compra/fill de la prima (número decimal, ej: 1.45),
  "premium_exit": precio de venta/cierre si aparece en pantalla (número o null),
  "contracts": número de contratos como entero (ej: 1),
  "mode": "real"
}
Reglas:
- Si no puedes extraer un campo con certeza, usa null.
- Retorna SOLO el JSON sin explicación, sin markdown, sin texto adicional.
- El ticker es el símbolo del subyacente, no de la opción.`,
            },
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
  return JSON.parse(match[0]);
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS — permitir requests desde file:// y localhost
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

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
      res.end(JSON.stringify({ success: false, error: "ANTHROPIC_API_KEY no configurada. Agrégala a tu .env o variable de entorno." }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { image_base64, media_type = "image/png" } = JSON.parse(body);
        if (!image_base64) throw new Error("image_base64 requerido");

        console.log(`[schwab-analyzer] Analizando imagen (${media_type}) con Claude Haiku...`);
        const fields = await analyzeWithClaude(image_base64, media_type);
        console.log("[schwab-analyzer] Campos extraídos:", JSON.stringify(fields));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, fields }));
      } catch (err) {
        console.error("[schwab-analyzer] Error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("📷  Schwab Analyzer listo");
  console.log(`    http://127.0.0.1:${PORT}`);
  console.log(`    API key: ${API_KEY ? "✓ configurada" : "✗ falta ANTHROPIC_API_KEY"}`);
  console.log("");
  console.log("    Abre el dashboard premarket → arrastra captura de Schwab → Analizar");
  console.log("    Ctrl+C para detener");
  console.log("");
});
