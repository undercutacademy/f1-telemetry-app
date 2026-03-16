import { useState, useEffect, useCallback } from 'react';
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

const MIRRORS = [
  (p: string) => `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/${p}`,
  (p: string) => `https://cdn.statically.io/gh/${REPO}/${BRANCH}/${p}`,
  (p: string) => `https://rawcdn.githack.com/${REPO}/${BRANCH}/${p}`,
];

async function cdnGet<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(mirror(path));
      if (res.ok) return res.json() as Promise<T>;
      lastErr = new Error(`${res.status} ${mirror(path)}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`CDN fetch failed: ${path} — ${lastErr}`);
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

function nearestBefore(srcDist: number[], srcVals: number[], targetDist: number[]): number[] {
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

  const [_events, _setEvents] = useState<EventInfo[]>([]);
  const [_drivers, _setDrivers] = useState<DriverListItem[]>([]);
  const [_driversLaps, _setDriversLaps] = useState<Record<string, LapInfo[]>>({});

  // keep internal refs in sync for use inside callbacks
  useEffect(() => { _setEvents(events); }, [events]);
  useEffect(() => { _setDrivers(drivers); }, [drivers]);
  useEffect(() => { _setDriversLaps(driversLaps); }, [driversLaps]);

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

      // Look up driver metadata from loaded state
      const driverMeta = driverAbbrs.map(abbr =>
        _drivers.find(d => d.abbreviation === abbr) ?? {
          abbreviation: abbr, full_name: abbr, number: '', team: '', team_color: '#FFFFFF',
        }
      );

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
          },
        })),
      };

      setTelemetryData(response);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingTelemetry(false);
    }
  }, [_driversLaps, _drivers]);

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
