// ══════════════════════════════════════════════════════════════
//  Analytics numeric primitives — Phase 5.3 TypeScript engine
//
//  EXACT behavioral port of the reference engine's math helpers
//  (python-analytics/employee_analytics.py — REFERENCE ONLY, the
//  production engine is TypeScript from this phase on).
//
//  PARITY DOCTRINE (Phase 5.3 spec §8/§9):
//    • Deterministic, side-effect free, React/Firebase independent.
//    • Rounding is Python 3 `round()` semantics — round-half-to-EVEN
//      computed on the EXACT decimal expansion of the binary double
//      (BigInt-based). Math.round / toFixed would diverge on exact
//      ties (0.125 → 0.13 in JS, 0.12 in Python) — never used.
//    • Means/stddev use compensated (Neumaier) summation to mirror
//      Python's fsum-grade accuracy; slope/pearson use plain
//      left-to-right summation exactly like the reference (builtins).
//    • Negative zero is normalized to +0 (JSON "-0.0" ↔ "0").
// ══════════════════════════════════════════════════════════════

/** Coerce to float, or null when not numeric (never raises). Booleans are NOT numbers. */
export function num(value: unknown): number | null {
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) return null;
    return value;
  }
  return null;
}

function normalizeZero(x: number): number {
  return x === 0 ? 0 : x; // collapse -0 → 0 (JSON-stable)
}

// ── Python round() — round-half-even on the exact decimal value ──
// Every finite double is m × 2^e. For e < 0 the exact decimal has
// k = -e digits: value = m·5^k / 10^k. Rounding to `digits` decimals
// is exact integer division of (m·5^k·10^digits) by 10^k with
// round-half-to-even on the remainder — computed with BigInt so the
// result is IDENTICAL to CPython's `_Py_dg_dtoa`-based round().
export function pyRound(value: number, digits?: number): number;
export function pyRound(value: null, digits?: number): null;
export function pyRound(value: number | null, digits = 2): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  if (value === 0) return 0;
  // Integer fast path — round(x, digits) is the identity for integral
  // doubles (mirrors CPython), and avoids BigInt work entirely.
  if (Number.isInteger(value)) return normalizeZero(value);
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);

  // Decompose the IEEE-754 double.
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const rawExp = Number((bits >> BigInt(52)) & BigInt(0x7ff));
  const rawMan = bits & ((BigInt(1) << BigInt(52)) - BigInt(1));
  let mantissa: bigint;
  let exp: number;
  if (rawExp === 0) {
    mantissa = rawMan;
    exp = -1074;
  } else {
    mantissa = rawMan | (BigInt(1) << BigInt(52));
    exp = rawExp - 1075;
  }

  // Exact rational: mantissa × 2^exp — as (N numerator, k decimal digits).
  let num_: bigint;
  let k: number;
  if (exp >= 0) {
    num_ = mantissa << BigInt(exp);
    k = 0;
  } else {
    k = -exp;
    num_ = mantissa * (BigInt(5) ** BigInt(k)); // mantissa / 2^k === mantissa·5^k / 10^k
  }

  // Scale to `digits` decimals: value = N / 10^k → q / 10^digits.
  let q: bigint;
  if (digits >= k) {
    q = num_ * (BigInt(10) ** BigInt(digits - k)); // exact — no rounding needed
  } else {
    const div = BigInt(10) ** BigInt(k - digits);
    const quotient = num_ / div;
    const rem = num_ % div;
    const half = div / BigInt(2);
    if (rem > half || (rem === half && quotient % BigInt(2) === BigInt(1))) {
      q = quotient + BigInt(1);
    } else {
      q = quotient;
    }
  }

  const scaled = Number(q); // exact while |q| ≤ 2^53 (guaranteed for analytics magnitudes)
  if (!Number.isFinite(scaled)) return null;
  return normalizeZero(sign * scaled / 10 ** digits);
}

/** Round to `digits` decimals, null passes through (reference _r). */
export function r(value: number, digits?: number): number;
export function r(value: null, digits?: number): null;
export function r(value: number | null, digits?: number): number | null;
export function r(value: number | null, digits = 2): number | null {
  if (value === null) return null;
  return pyRound(value, digits);
}

