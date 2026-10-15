import { useEffect, useRef, useMemo, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Layout, PlotData, Config } from 'plotly.js';
import type { TelemetryData, TelemetryChannels } from '../types/telemetry';
import { adjustColorForTheme, offsetTeamColor } from '../utils/colors';
import { downloadChart } from './analysis/PlotlyChart';
import { DownloadIcon, smallButton } from './analysis/ChartCard';

interface TrackMapProps {
  telemetryData: TelemetryData;
  theme: 'dark' | 'light';
  /** Used for the exported image's title. */
  label?: string;
}

// ─── Colour modes ─────────────────────────────────────────────────────────────

type ChannelMode = {
  key: keyof TelemetryChannels;
  label: string;
  unit: string;
  kind: 'continuous' | 'gear' | 'binary';
  binaryLabels?: [string, string];
  needs?: 'elevation' | 'ahead';
};

const CHANNEL_MODES: ChannelMode[] = [
  { key: 'speed', label: 'Speed', unit: 'km/h', kind: 'continuous' },
  { key: 'throttle', label: 'Throttle', unit: '%', kind: 'continuous' },
  { key: 'brake', label: 'Brake', unit: '', kind: 'binary', binaryLabels: ['Off', 'On'] },
  { key: 'gear', label: 'Gear', unit: '', kind: 'gear' },
  { key: 'rpm', label: 'RPM', unit: 'rpm', kind: 'continuous' },
  { key: 'drs', label: 'DRS', unit: '', kind: 'binary', binaryLabels: ['Closed', 'Open'] },
  { key: 'lateral_g', label: 'Lateral G', unit: 'G', kind: 'continuous' },
  { key: 'longitudinal_g', label: 'Longitudinal G', unit: 'G', kind: 'continuous' },
  { key: 'vertical_g', label: 'Vertical G', unit: 'G', kind: 'continuous', needs: 'elevation' },
  { key: 'elevation', label: 'Elevation', unit: 'm', kind: 'continuous', needs: 'elevation' },
  { key: 'gap_ahead', label: 'Gap to car ahead', unit: 's', kind: 'continuous', needs: 'ahead' },
  { key: 'dist_ahead', label: 'Distance to car ahead', unit: 'm', kind: 'continuous', needs: 'ahead' },
];

type Mode = 'minisectors' | 'speedadv' | keyof TelemetryChannels;

const COLORMAPS: Record<string, string | Array<[number, string]>> = {
  Turbo: [
    [0, '#30123b'], [0.07, '#4145ab'], [0.14, '#4675ed'], [0.21, '#39a2fc'], [0.29, '#1bcfd4'],
    [0.36, '#24eca6'], [0.43, '#61fc6c'], [0.5, '#a4fc3b'], [0.57, '#d1e834'], [0.64, '#f3c63a'],
    [0.71, '#fe9b2d'], [0.79, '#f36315'], [0.86, '#d93806'], [0.93, '#b11901'], [1, '#7a0403'],
  ],
  Viridis: 'Viridis',
  Plasma: [[0, '#0d0887'], [0.25, '#7e03a8'], [0.5, '#cc4778'], [0.75, '#f89540'], [1, '#f0f921']],
  Cividis: 'Cividis',
  Jet: 'Jet',
  Hot: 'Hot',
  'Red-Blue': 'RdBu',
};

const GEAR_COLORS = ['#6B7280', '#7F3C8D', '#3969AC', '#11A579', '#80BA5A', '#F2B701', '#E68310', '#E73F74', '#CF1C90'];

const MINI_SECTORS = 25;

// ─── Geometry ─────────────────────────────────────────────────────────────────

function normalizeCoords(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 0);
  return values.map((v) => (v - min) / range);
}

