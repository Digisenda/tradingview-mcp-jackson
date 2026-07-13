/**
 * Linear regression trendline at bar `index`.
 * direction='up' uses highs (línea de resistencia, bordea el techo del rango),
 * direction='down' uses lows (línea de soporte, bordea el piso del rango).
 * Returns { slope, intercept, value } — value is the projected price at `index`,
 * fit lookahead-free on the `lookback` bars strictly before it.
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
  const intercept = (sumY - slope * sumX) / n;
  // Value extrapolated one step past the slice (bar at `index`)
  const value = slope * n + intercept;
  return {
    slope: parseFloat(slope.toFixed(6)),
    intercept: parseFloat(intercept.toFixed(4)),
    value: parseFloat(value.toFixed(4)),
  };
}
