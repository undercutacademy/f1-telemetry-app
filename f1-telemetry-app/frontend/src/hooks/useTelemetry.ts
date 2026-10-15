import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  EventInfo,
  SessionInfo,
  DriverListItem,
  LapInfo,
  TelemetryData,
  TelemetryRequest,
  CornerInfo,
} from '../types/telemetry';

// ─── CDN mirrors (fallback chain) ────────────────────────────────────────────

const REPO = 'undercutacademy/f1-data';
const BRANCH = 'master';

// NOTE: statically must use the `@BRANCH` form. The `/BRANCH/` form 301-redirects
// to an http:// URL, which browsers block as mixed content on our HTTPS origin.
const CDN_MIRRORS = [
  (p: string) => `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/${p}`,
  (p: string) => `https://cdn.statically.io/gh/${REPO}@${BRANCH}/${p}`,
  (p: string) => `https://rawcdn.githack.com/${REPO}/${BRANCH}/${p}`,
];

// Dev-only: VITE_LOCAL_DATA_URL points at a locally served f1-data tree (e.g. a
// freshly processed session that is not on the CDN yet). It replaces the CDN
// mirrors entirely so stale CDN copies can't win the race.
const LOCAL_DATA_URL = import.meta.env.DEV ? import.meta.env.VITE_LOCAL_DATA_URL : undefined;
const MIRRORS = LOCAL_DATA_URL
  ? [(p: string) => `${LOCAL_DATA_URL.replace(/\/$/, '')}/${p}`]
  : CDN_MIRRORS;

// Race all mirrors in parallel; first 2xx response wins, the rest are aborted.
// Each mirror gets its OWN AbortController so one mirror's timeout (or a transient
// network drop, e.g. ERR_NETWORK_CHANGED on a wifi/VPN switch) cannot kill the
// others. A shared controller made any brief stall fail all three at once.
const MIRROR_TIMEOUT_MS = 8000;

async function raceMirrors<T>(path: string): Promise<T> {
  const controllers: AbortController[] = [];

  const tryMirror = async (url: string): Promise<T> => {
    const ctrl = new AbortController();
    controllers.push(ctrl);
    const timeout = setTimeout(() => ctrl.abort(), MIRROR_TIMEOUT_MS);
    try {
      // redirect: 'error' surfaces a mirror that bounces us to an insecure URL
      // as a normal failure instead of a browser mixed-content console error.
      const res = await fetch(url, { signal: ctrl.signal, redirect: 'error' });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    return await Promise.any(MIRRORS.map((m) => tryMirror(m(path))));
  } finally {
    // Cancel the losers so we stop downloading data we no longer need.
    controllers.forEach((c) => c.abort());
  }
}

export async function cdnGet<T>(path: string): Promise<T> {
  // One retry: a transient network change aborts in-flight requests across every
  // mirror at once, and that is recoverable rather than a real fetch failure.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await raceMirrors<T>(path);
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  const errors = lastErr instanceof AggregateError ? lastErr.errors : [lastErr];
  throw new Error(`CDN fetch failed: ${path} — ${errors.map(String).join('; ')}`);
}

// For files that only exist for some sessions (analysis.json, weather.json).
// Resolves null once two mirrors agree on a 404 instead of waiting for the slow
// mirror's timeout. One 404 alone is not trusted: a stale mirror 404s a file
// that was pushed after it last refreshed.
export async function cdnGetOptional<T>(path: string): Promise<T | null> {
  const needed = Math.min(2, MIRRORS.length);
  const controllers: AbortController[] = [];
  let notFound = 0;

  const result = await new Promise<T | null>((resolve) => {
    let settled = 0;
    MIRRORS.forEach(async (m) => {
      const ctrl = new AbortController();
      controllers.push(ctrl);
      const timeout = setTimeout(() => ctrl.abort(), MIRROR_TIMEOUT_MS);
      try {
        const res = await fetch(m(path), { signal: ctrl.signal, redirect: 'error' });
        if (res.ok) { resolve((await res.json()) as T); return; }
        if (res.status === 404 && ++notFound >= needed) resolve(null);
      } catch { /* timeout / network: just lose the race */ }
      finally {
        clearTimeout(timeout);
        if (++settled === MIRRORS.length) resolve(null);
      }
    });
  });

  controllers.forEach((c) => c.abort());
  return result;
}

// ─── Signal processing (replaces Python backend) ─────────────────────────────

const NUM_POINTS = 500;

function linspace(start: number, stop: number, n: number): number[] {
  if (n <= 1) return [start];
  return Array.from({ length: n }, (_, i) => start + (stop - start) * (i / (n - 1)));
}

function linearInterp(srcDist: number[], srcVals: number[], targetDist: number[]): number[] {
  const n = srcDist.length;
  return targetDist.map(d => {
    if (d <= srcDist[0]) return srcVals[0];
    if (d >= srcDist[n - 1]) return srcVals[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (srcDist[mid] <= d) lo = mid; else hi = mid;
    }
    const t = (d - srcDist[lo]) / (srcDist[hi] - srcDist[lo]);
    return srcVals[lo] + t * (srcVals[hi] - srcVals[lo]);
  });
}

function nearestBefore<T>(srcDist: number[], srcVals: T[], targetDist: number[]): T[] {
  const n = srcDist.length;
  return targetDist.map(d => {
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (srcDist[mid] <= d) lo = mid + 1; else hi = mid;
    }
    return srcVals[Math.max(0, Math.min(lo - 1, n - 1))];
  });
}

