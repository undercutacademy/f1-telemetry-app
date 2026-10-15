import { useMemo } from 'react';
import type { Data, Layout } from 'plotly.js';
import { TYRE_COLORS } from '../../types/telemetry';
import { buildStints } from '../../utils/sessionAnalysis';
import { getContrastColor } from '../../utils/colors';
import ChartCard, { type AnalysisContext } from './ChartCard';
import PlotlyChart, { axis, baseLayout, chartColors } from './PlotlyChart';

export default function StrategyChart({ ctx }: { ctx: AnalysisContext }) {
  const { data, layout, height } = useMemo(() => {
    const stints = buildStints(ctx.data.laps);
    const drivers = ctx.order.filter(d => stints.some(s => s.driver === d));
    const row = new Map(drivers.map((d, i) => [d, i]));
    const c = chartColors(ctx.isDark);

    // One bar per stint, grouped into a trace per compound so the legend reads
    // as a tyre key rather than one entry per stint.
    const byCompound = new Map<string, typeof stints>();
    for (const s of stints) {
      if (!byCompound.has(s.compound)) byCompound.set(s.compound, []);
      byCompound.get(s.compound)!.push(s);
    }

    const traces: Data[] = Array.from(byCompound.entries()).map(([compound, list]) => {
      const color = TYRE_COLORS[compound] ?? TYRE_COLORS.UNKNOWN;
      return {
        type: 'bar',
        orientation: 'h',
        name: compound.charAt(0) + compound.slice(1).toLowerCase(),
        y: list.map(s => row.get(s.driver)),
        x: list.map(s => s.endLap - s.startLap + 1),
        base: list.map(s => s.startLap - 1),
        // Explicit: Plotly sizes bars from each trace's own row spacing, so a
        // compound used by only a few drivers would otherwise get fat bars.
        width: 0.72,
        marker: { color, line: { color: c.bg, width: 2 } },
        text: list.map(s => `${s.endLap - s.startLap + 1}`),
        textposition: 'inside',
        insidetextanchor: 'middle',
        textfont: { color: getContrastColor(color), size: 10 },
        customdata: list.map(s => [
          s.driver, s.stint, s.startLap, s.endLap,
          s.startTyreLife > 1 ? `used (${s.startTyreLife - 1} laps old)` : 'new',
        ]),
        hovertemplate:
          `<b>%{customdata[0]}</b> · stint %{customdata[1]} · ${compound}<br>` +
          'Laps %{customdata[2]}–%{customdata[3]} (%{x} laps)<br>Fitted %{customdata[4]}<extra></extra>',
      } as unknown as Data;
    });

    const maxLap = Math.max(1, ...ctx.data.laps.map(l => l.lap));
    const height = Math.max(240, drivers.length * 26 + 100);
    const lay = baseLayout(ctx.isDark, {
      barmode: 'overlay',
      bargap: 0.25,
      xaxis: axis(ctx.isDark, 'Lap', { range: [0, maxLap + 0.5], dtick: maxLap > 40 ? 5 : 2 }) as Layout['xaxis'],
      yaxis: axis(ctx.isDark, '', {
        tickmode: 'array', tickvals: drivers.map((_, i) => i), ticktext: drivers,
        autorange: 'reversed', showgrid: false, fixedrange: true,
      }) as Layout['yaxis'],
      legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.02, yanchor: 'bottom', bgcolor: 'transparent' },
      margin: { t: 36, r: 16, b: 44, l: 48 },
      hovermode: 'closest',
    });
    return { data: traces, layout: lay, height };
  }, [ctx]);

  return (
    <ChartCard
      title="Tyre Strategy"
      description="Each driver's stints by compound, with the number of laps in each stint. Hover for whether the set was new or used."
      ctx={ctx}
    >
      {elRef => <PlotlyChart data={data} layout={layout} height={height} elRef={elRef} />}
    </ChartCard>
  );
}