/** Split the lap into runs of consecutive points with the same owner, one line trace per run. */
function buildSegmentTraces(
  x: number[], y: number[], owner: number[], colors: string[], names: string[],
): Partial<PlotData>[] {
  if (x.length === 0) return [];
  const runs: Array<{ owner: number; xs: number[]; ys: number[] }> = [];
  for (let i = 0; i < x.length; i++) {
    const last = runs[runs.length - 1];
    if (!last || last.owner !== owner[i]) {
      // Overlap by one point so adjacent runs join without a gap.
      if (last) { last.xs.push(x[i]); last.ys.push(y[i]); }
      runs.push({ owner: owner[i], xs: [x[i]], ys: [y[i]] });
    } else {
      last.xs.push(x[i]);
      last.ys.push(y[i]);
    }
  }
  const tail = runs[runs.length - 1];
  tail.xs.push(x[0]);
  tail.ys.push(y[0]);

  const shown = new Set<number>();
  return runs.map(r => {
    const ok = r.owner >= 0 && r.owner < colors.length;
    const showlegend = !shown.has(r.owner);
    shown.add(r.owner);
    return {
      x: r.xs, y: r.ys, type: 'scatter', mode: 'lines',
      name: ok ? `${names[r.owner]} faster` : 'Equal',
      legendgroup: String(r.owner),
      showlegend,
      line: { color: ok ? colors[r.owner] : '#888888', width: 5 },
      hoverinfo: 'none',
    } as Partial<PlotData>;
  });
}

/** Owner of each grid point under "speed advantage": the car with the highest speed there. */
function speedOwners(data: TelemetryData): number[] {
  return data.distance.map((_, i) => {
    for (let d = 0; d < data.drivers.length; d++) if (data.drivers[d].channels.faster_segments[i]) return d;
    return -1;
  });
}

/**
 * Owner of each grid point under "mini-sectors": the lap is cut into equal
 * distance slices and each slice goes to whoever spent the least time in it.
 * Time in a slice = change in that driver's delta-to-driver-1 across it (driver
 * 1's own time cancels out, so no raw time channel is needed).
 */
