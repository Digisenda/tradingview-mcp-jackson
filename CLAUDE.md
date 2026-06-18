# TradingView MCP — Claude Instructions

68 tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Decision Tree — Which Tool When

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)

### "Work on Pine Script"
1. `pine_set_source` → inject code into editor
2. `pine_smart_compile` → compile with auto-detection + error check
3. `pine_get_errors` → read compilation errors
4. `pine_get_console` → read log.info() output
5. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
6. `pine_save` → save to TradingView cloud
7. `pine_new` → create blank indicator/strategy/library
8. `pine_open` → load a saved script by name

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` → see what's drawn
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage alerts"
- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → take a screenshot (regions: "full", "chart", "strategy_tester")

### "TradingView isn't running"
- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_health_check` → verify connection is working

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Flujo Premarket Unificado

### Regla crítica — BB es el indicador primario

> **Sin volatilidad no hay operaciones.** Si `bb.width` es muy estrecho en D1, H1 y M15 simultáneamente → NO operar ese día. Las MAs son contexto, no disparadores. BB manda sobre MAs.

Pesos del análisis: **BB 50% | MAs 30% | Fundamental 20%** (este último es manual — verificar FED ±2 días y Earnings ±7 días antes de ejecutar cualquier operación).

### Modos de operación

| Trigger | Modo | Qué hace |
|---------|------|----------|
| "morning brief" | **Rápido** | `morning_brief` → bias D1/H1/M15 por ticker + estrategias candidatas. ~2 minutos. |
| "checklist" / "ejecuta checklist premarket" / "analiza apertura" / "análisis premarket" / "prepara el análisis" | **Completo** | `morning_brief` → análisis 7 pasos → dibujar líneas → screenshots → estrategias → guardar reporte. ~15-20 minutos. |
| "movimiento en bloque" / "analiza el bloque" / "identifica el rezagado" | **Bloque** | Workflow Movimientos en Bloque → comparar distancia al nivel objetivo por ticker → dibujar MA objetivo → identificar líder y rezagado. Ver sección "Movimientos en Bloque". |

### Flujo completo (modo Checklist)

```
0. drawn_lines_clear          → elimina SOLO las líneas de Claude del día anterior (no toca líneas manuales)
R. trades_get(10)             → retroalimentación: leer últimos trades antes de analizar (ver sección Retroalimentación)
1. morning_brief              → recolecta datos D1/H1/M15 de todo el watchlist
2. Análisis 7 pasos           → aplicar checklist por ticker usando los datos del paso 1
3. Dibujar niveles            → draw_shape para BB Middle D1, BB Middle H1, Máx/Mín H1
4. Captura                    → capture_screenshot por ticker
5. Estrategias                → evaluar strategy_candidates del morning_brief
6. Guardar reporte            → premarket_save con el análisis completo
7. drawn_lines_save([...ids]) → guarda todos los entity IDs creados en el paso 3
8. Cierre de sesión           → preguntar al usuario si ejecutó operaciones (ver sección Cierre)
```

**IMPORTANTE:** El paso 1 (`morning_brief`) recolecta todos los datos necesarios para los 7 pasos. No hacer llamadas adicionales a `data_get_study_values` por ticker — usar los datos del morning_brief.

**IMPORTANTE drawn_lines:** Nunca usar `draw_clear` en el checklist. Solo `drawn_lines_clear` al inicio y `drawn_lines_save` al final. Recopilar TODOS los entity_ids retornados por `draw_shape` durante el paso 3 para pasarlos a `drawn_lines_save`.

### Checklist Premarket — Flujo Automático

**Trigger:** cuando el usuario escriba cualquiera de estas frases:
- "ejecuta checklist premarket"
- "analiza apertura"
- "checklist"
- "análisis premarket"
- "prepara el análisis"

**Watchlist:** NVDA, TSLA (fuente de verdad: `rules.json` → `watchlist`)

