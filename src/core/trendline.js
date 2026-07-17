/**
 * Envelope trendline at bar `index`.
 * direction='up' uses highs (línea de resistencia, bordea el techo del rango),
 * direction='down' uses lows (línea de soporte, bordea el piso del rango).
 * Returns { slope, intercept, value } — value is the projected price at `index`,
 * fit lookahead-free on the `lookback` bars strictly before it.
 *
 * NO es una regresión OLS pura: rules.yaml (STRAT-01/02-PC-001) pide una línea que
 * "bordee LEVEMENTE POR ENCIMA/DEBAJO la mayor cantidad de puntos posibles" — una
 * envolvente, no una línea de mejor ajuste. Un OLS puro pasa por el MEDIO de los datos
 * (mitad de los puntos arriba, mitad abajo), lo que la deja sistemáticamente demasiado
 * cerca del precio y genera falsas rupturas (bug reportado en vivo 2026-07-17: el precio
 * "rompía" una trendline que en el chart real no había tocado). Fix: ajustar el slope por
 * OLS (sigue siendo la mejor estimación de pendiente) pero desplazar el intercepto en
 * paralelo hasta que la línea toque el punto más extremo de la ventana — así queda
 * garantizado que TODOS los demás puntos quedan del lado correcto (por debajo para "up",
 * por encima para "down").
 */
export function computeTrendlineAt(bars, index, direction, lookback = 20) {
  const start = Math.max(0, index - lookback);
  const slice = bars.slice(start, index);
  if (slice.length < 5) return null;
  const n = slice.length;
  const ys = direction === "up" ? slice.map((b) => b.high) : slice.map((b) => b.low);
  const xs = ys.map((_, i) => i);
  const sumX = xs.reduce((s, v) => s + v, 0);
  const sumY = ys.reduce((s, v) => s + v, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const fitIntercept = (sumY - slope * sumX) / n;

  const residuals = xs.map((x, i) => ys[i] - (slope * x + fitIntercept));
  const envelopeShift = direction === "up" ? Math.max(...residuals) : Math.min(...residuals);
  const intercept = fitIntercept + envelopeShift;

  // Value extrapolated one step past the slice (bar at `index`)
  const value = slope * n + intercept;
  return {
    slope: parseFloat(slope.toFixed(6)),
    intercept: parseFloat(intercept.toFixed(4)),
    value: parseFloat(value.toFixed(4)),
  };
}