// np.gradient equivalent
function npGrad(vals: number[]): number[] {
  const n = vals.length;
  if (n < 2) return new Array(n).fill(0);
  return vals.map((_, i) => {
    if (i === 0) return vals[1] - vals[0];
    if (i === n - 1) return vals[n - 1] - vals[n - 2];
    return (vals[i + 1] - vals[i - 1]) / 2;
  });
}

function movingAvg(vals: number[], k = 7): number[] {
  const half = Math.floor(k / 2);
  return vals.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(vals.length, i + half + 1);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += vals[j];
    return sum / (hi - lo);
  });
}

function clamp(vals: number[], lo: number, hi: number): number[] {
  return vals.map(v => Math.max(lo, Math.min(hi, v)));
}

function computeAccelerations(
  speed: number[], time: number[], x: number[], y: number[]
): { longitudinal_g: number[]; lateral_g: number[] } {
  const speed_ms = speed.map(s => s / 3.6);
  const dt = npGrad(time).map(v => (Math.abs(v) < 1e-6 ? 1e-6 : v));
  const dv = npGrad(speed_ms);
  const longG = clamp(movingAvg(dv.map((d, i) => d / dt[i] / 9.81)), -6, 6);

  let latG: number[];
  if (x.length === NUM_POINTS && y.length === NUM_POINTS) {
    const dx = npGrad(x);
    const dy = npGrad(y);
    const heading = dx.map((_, i) => Math.atan2(dy[i], dx[i]));
    const unwrapped = [...heading];
    for (let i = 1; i < unwrapped.length; i++) {
      let diff = unwrapped[i] - unwrapped[i - 1];
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      unwrapped[i] = unwrapped[i - 1] + diff;
    }
    const dh = npGrad(unwrapped);
    const omega = dh.map((v, i) => v / dt[i]);
    latG = clamp(movingAvg(omega.map((w, i) => speed_ms[i] * w / 9.81)), -6, 6);
  } else {
    latG = new Array(NUM_POINTS).fill(0);
  }

  return {
    longitudinal_g: longG.map(v => Math.round(v * 1e4) / 1e4),
    lateral_g: latG.map(v => Math.round(v * 1e4) / 1e4),
  };
}

function computeFasterSegments(speeds: number[][]): boolean[][] {
  return speeds.map((driverSpeeds, di) =>
    driverSpeeds.map((spd, i) => {
      let fastest = true;
      for (let j = 0; j < speeds.length; j++) {
        if (j !== di && speeds[j][i] > spd) { fastest = false; break; }
      }
      return fastest;
    })
  );
}

const DRS_OPEN = new Set([10, 12, 14]);

// Spec priority order — codes are stable and rendered by ChartStack's ACTION_CATEGORIES.
function computeActions(throttle: number[], brake: number[], lateralG: number[]): number[] {
  return throttle.map((t, i) => {
    if (brake[i] > 0) return 0;                  // Braking
    if (t >= 98) return 1;                       // Full Throttle
    if (t <= 5) return 2;                        // Lift & Coast
    if (Math.abs(lateralG[i] ?? 0) >= 1.5) return 3; // Cornering
    return 4;                                    // Rolling
  });
}

