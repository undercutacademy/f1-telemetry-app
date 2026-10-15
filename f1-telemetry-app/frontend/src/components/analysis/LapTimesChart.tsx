import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { TYRE_COLORS } from '../../types/telemetry';
import {
  formatLapTime, fuelCorrected, groupByDriver, isPaceLap, isRaceSession, outlierThreshold,
  trackStatusBands, type StatusBand,
} from '../../utils/sessionAnalysis';
import ChartCard, { Toggle, type AnalysisContext } from './ChartCard';
import PlotlyChart, { axis, baseLayout } from './PlotlyChart';

/** Focused drivers are drawn; everyone else starts hidden but is one legend click away. */
export function traceVisibility(ctx: AnalysisContext, driver: string, fallbackCount = 5): true | 'legendonly' {
  if (ctx.focus.length) return ctx.focus.includes(driver) ? true : 'legendonly';
  return ctx.order.indexOf(driver) < fallbackCount ? true : 'legendonly';
}

const BAND_STYLE: Record<StatusBand['kind'], { fill: string; label: string }> = {
  SC: { fill: 'rgba(245, 158, 11, 0.16)', label: 'SC' },
  VSC: { fill: 'rgba(245, 158, 11, 0.09)', label: 'VSC' },
  RED: { fill: 'rgba(239, 68, 68, 0.16)', label: 'RED' },
};

/** Lap-range background bands + labels for SC / VSC / red-flag periods. */
export function statusShapes(bands: StatusBand[], isDark: boolean): Pick<Layout, 'shapes' | 'annotations'> {
  return {
    shapes: bands.map(b => ({
      type: 'rect', xref: 'x', yref: 'paper', x0: b.startLap - 0.5, x1: b.endLap + 0.5, y0: 0, y1: 1,
      fillcolor: BAND_STYLE[b.kind].fill, line: { width: 0 }, layer: 'below',
    })) as Layout['shapes'],
    annotations: bands.map(b => ({
      xref: 'x', yref: 'paper', x: (b.startLap + b.endLap) / 2, y: 1, yanchor: 'bottom',
      text: BAND_STYLE[b.kind].label, showarrow: false,
      font: { size: 9, color: isDark ? '#FBBF24' : '#B45309' },
    })) as Layout['annotations'],
  };
}

export default function LapTimesChart({ ctx }: { ctx: AnalysisContext }) {
  const race = isRaceSession(ctx.sessionType);
  const [hideOutliers, setHideOutliers] = useState(true);
  const [hidePit, setHidePit] = useState(true);
  const [fuel, setFuel] = useState(false);
  const [showStatus, setShowStatus] = useState(true);

  const bands = useMemo(() => trackStatusBands(ctx.data.laps), [ctx.data.laps]);
  const totalLaps = useMemo(() => Math.max(0, ...ctx.data.laps.map(l => l.lap)), [ctx.data.laps]);

  const { data, layout } = useMemo(() => {
    const threshold = hideOutliers ? outlierThreshold(ctx.data.laps) : Infinity;
    const byDriver = groupByDriver(ctx.data.laps);

    const traces: Data[] = ctx.order.filter(d => byDriver.has(d)).map(driver => {
      const laps = byDriver.get(driver)!.filter(l =>
        l.time !== null && l.time <= threshold && (!hidePit || isPaceLap(l)),
      );
      const y = laps.map(l => (fuel && race ? fuelCorrected(l.time!, l.lap, totalLaps) : l.time!));
      return {
        type: 'scatter',
        mode: 'lines+markers',
        name: driver,
        x: laps.map(l => l.lap),
        y,
        visible: traceVisibility(ctx, driver),
        line: { color: ctx.colors[driver], width: 1.5 },
        marker: {
          size: 7,
          color: laps.map(l => TYRE_COLORS[l.compound] ?? TYRE_COLORS.UNKNOWN),
          line: { color: ctx.colors[driver], width: 1.5 },
        },
        customdata: laps.map(l => [driver, l.lap]),
        text: laps.map((l, i) =>
          `${formatLapTime(y[i])}${fuel && race ? ' (fuel-corr.)' : ''}<br>${l.compound} · ${l.tyreLife} laps old`),
        hovertemplate: `<b>${driver}</b> · Lap %{x}<br>%{text}<extra></extra>`,
      } as Data;
    });

    const status = showStatus ? statusShapes(bands, ctx.isDark) : { shapes: [], annotations: [] };
    const lay = baseLayout(ctx.isDark, {
      xaxis: axis(ctx.isDark, 'Lap', { dtick: totalLaps > 40 ? 5 : 2 }) as Layout['xaxis'],
      yaxis: axis(ctx.isDark, fuel && race ? 'Fuel-corrected lap time (s)' : 'Lap time (s)') as Layout['yaxis'],
      margin: { t: 24, r: 16, b: 48, l: 60 },
      ...status,
    });
    return { data: traces, layout: lay };
  }, [ctx, hideOutliers, hidePit, fuel, race, totalLaps, bands, showStatus]);

  return (
    <ChartCard
      title="Lap Times"
      description="Every lap, marker coloured by tyre compound. Click a point to load that lap's telemetry; click legend names to add or remove drivers."
      ctx={ctx}
      controls={<>
        <Toggle label="Hide outliers (107%)" checked={hideOutliers} onChange={setHideOutliers}
          title="Hide laps slower than 107% of the session's fastest lap" />
        <Toggle label="Hide pit in/out laps" checked={hidePit} onChange={setHidePit} />
        {race && (
          <Toggle label="Fuel corrected" checked={fuel} onChange={setFuel}
            title="Remove the estimated fuel-load effect (~0.055 s per lap of fuel on board)" />
        )}
        {bands.length > 0 && <Toggle label="Show SC / VSC / red flag" checked={showStatus} onChange={setShowStatus} />}
      </>}
    >
      {elRef => (
        <PlotlyChart
          data={data}
          layout={layout}
          height={420}
          elRef={elRef}
          onClick={p => {
            const [driver, lap] = (p.customdata as [string, number]) ?? [];
            if (driver) ctx.onPickLap(driver, lap);
          }}
        />
      )}
    </ChartCard>
  );
}
