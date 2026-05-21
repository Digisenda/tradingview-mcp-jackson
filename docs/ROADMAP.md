# Roadmap de Desarrollo — TradingView MCP
**Reconstruido:** 2026-05-20  
**Fuentes:** `docs/DEPURACION MORNING_BRIEF.md`, `docs/pinecone-rag-integration/PLAN.md`, git log

---

## FASE 1 — Unificación morning_brief + checklist ✅ COMPLETADA

> Commit: `12fc071` — 2026-05-20 09:13 AM

### Etapa 1 — morning_brief multi-timeframe
- `src/core/morning.js`: scan D1, H1, M15 por ticker
- Helpers: `extractBB()`, `extractSMAs()`, `bbPosition()`, `maOrder()`
- `screenStrategies()` — screening STRAT-01 a 11
- Output: `bb.width`, `bb_position`, `ma_order`, `strategy_candidates`
- `savePremarketReport()` — guarda en `docs/sessions/`

### Etapa 2 — Triggers unificados en CLAUDE.md
- Tabla de modos: Rápido ("morning brief") / Completo ("checklist")
- Regla crítica: BB es indicador primario, sin volatilidad no hay operaciones
- Flujo completo 7 pasos documentado con output esperado por ticker

### Etapa 3 — Persistencia
- `docs/sessions/` agregado a `.gitignore`
- Tool `premarket_save` operativo

---

## FASE 2 — Verificación end-to-end ✅ COMPLETADA

> Sesión: 2026-05-20 (hoy)

- BB 20-2-0 confirmado visible en chart para todos los tickers
- SMAs 20/40/100/200 confirmados y verificados (MA20 = BB basis en todos los tickers)
- Checklist premarket completo ejecutado: AAPL / NVDA / SPY / QQQ / IWM / DIA
- Draw de niveles (BB D1, BB H1, H1 Máx/Mín) operativo en los 6 tickers
- Screenshots guardados en `screenshots/`
- Reporte guardado en `docs/sessions/premarket-2026-05-20.md`

---

## FASE 3 — Análisis Fundamental Automatizado ✅ COMPLETADA

> Fuente: `docs/DEPURACION MORNING_BRIEF.md` — ítem 4

### Objetivo
Conectar con una fuente de datos externa para eliminar la verificación manual de filtros globales (FED y Earnings) que hoy se hace "verificar manualmente".

### Alcance
- **FED calendar:** detectar automáticamente si hay evento Fed ±2 días hábiles
- **Earnings calendar:** detectar si algún ticker del watchlist tiene earnings ±7 días
- Integrar este check en `morning_brief` como campo `fundamental_filters`
- Si hay filtro activo → reportar en el output con advertencia visible

### Opciones de implementación (a decidir)
| Opción | Fuente | Esfuerzo |
|--------|--------|---------|
| A | Finviz web scraping (mencionado en DEPURACION doc) | Medio |
| B | API pública de earnings (Alphavantage, Polygon.io) | Bajo-Medio |
| C | ICS calendar feed (FED publica calendarios) | Bajo |

### Output esperado en morning_brief
```json
"fundamental_filters": {
  "fed_event": { "active": false, "next": "2026-06-11", "days_away": 22 },
  "earnings": {
    "AAPL": { "active": false, "next": "2026-07-28", "days_away": 69 },
    "NVDA": { "active": false, "next": "2026-05-28", "days_away": 8 }
  }
}
```

### Checklist de implementación
- [ ] Decidir fuente de datos (Finviz / API / ICS)
- [ ] Implementar `src/core/fundamental.js` con `checkFedCalendar()` y `checkEarnings()`
- [ ] Integrar en `morning_brief` como preflight check
- [ ] Agregar bloque `## Filtros Globales` al reporte `premarket_save`
- [ ] Probar con ticker que tenga earnings próximos

---

## FASE 4 — Dashboard HTML Estático ✅ COMPLETADA

> Fuente: `docs/DEPURACION MORNING_BRIEF.md` — ítem 5  
> Diseño aprobado: 2026-05-20. Referencia revisada: `github.com/Digisenda/dashboard-trading` (descartado por complejidad excesiva).

### Decisión de diseño

**Archivo HTML estático** generado automáticamente por `morning_brief` junto al `.md`.  
Sin backend, sin Docker, sin auth. Se abre directo en el browser con un clic.

**Descartado:** El proyecto `dashboard-trading` (React + FastAPI + PostgreSQL + Docker) es demasiado complejo para el objetivo — pantalla de operación de un vistazo.  
**Rescatado de ese proyecto:** estilo dark + Tailwind CDN, calculadora BID/ASK del `Checklist.jsx`.

### Layout aprobado — una sola pantalla, 3 zonas