function computeVerticalG(elevation: number[], time: number[]): number[] {
  if (elevation.length !== NUM_POINTS) return [];
  const dt = npGrad(time).map(v => (Math.abs(v) < 1e-6 ? 1e-6 : v));
  const vz = npGrad(elevation).map((dz, i) => dz / dt[i]);
  const az = npGrad(vz).map((dv, i) => dv / dt[i] / 9.81);
  return clamp(movingAvg(az), -6, 6).map(v => Math.round(v * 1e4) / 1e4);
}

// Time gap to the car ahead: how long this driver, on this lap's own
// time-vs-distance profile, takes to reach the spot where the car ahead is now.
// (Dividing the distance by instantaneous speed instead spikes in every slow
// corner.) Points past the line wrap onto the same lap profile.
function computeGapAhead(distAhead: number[], dist: number[], time: number[]): number[] {
  const n = dist.length;
  if (n < 2) return distAhead.map(() => NaN);
  const lapLen = dist[n - 1];
  const lapTime = time[n - 1] - time[0];
  const timeAt = (x: number): number => {
    const laps = Math.floor(x / lapLen);
    const [t] = linearInterp(dist, time, [x - laps * lapLen]);
    return t + laps * lapTime;
  };
  return distAhead.map((d, i) => {
    if (!Number.isFinite(d) || d < 0) return NaN;
    return Math.round((timeAt(dist[i] + d) - time[i]) * 1e3) / 1e3;
  });
}

// ─── Raw telemetry CDN file shape ─────────────────────────────────────────────

interface RawTelFile {
  distance: number[];
  speed: number[];
  throttle: number[];
  rpm: number[];
  gear: number[];
  brake: number[];
  drs: number[];
  time: number[];
  x: number[];
  y: number[];
  z?: number[];
  driver_ahead?: string[];        // driver numbers; '' = none
  dist_ahead?: (number | null)[]; // meters; null = unknown
}

// ─── Hook Types ───────────────────────────────────────────────────────────────

export interface UseTelemetryReturn {
  years: number[];
  events: EventInfo[];
  sessions: SessionInfo[];
  drivers: DriverListItem[];
  driversLaps: Record<string, LapInfo[]>;
  telemetryData: TelemetryData | null;

  loadingYears: boolean;
  loadingEvents: boolean;
  loadingSessions: boolean;
  loadingDrivers: boolean;
  loadingDriverLaps: Record<string, boolean>;
  loadingTelemetry: boolean;

  error: string | null;
  clearError: () => void;

  fetchEvents: (year: number) => Promise<void>;
  fetchSessions: (year: number, event: string, slug: string) => Promise<void>;
  fetchDrivers: (year: number, slug: string, session: string) => Promise<void>;
  fetchDriverLaps: (year: number, slug: string, session: string, driver: string) => Promise<void>;
  fetchTelemetry: (request: TelemetryRequest) => Promise<void>;
  clearTelemetry: () => void;
}

// ─── Main Hook ────────────────────────────────────────────────────────────────