### Indicadores del sistema (los únicos que se usan)
- **Bollinger Bands 20-2-0** → peso 50% del análisis. Indicador primario.
- **SMAs 20 / 40 / 100 / 200** → peso 30% del análisis. Indicador secundario.
- Ambos deben estar visibles en el chart. Si `data_get_study_values` no retorna BB o alguna SMA,
  agregar con `chart_manage_indicator(action:"add", name:"Bollinger Bands")` o
  `chart_manage_indicator(action:"add", name:"Simple Moving Average")` antes de continuar.
- Los valores que retorna `data_get_study_values` para las 4 SMAs se asumen en orden MA20, MA40, MA100, MA200
  (de período más corto a más largo, de mayor a menor valor en tendencia alcista).

### Secuencia por ticker

```
Para cada ticker en [NVDA, TSLA]:

  PASO 0 — Setup
    chart_set_symbol(ticker)
    chart_set_timeframe("D")
    data_get_study_values() → verificar que BB y las 4 SMAs están presentes.
    Si falta alguno → chart_manage_indicator para agregarlo.
    ⚠️ NO llamar draw_clear aquí — las líneas anteriores ya fueron eliminadas por drawn_lines_clear al inicio del checklist.

  PASO 1 — BB Diario: Punto Medio  [peso 50%]
    (ya en D desde PASO 0)
    Nota: BB Middle D = MA20 D — es la misma línea, siempre es lo PRIMERO que se marca.
    data_get_study_values() → leer BB upper, middle, lower
    Evaluar tendencia D con BB:
      - Precio cerca de banda superior alejándose del middle → ALCISTA → middle = PISO
      - Precio cerca de banda inferior alejándose del middle → BAJISTA → middle = TECHO
      - Precio oscilando entre bandas sin dirección → LATERAL
    ⚠️ Solo dibujar si tiene tendencia (alcista o bajista). Si LATERAL → NO dibujar.
    draw_shape(horizontal_line, precio=BB_middle_D) → "BB D [TECHO/PISO]"

  PASO 2 — BB M15: Proyección diagonal en disipadores  [referencia visual apertura]
    chart_set_timeframe("15")
    data_get_ohlcv(count: 3) → leer últimas 3 barras M15 para calcular pendiente de cada banda
    data_get_study_values() → leer BB upper y BB lower actuales en M15

    Calcular pendiente actual de cada banda:
      pendiente_upper = BB_upper_barra_actual - BB_upper_barra_anterior
      pendiente_lower = BB_lower_barra_actual - BB_lower_barra_anterior

    Trazar proyección hacia adelante (desde barra actual → ~10-15 barras futuras):
      punto_inicio_upper = { precio: BB_upper_actual, tiempo: ahora }
      punto_fin_upper    = { precio: BB_upper_actual + (pendiente_upper × 10), tiempo: ahora + 10 barras }
      draw_shape(trend_line, point=punto_inicio_upper, point2=punto_fin_upper, color=blanco)

      punto_inicio_lower = { precio: BB_lower_actual, tiempo: ahora }
      punto_fin_lower    = { precio: BB_lower_actual + (pendiente_lower × 10), tiempo: ahora + 10 barras }
      draw_shape(trend_line, point=punto_inicio_lower, point2=punto_fin_lower, color=blanco)

    ⚠️ Siempre trazar AMBAS bandas (superior e inferior), sin excepción.
    ⚠️ NO trazar BB Middle M15 — solo los disipadores (bandas exteriores).
    ⚠️ Propósito: proyección anticipada de hacia dónde van las bandas.
       Cuando el mercado abre, comparar visualmente la banda REAL vs esta proyección:
         - Banda real sigue la proyección → dirección confirmada → operar en esa dirección
         - Banda real se desvía de la proyección → cambio de volatilidad → esperar / reevaluar

  PASO 3 — BB H + MAs H  [peso 50% BB / 30% MAs]
    chart_set_timeframe("60")
    data_get_study_values() → leer BB H1 (upper, middle, lower) + MA20, MA40, MA100, MA200

    ── BB H: SOLO OBSERVAR — no dibujar ─────────────────────────────────────
    Nota: el usuario trabaja con 2 gráficos separados en H (BB chart y MAs chart).
    Como Claude usa 1 solo chart, combinar ambos análisis en este paso.
    Observar y reportar:
      - ¿Precio dentro o fuera de las bandas? → [dentro / fuera sup / fuera inf]
      - ¿Hasta dónde puede llegar el precio? (next band, middle, opposite band)
      - Posibles escenarios de movimiento en H
    NO dibujar BB Middle H1 — solo análisis visual/reportado.
    ─────────────────────────────────────────────────────────────────────────

    ── MAs H: Trazar según diagrama Investep ────────────────────────────────
    La DIRECCIÓN individual de cada MA determina si es TECHO o PISO:
      MA20 > MA40   → MA20 alcista  |  MA20 < MA40   → MA20 bajista
      MA40 > MA100  → MA40 alcista  |  MA40 < MA100  → MA40 bajista
      MA100 > MA200 → MA100 alcista |  MA100 < MA200 → MA100 bajista

      ✅ MA alcista + precio encima → PISO  → draw_shape horizontal
      ✅ MA bajista + precio debajo → TECHO → draw_shape horizontal
      ❌ MA alcista + precio debajo → Continuación → NO dibujar
      ❌ MA bajista + precio encima → Continuación → NO dibujar

    Dibujar máx. 2 MAs por grupo (las más cercanas al precio actual).
    IMPORTANTE: mientras más separadas las MAs de rebote → más probable el rebote.
    ─────────────────────────────────────────────────────────────────────────

    ── H-Lines: último HIGH arriba y último LOW abajo ────────────────────────
    data_get_ohlcv(count: 100) → barras H1 individuales
    Precio actual = quote_get(ticker).last

    ARRIBA (sobre precio actual):
      → H-Max 1: HIGH más reciente por encima del precio
      → H-Max 2: siguiente HIGH más antiguo por encima del precio
    ABAJO (bajo precio actual):
      → H-Min 1: LOW más reciente por debajo del precio
      → H-Min 2: siguiente LOW más antiguo por debajo del precio

    draw_shape(horizontal_line, precio=H_Max1) → "TICKER Máx 1" (verde)
    draw_shape(horizontal_line, precio=H_Max2) → "TICKER Máx 2" (verde claro)
    draw_shape(horizontal_line, precio=H_Min1) → "TICKER Mín 1" (rojo)
    draw_shape(horizontal_line, precio=H_Min2) → "TICKER Mín 2" (rojo claro)
    ⚠️ Máx 4 H-Lines por ticker. Mientras más antiguo el nivel sin tocarse → mayor rebote.
    ─────────────────────────────────────────────────────────────────────────

  PASO 4 — MAs D: Trazar según diagrama Investep  [peso 30%]
    chart_set_timeframe("D")
    data_get_study_values() → leer MA20, MA40, MA100, MA200 y precio actual

    Aplicar misma regla de dirección individual del PASO 3:
      ✅ MA alcista + precio encima → PISO  → draw_shape horizontal
      ✅ MA bajista + precio debajo → TECHO → draw_shape horizontal
      ❌ MA alcista + precio debajo → Continuación → NO dibujar
      ❌ MA bajista + precio encima → Continuación → NO dibujar

    Escenarios típicos:
      Alcista puro (precio > MA20 > MA40 > MA100 > MA200) → todas PISOS → dibujar 2 más cercanas
      Bajista puro (MA200 > MA100 > MA40 > MA20 > precio) → todas TECHOS → dibujar 2 más cercanas
      Mixto → clasificar cada MA individualmente y dibujar las que califican

    ⚠️ Si MAs que marcan tendencia se SEPARAN más → tendencia fortaleciéndose
       (ej. bajista: precio rompe MA20 y llega a MA40 = intento de subida para seguir bajando).
    ⚠️ Dibujar máx. 2 MAs por grupo (las más cercanas al precio actual).

  PASO 5 — Líneas de tendencia
    (mantener el chart en H1 con BB visible)
    capture_screenshot(region: "chart") → visual para marcar trendlines manualmente
    Reportar: en el gráfico BB H1, marcar línea de tendencia conectando la mayor
    cantidad de máximos (bajista) o mínimos (alcista) posibles.
    Si se busca cambio de tendencia en H1 → la ruptura de esa trendline es el trigger.

  PASO 6 — Bid/Ask
    Reportar: "Verificar spread Bid/Ask y calcular spot/strike manualmente antes
    de entrar. El spread debe estar dentro del rango habitual para este activo."

  PASO 7 — Apertura / Premarket
    quote_get(symbol=ticker) → precio actual
    Reportar: precio actual, dirección estimada de apertura (gap up / gap down / flat)
    Identificar hacia dónde apunta el mercado al abrir.
```