```
┌─────────────────────────────────────────────────────────┐
│  SESIÓN: 09:31 ET  ●  ABIERTA  │  FED: OK  │ EARN: OK  │
│  ⭐ SETUP ACTIVO: IWM STRAT-03 PUT — techo $279.28      │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│  AAPL    │  NVDA    │   SPY    │   QQQ    │   IWM  ★    │
│  $299.82 │  $224.68 │  $738.05 │  $708.56 │  $277.85    │
│  ALCISTA │  ALCISTA │  ALCISTA │  ALCISTA │  BAJISTA    │
│  BB D1 ↑ │  BB D1 ↑ │  BB D1 ↑ │  BB D1 ↑ │  BB D1 ↓   │
│  $285.61 │  $213.46 │  $728.13 │  $688.84 │  $279.28    │
│  STRAT02 │  STRAT02 │  STRAT02 │  STRAT02 │  STRAT03 ★  │
├──────────┴──────────┴──────────┴──────────┴─────────────┤
│  DIA — ⚠️ NO OPERAR (BB width demasiado estrecho)        │
├─────────────────────────────────────────────────────────┤
│  [ Calculadora BID/ASK — MID / Stop / Target ]          │
└─────────────────────────────────────────────────────────┘
```

### Especificaciones técnicas

| Aspecto | Decisión |
|---------|---------|
| Tecnología | HTML + CSS inline (Tailwind CDN) — sin build step |
| Generación | `savePremarketReport()` genera `.md` + `.html` en `docs/sessions/` |
| Apertura | Link en el reporte `.md` o tool `premarket_open` (por definir) |
| Datos | Lee del output de `morning_brief` — reutiliza `fundamental_filters` |
| Calculadora | BID/ASK pura JS (sin API) — rescatada de `dashboard-trading/Checklist.jsx` |
| Prioridad visual | `conditions_met` siempre al tope en banner destacado |
| Regla sin vol. | DIA o ticker con BB estrecho → banner "NO OPERAR" antes del grid |

### Implementación — 2026-05-21

- [x] `generateHtml(briefData, date)` en `src/core/morning.js`
- [x] HTML template con Tailwind CDN, dark theme, layout de 3 zonas
- [x] Banner superior: hora ET + estado sesión + filtros FED/Earnings (JS reloj en vivo)
- [x] Banner naranja si hay `conditions_met` activo
- [x] Grid de 6 cards (una por ticker) con bias, BB levels D1/H1, M15 width, setup candidates
- [x] Card con borde naranja para tickers con setup activo
- [x] Calculadora BID/ASK (MID, STOP -25%, TARGET +12%, inversión total)
- [x] `savePremarketReport()` acepta `brief_data` (JSON string) y genera `.html` junto al `.md`
- [x] `premarket_save` tool expone parámetro `brief_data`
- [x] Dashboard generado y verificado: `docs/sessions/premarket-2026-05-21.html` (15 KB)

---

## FASE 5 — Pinecone RAG Integration ⏳ PENDIENTE

> Fuente: `docs/pinecone-rag-integration/PLAN.md` (plan completo aquí)

### Objetivo
Conectar el RAG de Pinecone (contexto cualitativo del sistema de opciones) con el flujo premarket para recuperar orientación situacional dinámica durante el análisis.

### Opción elegida
**Opción 1 — Pinecone MCP Server** (`@pinecone-database/mcp`)  
Agregar a `~/.claude/.mcp.json` junto al servidor TradingView.

### Inserción en el flujo
Nuevo **PASO 5.5** entre trendlines (PASO 5) y Bid/Ask (PASO 6):
```
query: "{ticker} | BB D1: {techo/piso} | H1: {alcista/bajista} | 
        Precio vs MA20: {sobre/bajo} | Candidatas: {STRAT-XX}"
pinecone.query(top_k=3) → contexto cualitativo al reporte
```

### Preguntas pendientes de confirmar con Juan ⚠️
1. ¿El índice Pinecone es **dedicado** a opciones o compartido con el bot?
2. ¿Qué **tipo de contenido** tiene el RAG? (reglas, casos históricos, anotaciones)
3. ¿Cuál es la **estructura de los embeddings**? (por frase, por estrategia, por sesión)
4. ¿Qué **modelo de embeddings** usa?

### Checklist de implementación
- [ ] Confirmar respuestas a las 4 preguntas
- [ ] Verificar disponibilidad: `npx @pinecone-database/mcp --help`
- [ ] Configurar credenciales en `.env`
- [ ] Agregar servidor a `~/.claude/.mcp.json`
- [ ] Probar query básico al índice
- [ ] Agregar PASO 5.5 en `CLAUDE.md`
- [ ] Ejecutar checklist completo con RAG activo
- [ ] Evaluar calidad del contexto y ajustar query

---

## Resumen de Estado

| Fase | Descripción | Estado |
|------|-------------|--------|
| 1 | Unificación morning_brief + checklist (Etapas 1-3) | ✅ Completada |
| 2 | Verificación end-to-end (BB + SMAs + checklist completo) | ✅ Completada |
| 3 | Análisis Fundamental Automatizado (Finviz / FED / Earnings) | ✅ Completada |
| 4 | Dashboard HTML estático (generado por morning_brief) | ✅ Completada — 2026-05-21 |
| 5 | Pinecone RAG Integration | ⏳ Pendiente — 4 preguntas previas |

**Próxima sesión:** implementar Fase 4 (HTML dashboard). Fase 5 (Pinecone RAG) requiere 4 preguntas confirmadas — ver `docs/pinecone-rag-integration/PLAN.md`.
