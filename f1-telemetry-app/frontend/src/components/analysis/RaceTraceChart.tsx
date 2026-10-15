import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { cumulativeTimes, fastestTime, groupByDriver, trackStatusBands } from '../../utils/sessionAnalysis';
import ChartCard, { Toggle, type AnalysisContext } from './ChartCard';
import PlotlyChart, { axis, baseLayout } from './PlotlyChart';
import { statusShapes } from './LapTimesChart';

/**
 * Gap of every car to the winner's average race pace, lap by lap. A flat line
 * means running at the winner's average; rising means faster, falling slower.
 * Pit stops show up as the steps down, safety cars as the field bunching up.
 */
export default function RaceTraceChart({ ctx }: { ctx: AnalysisContext }) {
  const [showStatus, setShowStatus] = useState(true);
  const bands = useMemo(() => trackStatusBands(ctx.data.laps), [ctx.data.laps]);

  const { data, layout, reference } = useMemo(() => {
    const cum = cumulativeTimes(ctx.data.laps);
    const byDriver = groupByDriver(ctx.data.laps);
    const reference = ctx.order.find(d => (cum.get(d)?.size ?? 0) > 0) ?? '';
    const ref = cum.get(reference);
    const refLaps = ref ? Math.max(...ref.keys()) : 0;
    const pace = ref && refLaps ? ref.get(refLaps)! / refLaps : 0;

    const best = fastestTime(ctx.data.laps);
    const fastestLap = ctx.data.laps.find(l => l.time !== null && l.time === best);
    const dim = ctx.focus.length > 0;

    const traces: Data[] = [];
    ctx.order.forEach(driver => {
      const m = cum.get(driver);
      if (!m || m.size === 0) return;
      const laps = Array.from(m.keys()).sort((a, b) => a - b);
      const gap = (lap: number) => lap * pace - m.get(lap)!;
      const focused = !dim || ctx.focus.includes(driver);

      traces.push({
        type: 'scatter', mode: 'lines', name: driver, legendgroup: driver,
        x: [0, ...laps], y: [0, ...laps.map(gap)],
        line: { color: ctx.colors[driver], width: focused ? 2.5 : 1.2 },
        opacity: focused ? 1 : 0.35,
        hovertemplate: `<b>${driver}</b> · Lap %{x}<br>%{y:+.1f}s vs ${reference} avg pace<extra></extra>`,
      } as Data);

      // Pit stops: marker on the in-lap.
      const pits = (byDriver.get(driver) ?? []).filter(l => l.pitIn && m.has(l.lap));
      if (pits.length) {
        traces.push({
          type: 'scatter', mode: 'markers', legendgroup: driver, showlegend: false,
          x: pits.map(l => l.lap), y: pits.map(l => gap(l.lap)),
          marker: { symbol: 'square', size: 8, color: '#F97316', line: { color: ctx.colors[driver], width: 1.5 } },
          opacity: focused ? 1 : 0.35,
          hovertemplate: `<b>${driver}</b> pit stop · Lap %{x}<extra></extra>`,
        } as Data);
      }
    });

    if (fastestLap && cum.get(fastestLap.driver)?.has(fastestLap.lap)) {
      const m = cum.get(fastestLap.driver)!;
      traces.push({
        type: 'scatter', mode: 'markers', name: 'Fastest lap', showlegend: false,
        x: [fastestLap.lap], y: [fastestLap.lap * pace - m.get(fastestLap.lap)!],
        marker: { symbol: 'star', size: 15, color: '#A855F7', line: { color: '#FFFFFF', width: 1 } },
        hovertemplate: `<b>Fastest lap</b> · ${fastestLap.driver} · Lap %{x}<extra></extra>`,
      } as Data);
    }

    const status = showStatus ? statusShapes(bands, ctx.isDark) : { shapes: [], annotations: [] };
    const lay = baseLayout(ctx.isDark, {
      xaxis: axis(ctx.isDark, 'Lap') as Layout['xaxis'],
      yaxis: axis(ctx.isDark, `Gap to ${reference} average pace (s)`, { zeroline: true, zerolinewidth: 1.5 }) as Layout['yaxis'],
      legend: { orientation: 'v', x: 1.01, xanchor: 'left', y: 1, bgcolor: 'transparent', font: { size: 10 } },
      margin: { t: 24, r: 8, b: 48, l: 60 },
      ...status,
    });
    return { data: traces, layout: lay, reference };
  }, [ctx, bands, showStatus]);

  return (
    <ChartCard
      title="Race Trace"
      description={`Gap of each car to ${reference || 'the winner'}'s average pace. Above zero is ahead of that pace. Orange squares are pit stops, the star is the fastest lap.`}
      ctx={ctx}
      controls={bands.length > 0
        ? <Toggle label="Show SC / VSC / red flag" checked={showStatus} onChange={setShowStatus} />
        : undefined}
    >
      {elRef => <PlotlyChart data={data} layout={layout} height={480} elRef={elRef} />}
    </ChartCard>
  );
}
