import type { DriverListItem, LapInfo, SessionLap, SessionResult } from '../types/telemetry';
import { adjustColorForTheme, offsetTeamColor } from './colors';

// ─── Time helpers ─────────────────────────────────────────────────────────────

/** "1:29.893" / "29.893" → seconds; "N/A", "", "-" → null. */
export function parseTime(t: string | null | undefined): number | null {
  if (!t || t === 'N/A' || t === '-' || t.toLowerCase() === 'nan') return null;
  const parts = t.split(':');
  const v = parts.length === 2 ? parseInt(parts[0], 10) * 60 + parseFloat(parts[1]) : parseFloat(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** seconds → "1:29.893" (or "29.893" under a minute). */
export function formatLapTime(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(3).padStart(6, '0');
  return m > 0 ? `${m}:${rest}` : rest;
}

export function isRaceSession(sessionType: string | null): boolean {
  return sessionType === 'R' || sessionType === 'S';
}

// ─── Building SessionLap[] from either data source ───────────────────────────

/** Shape of analysis.json written by process_session.py / backfill_analysis.py. */
export interface RawAnalysisFile {
  version: number;
  laps: Array<{
    driver: string; lap_number: number; lap_time: number | null;
    s1: number | null; s2: number | null; s3: number | null;
    compound: string; tyre_life: number | null; stint: number | null;
    position: number | null; pit_in: boolean; pit_out: boolean;
    session_time: number | null; track_status: string; has_telemetry?: boolean;
  }>;
  results: Array<{ driver: string; position: number | null; grid: number | null; status: string }>;
}

export function lapsFromAnalysis(raw: RawAnalysisFile): { laps: SessionLap[]; results: SessionResult[] } {
  const laps = raw.laps.map((l): SessionLap => ({
    driver: l.driver,
    lap: l.lap_number,
    time: l.lap_time,
    s1: l.s1, s2: l.s2, s3: l.s3,
    compound: (l.compound || 'UNKNOWN').toUpperCase(),
    tyreLife: l.tyre_life ?? 0,
    stint: l.stint ?? 1,
    position: l.position,
    pitIn: l.pit_in,
    pitOut: l.pit_out,
    sessionTime: l.session_time,
    trackStatus: l.track_status ?? '',
    hasTelemetry: l.has_telemetry ?? false,
  }));
  const results = raw.results.map(r => ({
    driver: r.driver, position: r.position, grid: r.grid, status: r.status,
  }));
  return { laps, results };
}

/**
 * Older sessions only have laps/<DRV>.json: no stint, position or pit flags.
 * Stints are inferred from a compound change or the tyre-age counter resetting;
 * the first lap of a new stint is marked as the pit-out lap and the lap before
 * it as the pit-in lap.
 */
export function lapsFromLapFiles(perDriver: Record<string, LapInfo[]>): SessionLap[] {
  const out: SessionLap[] = [];
  for (const [driver, laps] of Object.entries(perDriver)) {
    const sorted = [...laps].sort((a, b) => a.lap_number - b.lap_number);
    let stint = 1;
    const driverLaps: SessionLap[] = [];
    sorted.forEach((l, i) => {
      const prev = sorted[i - 1];
      const compound = (l.compound || 'UNKNOWN').toUpperCase();
      const newStint = prev !== undefined && (
        compound !== (prev.compound || 'UNKNOWN').toUpperCase() || l.tyre_life < prev.tyre_life
      );
      if (newStint) {
        stint++;
        driverLaps[driverLaps.length - 1].pitIn = true;
      }
      driverLaps.push({
        driver,
        lap: l.lap_number,
        time: l.lap_time_seconds ?? parseTime(l.lap_time),
        s1: parseTime(l.sector1), s2: parseTime(l.sector2), s3: parseTime(l.sector3),
        compound,
        tyreLife: l.tyre_life,
        stint,
        position: null,
        pitIn: false,
        pitOut: newStint,
        sessionTime: null,
        trackStatus: '',
        hasTelemetry: l.is_valid,
      });
    });
    out.push(...driverLaps);
  }
  return out;
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

export function groupByDriver(laps: SessionLap[]): Map<string, SessionLap[]> {
  const m = new Map<string, SessionLap[]>();
  for (const l of laps) {
    if (!m.has(l.driver)) m.set(l.driver, []);
    m.get(l.driver)!.push(l);
  }
  m.forEach(v => v.sort((a, b) => a.lap - b.lap));
  return m;
}

export interface Stint {
  driver: string;
  stint: number;
  compound: string;
  startLap: number;
  endLap: number;
  startTyreLife: number;
  laps: SessionLap[];
}

export function buildStints(laps: SessionLap[]): Stint[] {
  const out: Stint[] = [];
  groupByDriver(laps).forEach((dLaps, driver) => {
    let cur: Stint | null = null;
    for (const l of dLaps) {
      if (!cur || cur.stint !== l.stint) {
        cur = {
          driver, stint: l.stint, compound: l.compound,
          startLap: l.lap, endLap: l.lap, startTyreLife: l.tyreLife, laps: [],
        };
        out.push(cur);
      }
      cur.endLap = l.lap;
      cur.laps.push(l);
    }
  });
  return out;
}

// ─── Lap filtering ────────────────────────────────────────────────────────────

/** Laps that can be compared on pace: timed, not pit in/out laps. */
export function isPaceLap(l: SessionLap): boolean {
  return l.time !== null && !l.pitIn && !l.pitOut && l.lap > 1;
}

export function fastestTime(laps: SessionLap[]): number | null {
  let best: number | null = null;
  for (const l of laps) if (l.time !== null && (best === null || l.time < best)) best = l.time;
  return best;
}

/** The 107% rule: anything slower than this is an outlier (SC, traffic, cool-down). */
export function outlierThreshold(laps: SessionLap[]): number {
  const best = fastestTime(laps.filter(l => l.lap > 1 || laps.length < 3));
  return best === null ? Infinity : best * 1.07;
}

// Fuel effect on lap time. A car burns ~1.5-1.8 kg per lap and each kg costs
// ~0.03-0.035 s, so every lap of fuel still on board costs roughly 0.055 s.
// Correcting to "empty tank" makes early and late race laps comparable.
export const FUEL_SECONDS_PER_LAP = 0.055;

export function fuelCorrected(time: number, lap: number, totalLaps: number): number {
  return time - FUEL_SECONDS_PER_LAP * Math.max(0, totalLaps - lap);
}

// ─── Race-only derivations ────────────────────────────────────────────────────

/**
 * Elapsed race time at the end of each lap, per driver.
 * Uses the session clock when the source has it (exact, survives laps with no
 * recorded time); otherwise sums lap times and stops at the first gap.
 */
export function cumulativeTimes(laps: SessionLap[]): Map<string, Map<number, number>> {
  const byDriver = groupByDriver(laps);

  // Race start on the session clock: earliest (lap-1 end - lap-1 time).
  let start: number | null = null;
  byDriver.forEach(dLaps => {
    const l1 = dLaps.find(l => l.lap === 1);
    if (l1 && l1.sessionTime !== null && l1.time !== null) {
      const s = l1.sessionTime - l1.time;
      if (start === null || s < start) start = s;
    }
  });

  const out = new Map<string, Map<number, number>>();
  byDriver.forEach((dLaps, driver) => {
    const m = new Map<number, number>();
    if (start !== null && dLaps.every(l => l.sessionTime !== null)) {
      for (const l of dLaps) m.set(l.lap, (l.sessionTime as number) - start);
    } else {
      let acc = 0;
      for (const l of dLaps) {
        if (l.time === null) break;
        acc += l.time;
        m.set(l.lap, acc);
      }
    }
    out.set(driver, m);
  });
  return out;
}

/** Fill missing positions by ranking cumulative time among cars that completed each lap. */
export function withDerivedPositions(laps: SessionLap[]): SessionLap[] {
  if (laps.some(l => l.position !== null)) return laps;
  const cum = cumulativeTimes(laps);
  const byLap = new Map<number, Array<{ driver: string; t: number }>>();
  cum.forEach((m, driver) => m.forEach((t, lap) => {
    if (!byLap.has(lap)) byLap.set(lap, []);
    byLap.get(lap)!.push({ driver, t });
  }));
  const pos = new Map<string, number>();
  byLap.forEach((arr, lap) => {
    arr.sort((a, b) => a.t - b.t).forEach((e, i) => pos.set(`${e.driver}|${lap}`, i + 1));
  });
  return laps.map(l => ({ ...l, position: pos.get(`${l.driver}|${l.lap}`) ?? null }));
}

/** Finishing order: official results when present, else most laps then least time. */
export function finishingOrder(laps: SessionLap[], results: SessionResult[]): string[] {
  const drivers = Array.from(new Set(laps.map(l => l.driver)));
  const official = new Map(results.filter(r => r.position !== null).map(r => [r.driver, r.position as number]));
  if (official.size > 0) {
    return drivers.sort((a, b) => (official.get(a) ?? 99) - (official.get(b) ?? 99));
  }
  const cum = cumulativeTimes(laps);
  const key = (d: string) => {
    const m = cum.get(d);
    if (!m || m.size === 0) return { laps: 0, t: Infinity };
    const last = Math.max(...m.keys());
    return { laps: last, t: m.get(last)! };
  };
  return drivers.sort((a, b) => {
    const ka = key(a), kb = key(b);
    return kb.laps - ka.laps || ka.t - kb.t;
  });
}

/** Drivers ordered by their best lap (for qualifying/practice). */
export function paceOrder(laps: SessionLap[]): string[] {
  const best = new Map<string, number>();
  for (const l of laps) {
    if (l.time === null) continue;
    const b = best.get(l.driver);
    if (b === undefined || l.time < b) best.set(l.driver, l.time);
  }
  const drivers = Array.from(new Set(laps.map(l => l.driver)));
  return drivers.sort((a, b) => (best.get(a) ?? Infinity) - (best.get(b) ?? Infinity));
}

// ─── Track status ─────────────────────────────────────────────────────────────

export interface StatusBand { kind: 'SC' | 'VSC' | 'RED'; startLap: number; endLap: number }

/** Consecutive lap ranges run under Safety Car, VSC or red flag (any car reporting it). */
export function trackStatusBands(laps: SessionLap[]): StatusBand[] {
  const kindAt = new Map<number, StatusBand['kind']>();
  for (const l of laps) {
    const s = l.trackStatus;
    if (!s) continue;
    const k: StatusBand['kind'] | null = s.includes('5') ? 'RED' : s.includes('4') ? 'SC'
      : (s.includes('6') || s.includes('7')) ? 'VSC' : null;
    if (!k) continue;
    const prev = kindAt.get(l.lap);
    const rank = { RED: 3, SC: 2, VSC: 1 };
    if (!prev || rank[k] > rank[prev]) kindAt.set(l.lap, k);
  }
  const bands: StatusBand[] = [];
  Array.from(kindAt.keys()).sort((a, b) => a - b).forEach(lap => {
    const k = kindAt.get(lap)!;
    const last = bands[bands.length - 1];
    if (last && last.kind === k && last.endLap === lap - 1) last.endLap = lap;
    else bands.push({ kind: k, startLap: lap, endLap: lap });
  });
  return bands;
}

// ─── Driver colours (whole grid) ─────────────────────────────────────────────

/**
 * Team colour per driver; the second car of a team gets the offset shade.
 * `first` (the compared drivers, in comparison order) claim colours first, so a
 * driver has the same colour here as in the telemetry charts.
 */
export function driverColorMap(
  drivers: DriverListItem[], theme: 'dark' | 'light', first: string[] = [],
): Record<string, string> {
  const rank = (d: DriverListItem) => {
    const i = first.indexOf(d.abbreviation);
    return i === -1 ? first.length : i;
  };
  const ordered = drivers.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i);
  const counts = new Map<string, number>();
  const out: Record<string, string> = {};
  for (const { d } of ordered) {
    const base = adjustColorForTheme(d.team_color || '#888888', theme);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    out[d.abbreviation] = offsetTeamColor(base, n, theme);
  }
  return out;
}

/** Linear least-squares slope (y per unit x); null with fewer than 3 points. */
export function slope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? null : num / den;
}
