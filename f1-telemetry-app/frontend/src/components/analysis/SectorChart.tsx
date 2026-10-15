import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { formatLapTime, groupByDriver, isPaceLap } from '../../utils/sessionAnalysis';
import ChartCard, { Toggle, type AnalysisContext } from './ChartCard';
import PlotlyChart, { axis, baseLayout } from './PlotlyChart';
import { traceVisibility } from './LapTimesChart';

const SECTORS = ['s1', 's2', 's3'] as const;
type SectorKey = typeof SECTORS[number];

export default function SectorChart({ ctx }: { ctx: AnalysisContext }) {
  const [on, setOn] = useState<Record<SectorKey, boolean>>({ s1: true, s2: true, s3: true });
  const [hideOutliers, setHideOutliers] = useState(true);

  const active = SECTORS.filter(s => on[s]);

  const { data, layout, bestRows } = useMemo(() => {
    const byDriver = groupByDriver(ctx.data.laps);
    const drivers = ctx.order.filter(d => byDriver.has(d));
    const gap = 0.04;
    const h = (1 - gap * (active.length - 1)) / Math.max(1, active.length);

    const traces: Data[] = [];
    const lay: Partial<Layout> = baseLayout(ctx.isDark, { margin: { t: 16, r: 16, b: 48, l: 60 } });
    const bestRows: Array<{ sector: string; driver: string; time: number }> = [];

    active.forEach((sector, row) => {
      const all = ctx.data.laps.map(l => l[sector]).filter((v): v is number => v !== null);
      const best = all.length ? Math.min(...all) : null;
      const cap = hideOutliers && best ? best * 1.07 : Infinity;
      const n = row + 1;
      const ax = n === 1 ? '' : String(n);

      let rowBest: { driver: string; time: number } | null = null;
      drivers.forEach(driver => {
        const laps = byDriver.get(driver)!.filter(l => isPaceLap(l) && l[sector] !== null && l[sector]! <= cap);
        for (const l of laps) if (!rowBest || l[sector]! < rowBest.time) rowBest = { driver, time: l[sector]! };
        traces.push({
          type: 'scatter', mode: 'lines+markers', name: driver, legendgroup: driver, showlegend: row === 0,
          x: laps.map(l => l.lap), y: laps.map(l => l[sector]),
          xaxis: `x${ax}`, yaxis: `y${ax}`,
          visible: traceVisibility(ctx, driver, 3),
          line: { color: ctx.colors[driver], width: 1.5 }, marker: { size: 5, color: ctx.colors[driver] },
          hovertemplate: `<b>${driver}</b> · Lap %{x}<br>${sector.toUpperCase()} %{y:.3f}s<extra></extra>`,
        } as Data);
      });
      if (rowBest) bestRows.push({ sector: sector.toUpperCase(), ...(rowBest as { driver: string; time: number }) });

      const top = 1 - row * (h + gap);
      (lay as Record<string, unknown>)[`xaxis${ax}`] = axis(ctx.isDark, row === active.length - 1 ? 'Lap' : '', {
        anchor: `y${ax}`, ...(n > 1 ? { matches: 'x' } : {}), showticklabels: row === active.length - 1,
      });
      (lay as Record<string, unknown>)[`yaxis${ax}`] = axis(ctx.isDark, `${sector.toUpperCase()} (s)`, {
        domain: [Math.max(0, top - h), top], anchor: `x${ax}`,
      });
    });

    return { data: traces, layout: lay, bestRows };
  }, [ctx, active.join(','), hideOutliers]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ChartCard
      title="Sector Analysis"
      description="Sector 1, 2 and 3 times lap by lap. The fastest sector of the session is listed under the chart."
      ctx={ctx}
      controls={<>
        {SECTORS.map(s => (
          <Toggle key={s} label={s.toUpperCase()} checked={on[s]}
            onChange={v => setOn(prev => ({ ...prev, [s]: v }))} />
        ))}
        <Toggle label="Hide outliers (107%)" checked={hideOutliers} onChange={setHideOutliers} />
      </>}
    >
      {elRef => (
        <>
          {active.length === 0
            ? <p className="p-6 text-center text-sm text-[var(--text-secondary)]">Select at least one sector.</p>
            : <PlotlyChart data={data} layout={layout} height={160 + active.length * 150} elRef={elRef} />}
          {bestRows.length > 0 && (
            <div className="flex flex-wrap gap-4 border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--text-secondary)]">
              {bestRows.map(r => (
                <span key={r.sector}>
                  Best {r.sector}: <b style={{ color: ctx.colors[r.driver] }}>{r.driver}</b>{' '}
                  <span className="font-mono text-[var(--text-primary)]">{formatLapTime(r.time)}</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </ChartCard>
  );
}
