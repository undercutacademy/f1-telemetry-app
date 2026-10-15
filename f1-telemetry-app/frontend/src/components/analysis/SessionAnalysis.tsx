import { useMemo, useState } from 'react';
import type { DriverListItem } from '../../types/telemetry';
import { useSessionAnalysis } from '../../hooks/useSessionAnalysis';
import { driverColorMap, finishingOrder, isRaceSession, paceOrder } from '../../utils/sessionAnalysis';
import { SkeletonBlock } from '../LoadingState';
import type { AnalysisContext } from './ChartCard';
import LapTimesChart from './LapTimesChart';
import LapHeatmap from './LapHeatmap';
import StintChart from './StintChart';
import SectorChart from './SectorChart';
import StrategyChart from './StrategyChart';
import RaceTraceChart from './RaceTraceChart';
import PositionsChart from './PositionsChart';
import WeatherChart from './WeatherChart';

interface SessionAnalysisProps {
  year: number;
  eventName: string;
  slug: string;
  sessionType: string;
  sessionName: string;
  drivers: DriverListItem[];
  focus: string[];
  theme: 'dark' | 'light';
  onPickLap: (abbr: string, lap: number) => void;
}

type TabKey = 'laps' | 'heatmap' | 'stints' | 'sectors' | 'strategy' | 'trace' | 'positions' | 'weather';

const TAB_STORAGE = 'oat-f1.analysis-tab';

export default function SessionAnalysis({
  year, eventName, slug, sessionType, sessionName, drivers, focus, theme, onPickLap,
}: SessionAnalysisProps) {
  const { data, loading, error } = useSessionAnalysis(year, slug, sessionType, drivers);
  const race = isRaceSession(sessionType);

  const [tab, setTab] = useState<TabKey>(() => {
    try { return (localStorage.getItem(TAB_STORAGE) as TabKey) || 'laps'; } catch { return 'laps'; }
  });
  const choose = (t: TabKey) => {
    setTab(t);
    try { localStorage.setItem(TAB_STORAGE, t); } catch { /* private mode */ }
  };

  const ctx = useMemo((): AnalysisContext | null => {
    if (!data) return null;
    return {
      data,
      drivers,
      isDark: theme === 'dark',
      colors: driverColorMap(drivers, theme, focus),
      focus: focus.filter(f => drivers.some(d => d.abbreviation === f)),
      order: race ? finishingOrder(data.laps, data.results) : paceOrder(data.laps),
      sessionType,
      label: `${year} ${eventName} · ${sessionName}`,
      onPickLap,
    };
  }, [data, drivers, theme, focus.join(','), race, sessionType, year, eventName, sessionName, onPickLap]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'laps', label: 'Lap Times' },
    { key: 'heatmap', label: 'Heatmap' },
    { key: 'stints', label: 'Stints' },
    { key: 'sectors', label: 'Sectors' },
    { key: 'strategy', label: 'Tyre Strategy' },
    ...(race ? [{ key: 'trace' as const, label: 'Race Trace' }, { key: 'positions' as const, label: 'Positions' }] : []),
    ...(data?.weather ? [{ key: 'weather' as const, label: 'Weather' }] : []),
  ];
  // A remembered tab may not exist for this session (e.g. Race Trace in qualifying).
  const current = tabs.some(t => t.key === tab) ? tab : 'laps';

  return (
    <section className="mt-6" aria-label="Session analysis">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Session Analysis · {eventName} · {sessionName}
        </h2>
      </div>

      <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1" role="tablist">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={current === t.key}
            onClick={() => choose(t.key)}
            className={'flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ' + (current === t.key
              ? 'bg-red-600 text-white'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-chart)] hover:text-[var(--text-primary)]')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg-chart)] p-4">
          <SkeletonBlock height="h-6" />
          <SkeletonBlock height="h-72" />
        </div>
      )}
      {error && !loading && (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--bg-chart)] p-6 text-center text-sm text-[var(--text-secondary)]">
          Session analysis isn't available for this session ({error}).
        </p>
      )}

      {ctx && !loading && (
        <>
          {current === 'laps' && <LapTimesChart ctx={ctx} />}
          {current === 'heatmap' && <LapHeatmap ctx={ctx} />}
          {current === 'stints' && <StintChart ctx={ctx} />}
          {current === 'sectors' && <SectorChart ctx={ctx} />}
          {current === 'strategy' && <StrategyChart ctx={ctx} />}
          {current === 'trace' && <RaceTraceChart ctx={ctx} />}
          {current === 'positions' && <PositionsChart ctx={ctx} />}
          {current === 'weather' && ctx.data.weather && <WeatherChart ctx={ctx} weather={ctx.data.weather} />}
        </>
      )}
    </section>
  );
}
