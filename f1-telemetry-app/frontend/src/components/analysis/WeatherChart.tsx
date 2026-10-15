import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import type { WeatherData } from '../../types/telemetry';
import ChartCard, { type AnalysisContext } from './ChartCard';
import PlotlyChart, { axis, baseLayout } from './PlotlyChart';

// Metrics sharing a unit share a panel, so switching one on never needs a second axis.
const GROUPS: Array<{
  key: string; label: string; unit: string;
  series: Array<{ field: keyof WeatherData; name: string; color: string }>;
}> = [
  { key: 'temp', label: 'Temperature', unit: '°C', series: [
    { field: 'track_temp', name: 'Track', color: '#E34948' },
    { field: 'air_temp', name: 'Air', color: '#2A78D6' },
  ] },
  { key: 'humidity', label: 'Humidity', unit: '%', series: [{ field: 'humidity', name: 'Humidity', color: '#14B8A6' }] },
  { key: 'wind', label: 'Wind speed', unit: 'm/s', series: [{ field: 'wind_speed', name: 'Wind', color: '#A855F7' }] },
  { key: 'pressure', label: 'Pressure', unit: 'mbar', series: [{ field: 'pressure', name: 'Pressure', color: '#898781' }] },
  { key: 'rain', label: 'Rainfall', unit: 'rain', series: [{ field: 'rainfall', name: 'Rain', color: '#0067FF' }] },
];

export default function WeatherChart({ ctx, weather }: { ctx: AnalysisContext; weather: WeatherData }) {
  const [on, setOn] = useState<Record<string, boolean>>({ temp: true, humidity: false, wind: false, pressure: false, rain: true });
  const active = GROUPS.filter(g => on[g.key]);
  const rained = weather.rainfall.some(v => v === 1);

  const { data, layout } = useMemo(() => {
    const t0 = weather.time[0] ?? 0;
    const minutes = weather.time.map(t => Math.round(((t - t0) / 60) * 10) / 10);
    const gap = 0.05;
    const h = (1 - gap * (active.length - 1)) / Math.max(1, active.length);
    const traces: Data[] = [];
    const lay: Partial<Layout> = baseLayout(ctx.isDark, {
      margin: { t: 16, r: 16, b: 48, l: 60 },
      hovermode: 'x unified',
      legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.02, yanchor: 'bottom', bgcolor: 'transparent' },
    });

    active.forEach((g, row) => {
      const ax = row === 0 ? '' : String(row + 1);
      g.series.forEach(s => {
        const isRain = g.key === 'rain';
        traces.push({
          type: 'scatter', mode: 'lines', name: s.name,
          x: minutes, y: weather[s.field] as (number | null)[],
          xaxis: `x${ax}`, yaxis: `y${ax}`,
          line: { color: s.color, width: 2, shape: isRain ? 'hv' : 'spline' },
          ...(isRain ? { fill: 'tozeroy' } : {}),
          hovertemplate: isRain ? '%{y:.0f}' : `%{y:.1f} ${g.unit}`,
        } as Data);
      });
      const top = 1 - row * (h + gap);
      (lay as Record<string, unknown>)[`xaxis${ax}`] = axis(ctx.isDark, row === active.length - 1 ? 'Minutes into session' : '', {
        anchor: `y${ax}`, ...(row > 0 ? { matches: 'x' } : {}), showticklabels: row === active.length - 1,
      });
      (lay as Record<string, unknown>)[`yaxis${ax}`] = axis(ctx.isDark, g.key === 'rain' ? 'Rain' : `${g.label} (${g.unit})`, {
        domain: [Math.max(0, top - h), top], anchor: `x${ax}`,
        ...(g.key === 'rain' ? { range: [-0.05, 1.1], tickvals: [0, 1], ticktext: ['dry', 'rain'], fixedrange: true } : {}),
      });
    });
    return { data: traces, layout: lay };
  }, [weather, ctx.isDark, active.map(g => g.key).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ChartCard
      title="Weather"
      description={`Conditions across the session, sampled about once a minute.${rained ? ' Rain was recorded during this session.' : ''}`}
      ctx={ctx}
      controls={GROUPS.map(g => (
        <button key={g.key} type="button" onClick={() => setOn(p => ({ ...p, [g.key]: !p[g.key] }))}
          className={'rounded-full border px-2.5 py-0.5 text-[11px] font-medium ' + (on[g.key]
            ? 'border-transparent bg-[var(--text-primary)] text-[var(--bg-chart)]'
            : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}>
          {g.label}
        </button>
      ))}
    >
      {elRef => active.length === 0
        ? <p className="p-6 text-center text-sm text-[var(--text-secondary)]">Select at least one metric.</p>
        : <PlotlyChart data={data} layout={layout} height={120 + active.length * 150} elRef={elRef} />}
    </ChartCard>
  );
}