### Reglas de análisis — lógica de rebotes (CRÍTICO)

**Bollinger Bands:**
- BB middle D1/H1 = soporte/resistencia dinámica de mayor peso
- ⚠️ BB middle se marca SOLO si tiene tendencia (alcista o bajista). Si está LATERAL → no se marca.
- Precio dentro de bandas H1 = movimiento normal; fuera de banda = sobreextensión → rebote probable
- BB middle H1 actúa como imán intraday → si precio lo supera con fuerza, confirma dirección

**Medias Móviles — regla por dirección individual (diagrama Investep):**

| Dirección MA | Posición vs precio | Clasificación | Dibujar |
|---|---|---|---|
| Alcista (subiendo) | Debajo del precio | PISO ✅ | Sí |
| Bajista (bajando) | Encima del precio | TECHO ✅ | Sí |
| Alcista (subiendo) | Encima del precio | Continuación ❌ | No |
| Bajista (bajando) | Debajo del precio | Continuación ❌ | No |

- Dirección de cada MA = su valor vs el período siguiente (MA20>MA40 → MA20 alcista, etc.)
- MAs separándose entre sí → tendencia fortaleciéndose → rebote más débil o inexistente
- Dibujar máx. 2 MAs por grupo (las más cercanas al precio actual)

**H-Lines (Máx/Mín en H1):**
- Identificar el HIGH más reciente POR ENCIMA del precio actual → H-Max 1
- Identificar el siguiente HIGH más antiguo por encima → H-Max 2
- Identificar el LOW más reciente POR DEBAJO del precio actual → H-Min 1
- Identificar el siguiente LOW más antiguo por debajo → H-Min 2
- Máximo 4 líneas por ticker (2 arriba + 2 abajo) — no exceder
- ⚠️ Mientras más barras hayan pasado sin que el precio toque ese nivel → MAYOR fuerza de rebote