/** Compensated (Neumaier) summation — fsum-grade accuracy. */
export function compensatedSum(values: number[]): number {
  let sum = 0;
  let compensation = 0;
  for (const v of values) {
    const t = sum + v;
    if (Math.abs(sum) >= Math.abs(v)) {
      compensation += (sum - t) + v;
    } else {
      compensation += (v - t) + sum;
    }
    sum = t;
  }
  return sum + compensation;
}

/** Arithmetic mean; null for an empty list (reference _mean → statistics.fmean). */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return compensatedSum(values) / values.length;
}

/** Median; null when empty. Even counts average the two middle values. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sample standard deviation (n-1); null below 2 points (reference _stddev). */
export function sampleStddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mu = mean(values) as number;
  const ss = compensatedSum(values.map((v) => (v - mu) * (v - mu)));
  return Math.sqrt(ss / (values.length - 1));
}

/** Slope of y on x; null when n<2 or zero variance (reference _least_squares_slope). */
export function leastSquaresSlope(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 2) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const meanX = mean(xs);
  const meanY = mean(ys);
  if (meanX === null || meanY === null) return null;
  // Plain left-to-right summation — mirrors the reference exactly.
  let cov = 0;
  for (const [x, y] of pairs) cov += (x - meanX) * (y - meanY);
  let varX = 0;
  for (const x of xs) varX += (x - meanX) * (x - meanX);
  if (varX === 0) return null;
  return cov / varX;
}

/** Pearson r; null when n<2 or zero variance (reference _pearson). */
export function pearson(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 2) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const meanX = mean(xs);
  const meanY = mean(ys);
  if (meanX === null || meanY === null) return null;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (const [x, y] of pairs) {
    cov += (x - meanX) * (y - meanY);
    varX += (x - meanX) * (x - meanX);
    varY += (y - meanY) * (y - meanY);
  }
  if (varX === 0 || varY === 0) return null;
  const corr = cov / Math.sqrt(varX * varY);
  return Math.max(-1, Math.min(1, corr));
}

/**
 * Median / MAD robust baseline (reference _robust_baseline):
 * sigma = MAD / 0.6745; when MAD == 0 fall back to the POPULATION
 * standard deviation; a perfectly flat baseline yields (median, null).
 */
export function robustBaseline(values: number[]): { med: number | null; sigma: number | null } {
  if (values.length === 0) return { med: null, sigma: null };
  const med = median(values) as number;
  const mad = median(values.map((v) => Math.abs(v - med))) as number;
  let sigma: number | null = mad > 0 ? mad / 0.6745 : null;
  if (sigma === null) {
    if (values.length >= 2) {
      const mu = mean(values) as number;
      // Population variance — plain summation like the reference.
      let ss = 0;
      for (const v of values) ss += (v - mu) * (v - mu);
      const variance = ss / values.length;
      sigma = variance > 0 ? Math.sqrt(variance) : null;
    } else {
      sigma = null;
    }
  }
  return { med, sigma };
}

/** >= +0.5pp → UP, <= -0.5pp → DOWN, else STABLE (reference threshold). */
export function directionFromSlope(slope: number | null): 'UP' | 'DOWN' | 'STABLE' | null {
  if (slope === null) return null;
  if (slope >= 0.5) return 'UP';
  if (slope <= -0.5) return 'DOWN';
  return 'STABLE';
}

/**
 * Parse the stored 'DD/MM/YYYY' dates deterministically (reference
 * _parse_stored_date): strict component validation, no format
 * guessing. Returns the UTC day number, or null.
 */
export function parseStoredDateToDayNumber(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split('/');
  if (parts.length !== 3) return null;
  const d = Number(parts[0]);
  const m = Number(parts[1]);
  const y = Number(parts[2]);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  // Python datetime.date(y, m, d) raises ValueError outside valid
  // ranges — mirror that by rejecting instead of rolling over.
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const utc = Date.UTC(y, m - 1, d);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    return null;
  }
  return utc / 86_400_000;
}

/** Index of a month key inside the window, or null (reference _month_index). */
export function monthIndexOf(window: string[], month: string): number | null {
  const idx = window.indexOf(month);
  return idx === -1 ? null : idx;
}

/** share = part/whole*100 rounded to 1 digit; null when whole <= 0 (reference _pct). */
export function pct(part: number, whole: number | null): number | null {
  if (whole === null || whole <= 0) return null;
  return r((part / whole) * 100, 1);
}

/** Indices where the count increased vs the previous month (reference _series_increases). */
export function seriesIncreases(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i] > series[i - 1]) out.push(i);
  }
  return out;
}
