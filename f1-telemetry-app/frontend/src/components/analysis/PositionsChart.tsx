import { useMemo } from 'react';
import type { Data, Layout } from 'plotly.js';
import { groupByDriver } from '../../utils/sessionAnalysis';
import ChartCard, { type AnalysisContext } from './ChartCard';
import PlotlyChart, { axis, baseLayout } from './PlotlyChart';

export default function PositionsChart({ ctx }: { ctx: AnalysisContext }) {
  const { data, layout, height } = useMemo(() => {
    const byDriver = groupByDriver(ctx.data.laps);
    const grid = new Map(ctx.data.results.filter(r => r.grid).map(r => [r.driver, r.grid as number]));
    const dim = ctx.focus.length > 0;
    const traces: Data[] = [];
    const labels: Partial<Layout['annotations'][0]>[] = [];
    let maxPos = 1;

    ctx.order.forEach(driver => {
      const laps = (byDriver.get(driver) ?? []).filter(l => l.position !== null);
      if (!laps.length) return;
      const x = laps.map(l => l.lap);
      const y = laps.map(l => l.position as number);
      // Start the line on the grid slot (lap 0) when official results have it.
      const g = grid.get(driver);
      if (g) { x.unshift(0); y.unshift(g); }
      maxPos = Math.max(maxPos, ...y);
      const focused = !dim || ctx.focus.includes(driver);

      traces.push({
        type: 'scatter', mode: 'lines+markers', name: driver,
        x, y,
        line: { color: ctx.colors[driver], width: focused ? 2.5 : 1.2, shape: 'linear' },
        marker: { size: focused ? 5 : 3, color: ctx.colors[driver] },
        opacity: focused ? 1 : 0.35,
        hovertemplate: `<b>${driver}</b> · Lap %{x}<br>P%{y}<extra></extra>`,
      } as Data);

      labels.push({
        x: x[x.length - 1], y: y[y.length - 1], xanchor: 'left', xshift: 6, showarrow: false,
        text: driver, font: { size: 10, color: ctx.colors[driver] },
      });
    });

    const height = Math.max(380, maxPos * 22 + 90);
    const lay = baseLayout(ctx.isDark, {
      xaxis: axis(ctx.isDark, grid.size ? 'Lap (0 = grid)' : 'Lap') as Layout['xaxis'],
      yaxis: axis(ctx.isDark, 'Position', {
        // Descending range puts P1 at the top.
        dtick: 1, range: [maxPos + 0.5, 0.5], fixedrange: true,
      }) as Layout['yaxis'],
      showlegend: false,
      annotations: labels as Layout['annotations'],
      margin: { t: 16, r: 48, b: 48, l: 56 },
    });
    return { data: traces, layout: lay, height };
  }, [ctx]);

  return (
    <ChartCard
      title="Position Changes"
      description={ctx.data.source === 'analysis'
        ? 'Running order at the end of every lap, starting from the grid.'
        : 'Running order at the end of every lap, worked out from cumulative lap times (official positions are not available for this session yet).'}
      ctx={ctx}
    >
      {elRef => <PlotlyChart data={data} layout={layout} height={height} elRef={elRef} />}
    </ChartCard>
  );
}