### Output del checklist — Briefing de Operaciones

**Regla crítica de output:** Durante los pasos 1–4 Claude recolecta datos en silencio.
NO generar texto de análisis por paso. Al terminar los 5 tickers → generar UN SOLO briefing consolidado.

#### Modelo de scoring ponderado

Calcular un score 0–100% por ticker/estrategia usando los pesos de la metodología:

| Bucket | Peso | Cálculo |
|---|---|---|
| Condiciones BB | 50% | (BB_cumplidas + 0.5×BB_pendientes) / BB_total |
| Condiciones MA | 30% | (MA_cumplidas + 0.5×MA_pendientes) / MA_total |
| Otras (vol, timing, fundamental) | 20% | (otras_cumplidas + 0.5×otras_pendientes) / otras_total |
| **Score final** | | BB_score×0.50 + MA_score×0.30 + Otras_score×0.20 |

Leyenda de condiciones:
- ✅ = cumplida (vale 1.0)
- 🔲 = pendiente de apertura — M15, volumen, CT15 (vale 0.5)
- ❌ = no cumplida (vale 0)

**Umbrales de clasificación:**
- 🟢 ≥75% → EJECUTAR AL ABRIR (expandido con checklist completo)
- 🟡 40–74% → VIGILAR (expandido con checklist completo)
- 🔴 <40% → una línea con razón principal

**Veto FED/Earnings:** NO colapsa a 🔴 automático. Muestra el score técnico real más advertencia ⚠️ visible. El operador decide.

**Formato del briefing (copiar exactamente esta estructura):**