export function useTelemetry(): UseTelemetryReturn {
  const [years, setYears] = useState<number[]>([]);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [drivers, setDrivers] = useState<DriverListItem[]>([]);
  const [driversLaps, setDriversLaps] = useState<Record<string, LapInfo[]>>({});
  const [telemetryData, setTelemetryData] = useState<TelemetryData | null>(null);

  const [loadingYears, setLoadingYears] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [loadingDriverLaps, setLoadingDriverLaps] = useState<Record<string, boolean>>({});
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  // Latest values for fetchTelemetry. Refs, not mirrored state: a mirror lags
  // one render, so a compare fired right after laps load would see stale laps.
  const driversRef = useRef(drivers);
  driversRef.current = drivers;
  const driversLapsRef = useRef(driversLaps);
  driversLapsRef.current = driversLaps;


  // ─── Years ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingYears(true);
      try {
        const data = await cdnGet<number[]>('index.json');
        if (!cancelled) setYears(data);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoadingYears(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Events ────────────────────────────────────────────────────────────────
  const fetchEvents = useCallback(async (year: number) => {
    setLoadingEvents(true);
    setEvents([]); setSessions([]); setDrivers([]); setDriversLaps({});
    setError(null);
    try {
      const data = await cdnGet<EventInfo[]>(`${year}/events.json`);
      setEvents(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  // ─── Sessions ──────────────────────────────────────────────────────────────
  const fetchSessions = useCallback(async (_year: number, _event: string, slug: string) => {
    setLoadingSessions(true);
    setSessions([]); setDrivers([]); setDriversLaps({});
    setError(null);
    try {
      const data = await cdnGet<SessionInfo[]>(`${_year}/${slug}/sessions.json`);
      setSessions(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  // ─── Drivers ───────────────────────────────────────────────────────────────
  const fetchDrivers = useCallback(async (year: number, slug: string, session: string) => {
    setLoadingDrivers(true);
    setDrivers([]); setDriversLaps({});
    setError(null);
    try {
      const data = await cdnGet<DriverListItem[]>(`${year}/${slug}/${session}/drivers.json`);
      setDrivers(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  // ─── Driver Laps ───────────────────────────────────────────────────────────
  const fetchDriverLaps = useCallback(
    async (year: number, slug: string, session: string, driver: string) => {
      setLoadingDriverLaps(prev => ({ ...prev, [driver]: true }));
      setError(null);
      try {
        const data = await cdnGet<LapInfo[]>(`${year}/${slug}/${session}/laps/${driver}.json`);
        setDriversLaps(prev => ({ ...prev, [driver]: data }));
      } catch (err) {
        setError(String(err));
      } finally {
        setLoadingDriverLaps(prev => ({ ...prev, [driver]: false }));
      }
    },
    []
  );

  // ─── Telemetry — 100% CDN, no backend ─────────────────────────────────────
  const fetchTelemetry = useCallback(async (request: TelemetryRequest) => {
    setLoadingTelemetry(true);
    setTelemetryData(null);
    setError(null);

    try {
      const { year, slug, session, drivers: driverAbbrs, laps } = request;
      const _drivers = driversRef.current;
      const _driversLaps = driversLapsRef.current;

      // Resolve 'fastest' to actual lap numbers using loaded laps state
      const resolvedLaps = driverAbbrs.map((abbr, i) => {
        const lap = laps[i];
        if (lap === 'fastest') {
          const dLaps = _driversLaps[abbr] ?? [];
          const fastest = dLaps.find(l => l.is_fastest && l.is_valid)
            ?? dLaps.find(l => l.is_valid);
          return fastest?.lap_number ?? null;
        }
        return lap as number;
      });

      if (resolvedLaps.some(l => l === null)) {
        throw new Error('Could not resolve fastest lap for one or more drivers');
      }

      // Fetch all telemetry files in parallel
      const telFiles = await Promise.all(
        driverAbbrs.map((abbr, i) =>
          cdnGet<RawTelFile>(`${year}/${slug}/${session}/telemetry/${abbr}_${resolvedLaps[i]}.json`)
        )
      );

      // Fetch corners (best-effort)
      let corners: CornerInfo[] = [];
      try {
        corners = await cdnGet<CornerInfo[]>(`${year}/${slug}/${session}/corners.json`);
      } catch { /* corners are optional */ }

      // Common distance grid: use shortest lap distance
      const maxDists = telFiles.map(t => t.distance[t.distance.length - 1]);
      const commonMaxDist = Math.min(...maxDists);
      const commonDist = linspace(0, commonMaxDist, NUM_POINTS);

      // Normalize all channels to common grid for each driver
      const normalized = telFiles.map(tel => {
        const d = tel.distance;
        return {
          speed:    linearInterp(d, tel.speed,    commonDist),
          throttle: linearInterp(d, tel.throttle, commonDist),
          rpm:      linearInterp(d, tel.rpm,      commonDist),
          time:     linearInterp(d, tel.time,     commonDist),
          gear:     nearestBefore(d, tel.gear,    commonDist),
          brake:    nearestBefore(d, tel.brake,   commonDist),
          x:        tel.x.length ? linearInterp(d, tel.x, commonDist) : [],
          y:        tel.y.length ? linearInterp(d, tel.y, commonDist) : [],
          drs:      tel.drs && tel.drs.length
            ? nearestBefore(d, tel.drs.map(v => (DRS_OPEN.has(v) ? 1 : 0)), commonDist)
            : new Array(NUM_POINTS).fill(0),
          elevation: tel.z && tel.z.length ? linearInterp(d, tel.z, commonDist) : [],
          // null → NaN so interpolation leaves a gap instead of drawing to zero
          dist_ahead: tel.dist_ahead && tel.dist_ahead.length
            ? linearInterp(d, tel.dist_ahead.map(v => (v === null ? NaN : v)), commonDist)
            : [],
          driver_ahead: tel.driver_ahead && tel.driver_ahead.length
            ? nearestBefore(d, tel.driver_ahead, commonDist)
            : [],
        };
      });

      // Compute delta time vs driver 0
      const refTime = normalized[0].time;
      const deltaTime = normalized.map(n => n.time.map((t, i) => t - refTime[i]));

      // Compute accelerations per driver
      const accels = normalized.map(n =>
        computeAccelerations(n.speed, n.time, n.x, n.y)
      );

      // Compute faster segments
      const speeds = normalized.map(n => n.speed);
      const fasterSegs = computeFasterSegments(speeds);

      // Compute vertical G-forces and actions
      const verticalGs = normalized.map(n => computeVerticalG(n.elevation, n.time));
      const actions = normalized.map((n, i) =>
        computeActions(n.throttle, n.brake, accels[i].lateral_g)
      );

      // Look up driver metadata from loaded state
      const driverMeta = driverAbbrs.map(abbr =>
        _drivers.find(d => d.abbreviation === abbr) ?? {
          abbreviation: abbr, full_name: abbr, number: '', team: '', team_color: '#FFFFFF',
        }
      );

      // Telemetry names the car ahead by racing number; show abbreviations instead.
      const abbrByNumber = new Map(_drivers.map(d => [d.number, d.abbreviation]));
      const gapsAhead = normalized.map(n => computeGapAhead(n.dist_ahead, commonDist, n.time));

      // Look up lap times
      const lapTimes = driverAbbrs.map((abbr, i) => {
        const dLaps = _driversLaps[abbr] ?? [];
        const lap = dLaps.find(l => l.lap_number === resolvedLaps[i]);
        return lap?.lap_time ?? 'N/A';
      });

      // Build TelemetryData matching the existing type
      const response: TelemetryData = {
        distance: commonDist,
        track: {
          x: normalized[0].x,
          y: normalized[0].y,
        },
        circuit_info: {
          corners,
          marshal_lights: [],
          marshal_sectors: [],
          rotation: 0,
        },
        drivers: driverAbbrs.map((abbr, i) => ({
          abbreviation: abbr,
          full_name: driverMeta[i].full_name,
          number: driverMeta[i].number,
          team: driverMeta[i].team,
          team_color: driverMeta[i].team_color,
          lap_number: resolvedLaps[i] as number,
          lap_time: lapTimes[i],
          channels: {
            speed:           normalized[i].speed,
            throttle:        normalized[i].throttle,
            rpm:             normalized[i].rpm,
            gear:            normalized[i].gear,
            brake:           normalized[i].brake,
            delta_time:      deltaTime[i],
            lateral_g:       accels[i].lateral_g,
            longitudinal_g:  accels[i].longitudinal_g,
            faster_segments: fasterSegs[i].map(v => v ? 1 : 0),
            drs:             normalized[i].drs,
            actions:         actions[i],
            elevation:       normalized[i].elevation,
            vertical_g:      verticalGs[i],
            dist_ahead:      normalized[i].dist_ahead,
            gap_ahead:       gapsAhead[i],
            driver_ahead:    normalized[i].driver_ahead.map(num => (num ? abbrByNumber.get(num) ?? `#${num}` : '')),
          },
        })),
      };

      setTelemetryData(response);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingTelemetry(false);
    }
  }, []);

  const clearTelemetry = useCallback(() => {
    setTelemetryData(null);
    setError(null);
  }, []);

  return {
    years,
    events,
    sessions,
    drivers,
    driversLaps,
    telemetryData,
    loadingYears,
    loadingEvents,
    loadingSessions,
    loadingDrivers,
    loadingDriverLaps,
    loadingTelemetry,
    error,
    clearError,
    fetchEvents,
    fetchSessions,
    fetchDrivers,
    fetchDriverLaps,
    fetchTelemetry,
    clearTelemetry,
  };
}
