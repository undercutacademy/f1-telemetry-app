import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { TYRE_COLORS } from '../../types/telemetry';
import {
  buildStints, formatLapTime, fuelCorrected, isPaceLap, isRaceSession, outlierThreshold, slope,
} from '../../utils/sessionAnalysis';
import ChartCard, { Toggle, type AnalysisContext } from './ChartCard';
import PlotlyChart, { axis, baseLayout } from './PlotlyChart';
import { traceVisibility } from './LapTimesChart';

const STINT_DASH = ['solid', 'dash', 'dot', 'dashdot', 'longdash', 'longdashdot'];

export default function StintChart({ ctx }: { ctx: AnalysisContext }) {
  const race = isRaceSession(ctx.sessionType);
  // Fuel burn makes tyre wear look smaller than it is, so correct by default in races.
  const [fuel, setFuel] = useState(race);
  const [hideOutliers, setHideOutliers] = useState(true);
  const [showTrend, setShowTrend] = useState(true);

  const { data, layout } = useMemo(() => {
    const threshold = hideOutliers ? outlierThreshold(ctx.data.laps) : Infinity;
    const totalLaps = Math.max(0, ...ctx.data.laps.map(l => l.lap));
    const stints = buildStints(ctx.data.laps);
    const rank = (d: string) => ctx.order.indexOf(d);
    stints.sort((a, b) => rank(a.driver) - rank(b.driver) || a.stint - b.stint);

    const traces: Data[] = [];
    for (const s of stints) {
      const laps = s.laps.filter(l => isPaceLap(l) && l.time! <= threshold);
      // Qualifying runs are out-lap, one push lap, in-lap: keep single-lap stints there.
      if (laps.length < (race ? 2 : 1)) continue;
      const x = laps.map(l => l.tyreLife);
      const y = laps.map(l => (fuel && race ? fuelCorrected(l.time!, l.lap, totalLaps) : l.time!));
      const deg = slope(x, y);
      const degLabel = deg === null ? '' : ` (${deg >= 0 ? '+' : ''}${deg.toFixed(3)} s/lap)`;
      const visible = traceVisibility(ctx, s.driver, 3);
      const group = `${s.driver}-${s.stint}`;
      const dash = STINT_DASH[(s.stint - 1) % STINT_DASH.length];

      traces.push({
        type: 'scatter',
        mode: 'lines+markers',
        name: `${s.driver} · S${s.stint} ${s.compound}${degLabel}`,
        legendgroup: group,
        x, y, visible,
        line: { color: ctx.colors[s.driver], width: 1.5, dash },
        marker: { size: 7, color: TYRE_COLORS[s.compound] ?? TYRE_COLORS.UNKNOWN, line: { color: ctx.colors[s.driver], width: 1.5 } },
        customdata: laps.map(l => [s.driver, l.lap]),
        text: laps.map((l, i) => `Lap ${l.lap} · ${formatLapTime(y[i])}`),
        hovertemplate: `<b>${s.driver}</b> stint ${s.stint} (${s.compound})<br>Tyre age %{x}<br>%{text}<extra></extra>`,
      } as Data);

      if (showTrend && deg !== null) {
        const x0 = Math.min(...x), x1 = Math.max(...x);
        const my = y.reduce((a, b) => a + b, 0) / y.length;
        const mx = x.reduce((a, b) => a + b, 0) / x.length;
        traces.push({
          type: 'scatter', mode: 'lines', legendgroup: group, showlegend: false, visible,
          x: [x0, x1], y: [my + deg * (x0 - mx), my + deg * (x1 - mx)],
          line: { color: ctx.colors[s.driver], width: 3, dash: 'solid' }, opacity: 0.35,
          hoverinfo: 'skip',
        } as Data);
      }
    }

    const lay = baseLayout(ctx.isDark, {
      xaxis: axis(ctx.isDark, 'Tyre age (laps)') as Layout['xaxis'],
      yaxis: axis(ctx.isDark, fuel && race ? 'Fuel-corrected lap time (s)' : 'Lap time (s)') as Layout['yaxis'],
      legend: { orientation: 'v', x: 1.01, xanchor: 'left', y: 1, bgcolor: 'transparent', font: { size: 10 } },
      margin: { t: 16, r: 8, b: 48, l: 60 },
    });
    return { data: traces, layout: lay };
  }, [ctx, fuel, race, hideOutliers, showTrend]);

  return (
    <ChartCard
      title="Stint Analysis"
      description="Pace against tyre age for each stint. The trend line slope is the degradation rate; markers show the compound."
      ctx={ctx}
      controls={<>
        {race && <Toggle label="Fuel corrected" checked={fuel} onChange={setFuel}
          title="Remove the estimated fuel-load effect so the slope reflects tyre wear" />}
        <Toggle label="Hide outliers (107%)" checked={hideOutliers} onChange={setHideOutliers} />
        <Toggle label="Degradation trend" checked={showTrend} onChange={setShowTrend} />
      </>}
    >
      {elRef => data.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--text-secondary)]">
          No stint has a representative lap in this session.
        </p>
      ) : (
        <PlotlyChart data={data} layout={layout} height={440} elRef={elRef}
          onClick={p => {
            const [driver, lap] = (p.customdata as [string, number]) ?? [];
            if (driver) ctx.onPickLap(driver, lap);
          }}
        />
      )}
    </ChartCard>
  );
}