```
━━━ PREMARKET YYYY-MM-DD | HH:MM AM ET ━━━━━━━━━━━━━━━━
FED: [OK (próx. DD/MM) / HOY ⚠️]  |  [TICKER ⚠️ EARNINGS DD/MM]

🟢 87% — TSLA  PUT  [Nombre completo de estrategia]
   ✅ [cond BB 1]     ✅ [cond BB 2]     🔲 [cond BB 3 al abrir]
   ✅ [cond MA 1]     ✅ [cond MA 2]
   Prima $X.XX–X.XX  |  -25% / +12%

🟡 62% — NVDA  CALL  [Nombre completo de estrategia]  ⚠️ EARNINGS DD/MM
   ✅ [cond BB 1]     🔲 [cond BB 2]     ❌ [cond BB 3]
   ✅ [cond MA 1]     🔲 [cond MA 2]
   Prima $X.XX–X.XX  |  -25% / +12%
   ⚠ Vigilar: línea BB Middle D1 ($182.40) — alerta manual si rompe hacia arriba

🔴 SPY  → [razón principal en una línea]
🔴 QQQ  → [razón principal en una línea]
🔴 AAPL → [razón principal en una línea]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Reglas de contenido:**
- Nombre completo de la estrategia SIEMPRE (no solo número — la numeración puede cambiar)
- Score % SIEMPRE visible en 🟢 y 🟡
- Mostrar TODAS las condiciones de la estrategia, agrupadas: BB primero, MA después
- ✅ / 🔲 / ❌ por cada condición — sin texto largo, máx 4 palabras por condición
- FED y Earnings = SIEMPRE en el header
- Veto activo = repetir ⚠️ en la línea del ticker además del header
- Prima = rango óptimo según rules.json asset_config para ese ticker
- Target/Stop = siempre visible. Usar +12% / -25% por defecto
- Bid/Ask, Trendlines, valores exactos de MAs → van al dashboard HTML, NO al briefing
- Solo tickers 🟡 llevan la línea "⚠ Vigilar:" (ver sección siguiente). Los 🟢 no la llevan —
  el usuario ya está mirando el chart activamente para ejecutar al abrir.

### Línea de vigilancia — alerta manual sobre nivel dibujado (Fase 5, cerrada 2026-06-17)

**Por qué existe:** un ticker 🟡 tiene condiciones 🔲 pendientes de apertura. Si el usuario se
aleja del chart, hoy no hay forma de que se entere cuando el precio rompe el nivel que
decidiría la entrada. Esta sección resuelve eso usando el gesto nativo de alertas de
TradingView — **no** las tools `alert_create`/`alert_delete` del MCP (ver razón abajo).

**Para cada ticker 🟡**, elegir el nivel crítico con este orden determinístico (mismo peso que
el scoring: BB 50% > MA 30% > otras):
1. BB Middle D1, si se dibujó en el paso 1 (tiene tendencia, no LATERAL)
2. BB Middle H1, si aplicara (normalmente no se dibuja — ver paso 3, pero úsalo si fue el único
   nivel con tendencia clara)
3. La MA (D1 o H1) más cercana al precio actual, de las que se dibujaron en los pasos 3/4
4. La H-line (Máx/Mín H1) más cercana al precio actual, de las dibujadas en el paso 3

**Si ningún nivel fue dibujado** para ese ticker (caso límite: BB LATERAL en D1 y H1, ninguna MA
calificó, y por algún fallo tampoco se dibujaron H-lines), escribir explícitamente en el
briefing: `⚠ Vigilar: sin nivel dibujado — vigilar manualmente, sin alerta posible`. Nunca omitir
la línea en silencio — la ausencia debe ser visible, no implícita.

**Dirección esperada** (informativa, para que el usuario elija bien en el diálogo nativo):
CALL → cruce hacia arriba del nivel. PUT → cruce hacia abajo.

**Formato de la línea en el briefing:**
`⚠ Vigilar: línea [BB Middle D1 / MA40 D1 / Máx 1 H1 / etc.] ($precio) — alerta manual si rompe hacia [arriba/abajo]`

**Acción del usuario** (no de Claude): clic derecho sobre esa línea en el chart → "Crear alerta
sobre [línea horizontal]". Confirmado en vivo el 2026-06-17: el diálogo nativo de TradingView ya
trae "Activación: Solo una vez" por defecto — no hace falta cambiar nada ahí.

**Por qué no se usa `alert_create`/`alert_delete` del MCP:** TradingView Desktop no expone API
interna para alertas (`_alertService is null`, confirmado en el commit `9274ff3` de este mismo
repo). `alert_create` acepta un parámetro `condition` pero el código nunca lo conecta al
dropdown real de la UI — solo rellena precio y mensaje. `alert_delete` no soporta borrado
individual. Automatizar el diálogo completo vía DOM sería repetir, para alertas, el patrón que
este proyecto ya evitó deliberadamente en estrategias/layouts/símbolos/pine scripts (todos
migrados a API interna cuando existía). El gesto nativo de un clic ya resuelve esto sin ese
riesgo.

### Paso final — Guardar reporte y líneas

Al terminar el checklist completo de los 5 tickers, llamar en este orden:
```
1. premarket_save(
     content="[reporte completo en markdown]",
     date="YYYY-MM-DD",
     brief_data="[JSON.stringify del output completo de morning_brief]"
   )

