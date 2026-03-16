import { useEffect, useRef, useMemo } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Layout, PlotData, Config } from 'plotly.js';
import type { TelemetryData } from '../types/telemetry';
import { adjustColorForTheme, offsetTeamColor } from '../utils/colors';

interface TrackMapProps {
  telemetryData: TelemetryData;
  theme: 'dark' | 'light';
}

// ─── Normalize coordinates ────────────────────────────────────────────────────

function normalizeCoords(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 0);
  return values.map((v) => (v - min) / range);
}

// ─── Group consecutive same-winner segments ───────────────────────────────────

interface Segment {
  winner: number; // 1 = driver1 faster, 2 = driver2 faster, 0 = equal
  xVals: number[];
  yVals: number[];
}

function buildSegmentTraces(
  x: number[],
  y: number[],
  fasterSegments: number[],
  driverColors: string[],
  driverAbbrs: string[]
): Partial<PlotData>[] {
  if (x.length === 0) return [];

  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (let i = 0; i < x.length; i++) {
    const winner = fasterSegments[i] ?? 0;

    if (!current || current.winner !== winner) {
      // Start a new segment — overlap by 1 point to avoid gaps
      if (current && current.xVals.length > 0) {
        current.xVals.push(x[i]);
        current.yVals.push(y[i]);
      }
      current = {
        winner,
        xVals: [x[i]],
        yVals: [y[i]],
      };
      segments.push(current);
    } else {
      current.xVals.push(x[i]);
      current.yVals.push(y[i]);
    }
  }

  // Close the track by appending the first point at end if needed
  if (x.length > 1) {
    const last = segments[segments.length - 1];
    if (last) {
      last.xVals.push(x[0]);
      last.yVals.push(y[0]);
    }
  }

  const traces: Partial<PlotData>[] = [];
  const legendAdded = new Set<number>();

  // Iterate segments in order so colors render correctly
  segments.forEach((seg) => {
    const color = seg.winner >= 0 && seg.winner < driverColors.length ? driverColors[seg.winner] : '#888888';
    const name = seg.winner >= 0 && seg.winner < driverAbbrs.length ? `${driverAbbrs[seg.winner]} Faster` : 'Equal';
    const showLegend = !legendAdded.has(seg.winner);
    if (showLegend) legendAdded.add(seg.winner);

    traces.push({
      x: seg.xVals,
      y: seg.yVals,
      type: 'scatter',
      mode: 'lines',
      name: name,
      showlegend: showLegend,
      line: {
        color,
        width: 4,
      },
      hoverinfo: 'none',
    });
  });

  return traces;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TrackMap({ telemetryData, theme }: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const isDark = theme === 'dark';

  const driverColors = useMemo(() => {
    const counts = new Map<string, number>();
    return telemetryData.drivers.map(d => {
      const baseColor = adjustColorForTheme(d.team_color, theme);
      const count = counts.get(baseColor) || 0;
      counts.set(baseColor, count + 1);
      return offsetTeamColor(baseColor, count, theme);
    });
  }, [telemetryData.drivers, theme]);

  const driverAbbrs = useMemo(() =>
    telemetryData.drivers.map(d => d.abbreviation),
    [telemetryData.drivers]
  );

  const traces = useMemo(() => {
    // Convert from 1/10m to meters, then normalize
    const rawX = telemetryData.track.x.map((v) => v / 10);
    const rawY = telemetryData.track.y.map((v) => v / 10);
    const normX = normalizeCoords(rawX);
    const normY = normalizeCoords(rawY);

    const length = normX.length;
    const fasterSegments = new Array(length).fill(-1);

    for (let i = 0; i < length; i++) {
      let winner = -1;
      for (let d = 0; d < telemetryData.drivers.length; d++) {
        if (telemetryData.drivers[d].channels.faster_segments[i]) {
          winner = d;
          break;
        }
      }
      fasterSegments[i] = winner;
    }

    return buildSegmentTraces(
      normX,
      normY,
      fasterSegments,
      driverColors,
      driverAbbrs
    );
  }, [telemetryData, driverColors, driverAbbrs]);

  // Corner annotation traces
  const cornerTrace = useMemo((): Partial<PlotData> | null => {
    const corners = telemetryData.circuit_info?.corners;
    if (!corners || corners.length === 0) return null;

    // Compute track bounds from raw track data
    const tRawX = telemetryData.track.x.map((v) => v / 10);
    const tRawY = telemetryData.track.y.map((v) => v / 10);
    const minX = Math.min(...tRawX);
    const maxX = Math.max(...tRawX);
    const minY = Math.min(...tRawY);
    const maxY = Math.max(...tRawY);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    const normCX = corners.map((c) => (c.x / 10 - minX) / rangeX);
    const normCY = corners.map((c) => (c.y / 10 - minY) / rangeY);

    return {
      x: normCX,
      y: normCY,
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

  const allTraces = useMemo(() => {
    return cornerTrace ? [...traces, cornerTrace] : traces;
  }, [traces, cornerTrace]);

  const layout = useMemo((): Partial<Layout> => {
    const bg = isDark ? '#111111' : '#F8F9FA';
    const txt = isDark ? '#FFFFFF' : '#1A1A2E';
    return {
      paper_bgcolor: bg,
      plot_bgcolor: bg,
      font: { color: txt, family: 'Inter, sans-serif', size: 11 },
      showlegend: true,
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
  }, [isDark]);

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

    const resizeObserver = new ResizeObserver(() => {
      Plotly.Plots.resize(el);
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
    };
  }, [allTraces, layout, config]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-chart)] overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Track Map — Advantage by Segment
        </h2>
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          {telemetryData.drivers.map((d, i) => (
            <span
              key={i}
              className="flex items-center gap-1.5"
              style={{ color: adjustColorForTheme(d.team_color, theme) }}
            >
              <span
                className="inline-block h-1.5 w-4 rounded"
                style={{ backgroundColor: adjustColorForTheme(d.team_color, theme) }}
              />
              {d.abbreviation}
            </span>
          ))}
        </div>
      </div>

      {/* Plot container */}
      <div
        ref={containerRef}
        style={{ height: '380px', width: '100%' }}
      />
    </div>
  );
}