function miniSectorOwners(data: TelemetryData): { owners: number[]; wins: number[] } {
  const n = data.distance.length;
  const owners = new Array(n).fill(-1);
  const wins = new Array(data.drivers.length).fill(0);
  for (let k = 0; k < MINI_SECTORS; k++) {
    const a = Math.floor((k * (n - 1)) / MINI_SECTORS);
    const b = Math.floor(((k + 1) * (n - 1)) / MINI_SECTORS);
    let best = -1, bestT = Infinity;
    data.drivers.forEach((d, i) => {
      const dt = d.channels.delta_time;
      const t = (dt[b] ?? 0) - (dt[a] ?? 0);
      if (t < bestT) { bestT = t; best = i; }
    });
    if (best >= 0) wins[best]++;
    for (let i = a; i <= b; i++) owners[i] = best;
  }
  return { owners, wins };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TrackMap({ telemetryData, theme, label }: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDark = theme === 'dark';

  const [mode, setMode] = useState<Mode>('minisectors');
  const [driverIdx, setDriverIdx] = useState(0);
  const [colormap, setColormap] = useState('Turbo');

  const hasElevation = (telemetryData.drivers[0]?.channels.elevation?.length ?? 0) > 0;
  const hasAhead = telemetryData.drivers.some(d => d.channels.dist_ahead?.some(v => Number.isFinite(v)));
  const available = CHANNEL_MODES.filter(m =>
    !(m.needs === 'elevation' && !hasElevation) && !(m.needs === 'ahead' && !hasAhead));
  const channelMode = available.find(m => m.key === mode) ?? null;
  // Fall back if the remembered channel isn't in this session's data.
  const effectiveMode: Mode = mode === 'minisectors' || mode === 'speedadv' || channelMode ? mode : 'minisectors';
  const driver = telemetryData.drivers[Math.min(driverIdx, telemetryData.drivers.length - 1)];

  const driverColors = useMemo(() => {
    const counts = new Map<string, number>();
    return telemetryData.drivers.map(d => {
      const baseColor = adjustColorForTheme(d.team_color, theme);
      const count = counts.get(baseColor) || 0;
      counts.set(baseColor, count + 1);
      return offsetTeamColor(baseColor, count, theme);
    });
  }, [telemetryData.drivers, theme]);

  const driverAbbrs = useMemo(() => telemetryData.drivers.map(d => d.abbreviation), [telemetryData.drivers]);

  const coords = useMemo(() => ({
    x: normalizeCoords(telemetryData.track.x.map(v => v / 10)),
    y: normalizeCoords(telemetryData.track.y.map(v => v / 10)),
  }), [telemetryData.track]);

  const miniSectors = useMemo(() => miniSectorOwners(telemetryData), [telemetryData]);

  const traces = useMemo((): Partial<PlotData>[] => {
    const { x, y } = coords;
    if (effectiveMode === 'minisectors') {
      return buildSegmentTraces(x, y, miniSectors.owners, driverColors, driverAbbrs);
    }
    if (effectiveMode === 'speedadv') {
      return buildSegmentTraces(x, y, speedOwners(telemetryData), driverColors, driverAbbrs);
    }
    if (!channelMode || !driver) return [];

    const raw = driver.channels[channelMode.key] as number[];
    const vals = raw.map(v => (Number.isFinite(v) ? v : null));
    const base: Partial<PlotData> = {
      x, y, type: 'scatter', mode: 'lines', showlegend: false, hoverinfo: 'skip',
      line: { color: isDark ? '#3F3F46' : '#D1D5DB', width: 9 },
    };

    let marker: Partial<PlotData>['marker'];
    if (channelMode.kind === 'gear') {
      marker = {
        color: vals as number[], cmin: -0.5, cmax: 8.5,
        colorscale: GEAR_COLORS.flatMap((c, i) => [[i / 9, c], [(i + 1) / 9, c]]) as Array<[number, string]>,
        colorbar: { title: { text: 'Gear' }, tickvals: [1, 2, 3, 4, 5, 6, 7, 8], thickness: 10, len: 0.8 },
      };
    } else if (channelMode.kind === 'binary') {
      const [off, on] = channelMode.binaryLabels!;
      marker = {
        color: vals as number[], cmin: 0, cmax: 1,
        colorscale: [[0, isDark ? '#52525B' : '#D4D4D8'], [0.5, isDark ? '#52525B' : '#D4D4D8'], [0.5, '#E10600'], [1, '#E10600']],
        colorbar: { tickvals: [0.25, 0.75], ticktext: [off, on], thickness: 10, len: 0.5 },
      };
    } else {
      const finite = vals.filter((v): v is number => v !== null);
      // Gap/distance to the car ahead has a long tail; cap at the 95th percentile
      // so the close-following sections the chart is about stay readable.
      const sorted = [...finite].sort((a, b) => a - b);
      const cmax = channelMode.needs === 'ahead'
        ? sorted[Math.floor(sorted.length * 0.95)] ?? 1
        : Math.max(...finite);
      marker = {
        color: vals as number[], cmin: Math.min(...finite), cmax,
        colorscale: COLORMAPS[colormap] as Array<[number, string]>,
        colorbar: { title: { text: channelMode.unit }, thickness: 10, len: 0.8 },
      };
    }

    const aheadText = channelMode.needs === 'ahead'
      ? driver.channels.driver_ahead.map(a => (a ? `<br>Car ahead: ${a}` : ''))
      : null;
    const overlay: Partial<PlotData> = {
      x, y, type: 'scatter', mode: 'markers', showlegend: false,
      marker: { ...marker, size: 7, line: { width: 0 } },
      customdata: telemetryData.distance.map((d, i) => [Math.round(d), aheadText?.[i] ?? '']) as unknown as PlotData['customdata'],
      hovertemplate: `<b>${driver.abbreviation}</b> · %{customdata[0]} m<br>${channelMode.label}: %{marker.color:.${channelMode.kind === 'continuous' ? 2 : 0}f} ${channelMode.unit}%{customdata[1]}<extra></extra>`,
    };
    return [base, overlay];
  }, [coords, effectiveMode, miniSectors, driverColors, driverAbbrs, telemetryData, channelMode, driver, colormap, isDark]);

  // Corner annotation traces
  const cornerTrace = useMemo((): Partial<PlotData> | null => {
    const corners = telemetryData.circuit_info?.corners;
    if (!corners || corners.length === 0) return null;

    const tRawX = telemetryData.track.x.map((v) => v / 10);
    const tRawY = telemetryData.track.y.map((v) => v / 10);
    const minX = Math.min(...tRawX);
    const maxX = Math.max(...tRawX);
    const minY = Math.min(...tRawY);
    const maxY = Math.max(...tRawY);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    return {
      x: corners.map((c) => (c.x / 10 - minX) / rangeX),
      y: corners.map((c) => (c.y / 10 - minY) / rangeY),
      type: 'scatter',
      mode: 'text',
      text: corners.map((c) => `${c.number}${c.letter}`),
      textposition: 'top center',
      textfont: {
        size: 13,
        color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)',
        family: 'Inter, sans-serif',
        weight: 600,
      },
      name: 'Corners',
      showlegend: false,
      hoverinfo: 'text',
      hovertext: corners.map((c) => `Turn ${c.number}${c.letter}`),
    };
  }, [telemetryData, isDark]);

  const allTraces = useMemo(() => (cornerTrace ? [...traces, cornerTrace] : traces), [traces, cornerTrace]);

  const layout = useMemo((): Partial<Layout> => {
    const bg = isDark ? '#111111' : '#F8F9FA';
    const txt = isDark ? '#FFFFFF' : '#1A1A2E';
    return {
      paper_bgcolor: bg,
      plot_bgcolor: bg,
      font: { color: txt, family: 'Inter, sans-serif', size: 11 },
      showlegend: effectiveMode === 'minisectors' || effectiveMode === 'speedadv',
      legend: {
        orientation: 'h',
        y: -0.05,
        x: 0.5,
        xanchor: 'center',
        bgcolor: 'transparent',
        font: { size: 11, color: txt },
      },
      margin: { t: 20, r: 20, b: 50, l: 20 },
      xaxis: {
        showgrid: false,
        zeroline: false,
        showticklabels: false,
        scaleanchor: 'y',
        scaleratio: 1,
        range: [-0.05, 1.05],
      },
      yaxis: {
        showgrid: false,
        zeroline: false,
        showticklabels: false,
        range: [-0.05, 1.05],
      },
      hovermode: 'closest',
      dragmode: 'pan',
      uirevision: 'track',
      images: [
        {
          source: isDark ? '/Overcut.White.Letters.png' : '/Overcut.Black.Letters.png',
          xref: 'paper',
          yref: 'paper',
          x: 0.5,
          y: 0.5,
          sizex: 0.8,
          sizey: 0.8,
          xanchor: 'center',
          yanchor: 'middle',
          opacity: 0.04,
          layer: 'below',
        },
      ],
    };
  }, [isDark, effectiveMode]);

  const config: Partial<Config> = useMemo(() => ({
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toImage'] as Config['modeBarButtonsToRemove'],
    displaylogo: false,
    scrollZoom: true,
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    Plotly.react(el, allTraces as PlotData[], layout, config);
  }, [allTraces, layout, config]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const resizeObserver = new ResizeObserver(() => Plotly.Plots.resize(el));
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, []);

  const modeTitle = effectiveMode === 'minisectors' ? 'Mini-sectors'
    : effectiveMode === 'speedadv' ? 'Speed advantage'
      : `${channelMode?.label} · ${driver?.abbreviation}`;

  const download = () => {
    if (!containerRef.current) return;
    const title = `Track Map — ${modeTitle}${label ? ` — ${label}` : ''}`;
    const file = `${label ?? ''} track map ${modeTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadChart(containerRef.current, title, file, isDark);
  };

  const selectCls = 'h-7 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-xs text-[var(--text-primary)] focus:border-red-500 focus:outline-none';

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-chart)] overflow-hidden">
      {/* Title bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Track Map — {modeTitle}</h2>
        <button type="button" onClick={download} className={smallButton} title="Download track map as PNG">
          <DownloadIcon /> PNG
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--text-secondary)]">
        <label className="flex items-center gap-1.5">
          Colour by
          <select className={selectCls + ' pr-8'} value={effectiveMode} onChange={e => setMode(e.target.value as Mode)}>
            <option value="minisectors">Mini-sectors (fastest through each)</option>
            <option value="speedadv">Speed advantage (point by point)</option>
            <optgroup label="Channel">
              {available.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </optgroup>
          </select>
        </label>
        {channelMode && (
          <>
            <label className="flex items-center gap-1.5">
              Driver
              <select className={selectCls + ' pr-8'} value={driverIdx} onChange={e => setDriverIdx(Number(e.target.value))}>
                {telemetryData.drivers.map((d, i) => <option key={i} value={i}>{d.abbreviation}</option>)}
              </select>
            </label>
            {channelMode.kind === 'continuous' && (
              <label className="flex items-center gap-1.5">
                Colours
                <select className={selectCls + ' pr-8'} value={colormap} onChange={e => setColormap(e.target.value)}>
                  {Object.keys(COLORMAPS).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            )}
          </>
        )}
        {effectiveMode === 'minisectors' && (
          <span className="flex flex-wrap items-center gap-3">
            {telemetryData.drivers.map((d, i) => (
              <span key={i} className="font-medium" style={{ color: driverColors[i] }}>
                {d.abbreviation} {miniSectors.wins[i]}/{MINI_SECTORS}
              </span>
            ))}
          </span>
        )}
      </div>

      {/* Plot container */}
      <div ref={containerRef} className="no-transition" style={{ height: '380px', width: '100%' }} />
    </div>
  );
}