2. drawn_lines_save(
     entity_ids=["id1", "id2", ...]  ← todos los IDs retornados por draw_shape durante el checklist
   )
```
```
El reporte se guarda en `docs/sessions/premarket-YYYY-MM-DD.md` y también genera
`docs/sessions/premarket-YYYY-MM-DD.html` — dashboard estático.

**IMPORTANTE:** Pasar `brief_data` siempre — es el JSON del `morning_brief` completo
(`symbols_scanned` + `fundamental_filters`). Esto genera el HTML automáticamente.

**DESPUÉS de premarket_save exitoso:** abrir el dashboard en el browser con:
```
start docs\sessions\premarket-YYYY-MM-DD.html
```
Usar la fecha del reporte. Esto abre el dashboard automáticamente sin que el usuario tenga que pedirlo.

### Retroalimentación — Paso R (antes del morning_brief)

Llamar `trades_get(10)` y analizar los resultados antes de iniciar el análisis del día.

**Qué evaluar:**
- Win rate últimos 7 días por estrategia → si una estrategia tiene ≤30% win rate en la semana, marcarla como `baja confianza` en el reporte del día
- Win rate por ticker → tickers con pérdidas consecutivas recientes = más cautela
- Patrón BB M15 width + gap direction → si hay datos suficientes, ajustar prioridad de estrategias

**Formato del bloque de retroalimentación** (mostrar antes del análisis):

```
## 🔄 Retroalimentación (últimos N trades)
Win rate general: X/N (XX%)
| Ticker | Strat | Lado | Resultado | Modo |
|--------|-------|------|-----------|------|
| AAPL   | S-02  | CALL | +12%      | real |
...
⚠️ Alertas: [ej. "STRAT-02 PUT: 0/3 esta semana → baja confianza hoy"]
✅ Patrones confirmados: [ej. "BB M15 estrecho + gap up → CALL efectivo (2/2)"]
```

Si `trades_get` retorna 0 trades → omitir el bloque y continuar sin retroalimentación.

---

### Cierre de Sesión — Paso 8 (después de drawn_lines_save)

Al terminar el checklist, preguntar siempre:

> "¿Ejecutaste alguna operación hoy o ayer? Si me das los datos la registro en Supabase para el historial.
> Necesito: **ticker · estrategia · CALL/PUT · prima entrada · prima salida · real o paper**
> (strike y notas son opcionales)"

Si el usuario da los datos → llamar `trade_save(...)` con ellos.
Si dice "no operé" o no responde → continuar sin registrar.

**No insistir más de una vez.** Si el usuario ya registró via el dashboard HTML → no duplicar.

---

### Reglas operativas
- Verificar filtros globales: FED ±2 días hábiles / Earnings ±7 días por ticker
- Ventana válida: 9:30–11:30 AM ET únicamente
- Strike: prima dentro del rango óptimo por ticker (ver rules.json → asset_config)
- Expiración: más cercana. Corte viernes 11:00 AM ET → siguiente semana si ya pasó
- Exit: +12% profit GTC / -25% stop loss GTC (bracket inmediato al entrar)

