import { useEffect, useState } from 'react';
import type { DriverListItem, LapInfo, SessionAnalysis, WeatherData } from '../types/telemetry';
import { cdnGet, cdnGetOptional } from './useTelemetry';
import {
  isRaceSession, lapsFromAnalysis, lapsFromLapFiles, withDerivedPositions,
  type RawAnalysisFile,
} from '../utils/sessionAnalysis';

// How long analysis.json gets before we also start rebuilding from laps/*.json.
// A file that exists comes back well within this; a missing one takes jsDelivr
// ~6 s to 404 (the other mirrors fail CORS on 404s), which is too long to stare
// at a skeleton for older sessions.
const ANALYSIS_HEAD_START_MS = 1200;

// Best data seen per session; session data never changes once ingested.
const cache = new Map<string, SessionAnalysis>();

async function deriveFromLapFiles(base: string, drivers: DriverListItem[], race: boolean) {
  // A driver whose file is missing (DNS, no laps) is skipped rather than failing the view.
  const settled = await Promise.allSettled(
    drivers.map(d => cdnGet<LapInfo[]>(`${base}/laps/${d.abbreviation}.json`)),
  );
  const perDriver: Record<string, LapInfo[]> = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length) perDriver[drivers[i].abbreviation] = r.value;
  });
  if (Object.keys(perDriver).length === 0) throw new Error('No lap data for this session');
  const laps = lapsFromLapFiles(perDriver);
  return { laps: race ? withDerivedPositions(laps) : laps, results: [] };
}

export function useSessionAnalysis(
  year: number | null, slug: string, session: string | null, drivers: DriverListItem[],
) {
  const [data, setData] = useState<SessionAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = year !== null && !!slug && session !== null && drivers.length > 0;
  // The driver list is part of the key: for one render after a session change
  // `drivers` can still hold the previous session's list.
  const key = ready ? `${year}/${slug}/${session}|${drivers.map(d => d.abbreviation).join(',')}` : '';

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(false);
    if (!ready) return;

    const hit = cache.get(key);
    if (hit) { setData(hit); return; }

    let cancelled = false;
    const race = isRaceSession(session);
    const base = `${year}/${slug}/${session}`;
    // Mutable box: the callbacks below update it after this effect body returns.
    const latest: { best: SessionAnalysis | null } = { best: null };
    let weather: WeatherData | null = null;

    const publish = (next: SessionAnalysis) => {
      latest.best = next;
      cache.set(key, next);
      if (!cancelled) { setData(next); setLoading(false); }
    };

    setLoading(true);

    cdnGetOptional<WeatherData>(`${base}/weather.json`).then(w => {
      weather = w;
      if (latest.best && w) publish({ ...latest.best, weather: w });
    });

    const analysis = cdnGetOptional<RawAnalysisFile>(`${base}/analysis.json`).then(raw => {
      if (!raw || !raw.laps?.length) return false;
      const { laps, results } = lapsFromAnalysis(raw);
      publish({ source: 'analysis', laps: race ? withDerivedPositions(laps) : laps, results, weather });
      return true;
    }).catch(() => false);

    (async () => {
      const found = await Promise.race([
        analysis,
        new Promise<null>(r => setTimeout(() => r(null), ANALYSIS_HEAD_START_MS)),
      ]);
      if (found === true || cancelled) return;
      try {
        const derived = await deriveFromLapFiles(base, drivers, race);
        // analysis.json may have landed while the lap files were downloading.
        if (latest.best?.source !== 'analysis') publish({ source: 'derived', ...derived, weather });
      } catch (e) {
        if (!(await analysis) && !cancelled) { setError(String(e)); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
    // The key already captures year/slug/session/drivers; depending on the
    // array identity would refetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading, error };
}
