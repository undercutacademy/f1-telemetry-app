import { useMemo } from 'react';
import type { Data, Layout } from 'plotly.js';
import { fastestTime, formatLapTime, groupByDriver } from '../../utils/sessionAnalysis';
import ChartCard, { type AnalysisContext } from './ChartCard';
import PlotlyChart, { axis, baseLayout } from './PlotlyChart';

export default function LapHeatmap({ ctx }: { ctx: AnalysisContext }) {
  const { data, layout, height, best } = useMemo(() => {
    const byDriver = groupByDriver(ctx.data.laps);
    const drivers = ctx.order.filter(d => byDriver.has(d));
    const maxLap = Math.max(1, ...ctx.data.laps.map(l => l.lap));
    const laps = Array.from({ length: maxLap }, (_, i) => i + 1);
    const best = fastestTime(ctx.data.laps.filter(l => l.lap > 1)) ?? fastestTime(ctx.data.laps);

    const z: (number | null)[][] = [];
    const text: string[][] = [];
    drivers.forEach(driver => {
      const m = new Map(byDriver.get(driver)!.map(l => [l.lap, l]));
      z.push(laps.map(n => m.get(n)?.time ?? null));
      text.push(laps.map(n => {
        const l = m.get(n);
        if (!l) return '';
        const pit = l.pitIn ? ' · pit in' : l.pitOut ? ' · pit out' : '';
        const tel = l.hasTelemetry ? 'click for telemetry' : 'no telemetry';
        return `${formatLapTime(l.time)}<br>${l.compound} · ${l.tyreLife} laps old${pit}<br><i>${tel}</i>`;
      }));
    });

    const trace = {
      type: 'heatmap',
      x: laps,
      y: drivers.map((_, i) => i),
      z,
      text,
      // Fast = blue/cool, slow = red/warm (Plotly's RdBu already runs blue → red
      // from low to high). Clipping at 107% keeps pit and SC laps from
      // flattening the scale for the laps that matter.
      colorscale: 'RdBu',
      zmin: best ?? undefined,
      zmax: best ? best * 1.07 : undefined,
      xgap: 1,
      ygap: 1,
      hoverongaps: false,
      customdata: drivers.map(d => laps.map(n => [d, n])),
      hovertemplate: '<b>%{customdata[0]}</b> · Lap %{x}<br>%{text}<extra></extra>',
      colorbar: { title: { text: 's', side: 'right' }, thickness: 10, len: 0.9, tickfont: { size: 9 } },
    } as unknown as Data;

    const height = Math.max(260, drivers.length * 24 + 90);
    const lay = baseLayout(ctx.isDark, {
      xaxis: axis(ctx.isDark, 'Lap', { showgrid: false, dtick: maxLap > 40 ? 5 : 2 }) as Layout['xaxis'],
      yaxis: axis(ctx.isDark, '', {
        tickmode: 'array', tickvals: drivers.map((_, i) => i), ticktext: drivers,
        autorange: 'reversed', showgrid: false, fixedrange: true,
      }) as Layout['yaxis'],
      margin: { t: 12, r: 16, b: 44, l: 48 },
      images: [],
    });
    return { data: [trace], layout: lay, height, best };
  }, [ctx]);

  return (
    <ChartCard
      title="Lap Time Heatmap"
      description={`Every driver, every lap. Blue is fast, red is slow (scale capped at 107% of ${formatLapTime(best)}). Click a cell to load that lap's telemetry.`}
      ctx={ctx}
    >
      {elRef => (
        <PlotlyChart
          data={data}
          layout={layout}
          height={height}
          elRef={elRef}
          onClick={p => {
            const [driver, lap] = (p.customdata as [string, number]) ?? [];
            if (driver && lap) ctx.onPickLap(driver, lap);
          }}
        />
      )}
    </ChartCard>
  );
}