## Movimientos en Bloque (#18)

Concepto: múltiples activos de un mismo grupo (bloque) se mueven hacia el mismo nivel objetivo simultáneamente — como una carrera donde todos los carritos salen del mismo punto y van a la misma meta. El "líder" llega primero; los "rezagados" llegan después. La estrategia es entrar en el más rezagado cuando el líder ya está en el nivel: el rezagado tiene más recorrido por hacer y más potencial de ganancia.

### Tipos de bloques

| Tipo | Activos |
|------|---------|
| Índices (más potente) | IWM / TNA, SPY, DIA, QQQ |
| Semiconductores | NVDA, MU, AMD, QCOM |
| Tecnológicas / Consumo / Bancos / Tarjetas | identificar via mapa de calor Finviz |

Identificar el bloque activo: ir al mapa de calor de Finviz → si el color se concentra en un sector/industria específica → bloque sectorial activo. Si el color domina TODO el mercado sin distinción → probable falso momentum amplio → no operar.

### Cuándo ocurren

- Final e inicio de ciclos y tendencias
- Cuando todos los activos del bloque "vienen dibujando desde el mismo lugar" (mismo nivel de origen)
- Los bloques de índices son los más potentes y fiables

### Nivel objetivo (la "meta de la carrera")

El nivel objetivo suele ser una MA clave: **MA40, MA100 o MA200**.
- MA40: primer objetivo en correcciones/rebotes dentro de tendencia
- MA100 / MA200: cambios de tendencia más profundos

El líder ya llegó o está rompiendo ese nivel. Los rezagados todavía vienen de camino.

### Workflow — Análisis de bloque

**Trigger**: "analiza el bloque de [sector/índices]" / "identifica el rezagado" / "movimiento en bloque"

```
Para cada ticker del bloque identificado:
  1. chart_set_symbol(ticker)
  2. chart_set_timeframe("D")        ← análisis en D1 primero
  3. data_get_study_values()         ← leer MA20, MA40, MA100, MA200
  4. quote_get(ticker)               ← precio actual
  5. Calcular distancia al nivel objetivo (MA40 por defecto):
       distancia% = (MA40 - precio) / precio × 100
       (negativo si el ticker ya superó el nivel → es líder)
  6. draw_shape(horizontal_line, precio=MA40) → "MA40 [TICKER]" (amarillo)
  7. Registrar: [ticker | precio | MA40 | distancia% | líder/rezagado]

Al terminar todos:
  - Ordenar de menor a mayor distancia%
  - Líder = distancia% negativa (ya en nivel o por encima)
  - Rezagado = mayor distancia% positiva → candidato de entrada
```

**Output**:
```
BLOQUE: [nombre]  |  NIVEL OBJETIVO: MA40 / MA100 / MA200
─────────────────────────────────────────────────────────
LÍDER    → [TICKER]  precio=XX  MA40=XX  ✅ ya en nivel / rompiendo
[TICKER] → precio=XX  MA40=XX  distancia=3.2%
REZAGADO → [TICKER]  precio=XX  MA40=XX  distancia=7.8%  ← ENTRADA
─────────────────────────────────────────────────────────
Setup: [CALL/PUT] en [REZAGADO] — esperar que [LÍDER] confirme continuidad en el nivel
```

### Reglas

- El líder debe estar EN o ya PASANDO el nivel, nunca anticipar
- Si ≥2 tickers del bloque ya llegaron al nivel → mayor probabilidad para el rezagado
- Un bloque de índices (IWM+SPY+DIA+QQQ) pesa más que uno sectorial
- NO operar si parece "falso momentum amplio" (todo el mercado igual, sin distinción sectorial)
- La confirmación final sigue siendo técnica: BB + MAs del rezagado deben soportar la dirección
- Este análisis es independiente del checklist premarket — se invoca ad-hoc cuando se detecta el patrón

---

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
