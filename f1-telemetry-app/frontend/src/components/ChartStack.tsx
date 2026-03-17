import { useEffect, useRef, useMemo } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Layout, PlotData, Config, LayoutAxis } from 'plotly.js';
import type { TelemetryData, TelemetryChannels } from '../types/telemetry';
import { adjustColorForTheme, offsetTeamColor } from '../utils/colors';

interface ChartStackProps {
  telemetryData: TelemetryData;
  theme: 'dark' | 'light';
}

// ─── Chart configuration ──────────────────────────────────────────────────────

interface ChartConfig {
  title: string;
  channel: keyof TelemetryChannels;
  yRange?: [number, number];
  isStep?: boolean;
  isDelta?: boolean;
  isFill?: boolean;
  unit?: string;
}

const CHART_CONFIGS: ChartConfig[] = [
  { title: 'Speed (km/h)', channel: 'speed', yRange: [0, 380], unit: 'km/h' },
  { title: 'Delta Time (s)', channel: 'delta_time', unit: 's', isDelta: true },
  { title: 'RPM', channel: 'rpm', yRange: [5000, 14000], unit: 'RPM' },
  { title: 'Gear', channel: 'gear', yRange: [0, 9], isStep: true },
  { title: 'Throttle (%)', channel: 'throttle', yRange: [0, 100], unit: '%', isFill: true },
  { title: 'Brake', channel: 'brake', yRange: [-0.1, 1.1], isStep: true, isFill: true },
  { title: 'Lateral G', channel: 'lateral_g', unit: 'G' },
  { title: 'Long. G', channel: 'longitudinal_g', unit: 'G' },
];

// ─── Build subplot layout ─────────────────────────────────────────────────────

const NUM_CHARTS = CHART_CONFIGS.length; // 8
const GAP = 0.012; // gap between subplots

// Speed chart is 3×, Gear chart is 1.5×, others are 1×
const CHART_WEIGHTS = CHART_CONFIGS.map((cfg) => {
  if (cfg.channel === 'speed') return 3;
  if (cfg.channel === 'gear') return 1.5;
  return 1;
});
const TOTAL_WEIGHT = CHART_WEIGHTS.reduce((a, b) => a + b, 0); // 10.5
const TOTAL_GAP = GAP * (NUM_CHARTS - 1);
const UNIT_HEIGHT = (1 - TOTAL_GAP) / TOTAL_WEIGHT;

function getSubplotDomain(row: number): [number, number] {
  // Accumulate vertical space consumed by rows above this one
  let topOffset = 0;
  for (let i = 0; i < row; i++) {
    topOffset += CHART_WEIGHTS[i] * UNIT_HEIGHT + GAP;
  }
  const chartHeight = CHART_WEIGHTS[row] * UNIT_HEIGHT;
  const top = 1 - topOffset;
  const bottom = top - chartHeight;
  return [Math.max(0, bottom), Math.min(1, top)];
}

// ─── Build traces for each chart ─────────────────────────────────────────────

function buildTraces(
  telemetryData: TelemetryData,
  driverColors: string[]
): Partial<PlotData>[] {
  const traces: Partial<PlotData>[] = [];
  const distance = telemetryData.distance;
  const drivers = telemetryData.drivers;

  CHART_CONFIGS.forEach((cfg, idx) => {
    const axisNum = idx + 1; // 1-indexed
    const xAxis = `x${axisNum === 1 ? '' : axisNum}` as PlotData['xaxis'];
    const yAxis = `y${axisNum === 1 ? '' : axisNum}` as PlotData['yaxis'];

    // Ensure first driver has the channel
    if (!drivers.length || !drivers[0].channels[cfg.channel]) return;

    const lineShape = cfg.isStep ? 'hv' : 'linear';

    if (cfg.isDelta) {
      if (drivers.length < 2) return;

      // Draw flat line for driver 1 (reference driver) at 0
      traces.push({
        x: distance,
        y: new Array(distance.length).fill(0),
        type: 'scatter',
        mode: 'lines',
        name: `${drivers[0].abbreviation} Reference`,
        xaxis: xAxis,
        yaxis: yAxis,
        line: { color: driverColors[0], width: 1.5, shape: 'linear' },
        showlegend: false,
        hovertemplate: `0.000s<extra>${drivers[0].abbreviation} (Ref)</extra>`,
      });

      // Delta chart: draw delta lines for each driver against the first
      for (let d = 1; d < drivers.length; d++) {
        const deltaVals = drivers[d].channels[cfg.channel] as number[];
        if (!deltaVals) continue;

        const dn = drivers[d];

        const colorN = driverColors[d];

        // Main delta line
        traces.push({
          x: distance,
          y: deltaVals,
          type: 'scatter',
          mode: 'lines',
          name: `Delta (${drivers[0].abbreviation} vs ${dn.abbreviation})`,
          xaxis: xAxis,
          yaxis: yAxis,
          line: { color: d === 1 ? '#AAAAAA' : colorN, width: 1.5, shape: 'linear' },
          showlegend: false,
          hovertemplate: `%{y:.3f}s<extra>Delta ${dn.abbreviation}</extra>`,
        });
      }

      return;
    }

    // ─── Normal channels: draw lines for each driver ─────────────────────
    for (let d = 0; d < drivers.length; d++) {
      const dn = drivers[d];
      const chn = dn.channels[cfg.channel];
      const colorN = driverColors[d];

      if (!chn) continue;

      traces.push({
        x: distance,
        y: chn as number[],
        type: 'scatter',
        mode: 'lines',
        name: `${dn.abbreviation}`,
        xaxis: xAxis,
        yaxis: yAxis,
        line: {
          color: colorN,
          width: 1.5,
          shape: lineShape,
        },
        showlegend: idx === 0, // only show legend for first chart
        legendgroup: dn.abbreviation,
        hovertemplate: cfg.unit
          ? `%{y:.1f} ${cfg.unit}<extra>${dn.abbreviation}</extra>`
          : `%{y:.1f}<extra>${dn.abbreviation}</extra>`,
      });
    }
  });

  return traces;
}

// ─── Build layout ─────────────────────────────────────────────────────────────

function buildLayout(
  isDark: boolean,
  maxDistance: number,
  cornerShapes: Partial<Layout['shapes'][0]>[],
  cornerAnnotations: Partial<Layout['annotations'][0]>[]
): Partial<Layout> {
  const bgColor = isDark ? '#111111' : '#F8F9FA';
  const paperBg = isDark ? '#111111' : '#F8F9FA';
  const textColor = isDark ? '#FFFFFF' : '#1A1A2E';
  const gridColor = isDark ? '#27272A' : '#E5E7EB';
  const zeroLineColor = isDark ? '#3F3F46' : '#D1D5DB';

  const layout: Partial<Layout> = {
    paper_bgcolor: paperBg,
    plot_bgcolor: bgColor,
    font: {
      color: textColor,
      family: 'Inter, system-ui, sans-serif',
      size: 11,
    },
    showlegend: true,
    legend: {
      orientation: 'h',
      x: 0.5,
      xanchor: 'center',
      y: 1.0,
      yanchor: 'bottom',
      bgcolor: 'transparent',
      font: { size: 12, color: textColor },
      traceorder: 'normal',
    },
    margin: { t: 50, r: 15, b: 55, l: 52 },
    hovermode: 'x',
    hoverdistance: 1,
    hoverlabel: {
      bgcolor: isDark ? '#09090B' : '#FFFFFF',
      bordercolor: isDark ? '#3F3F46' : '#D1D5DB',
      font: { color: textColor, size: 11, family: 'Inter, monospace' },
      namelength: -1,
    },
    dragmode: 'pan',
    uirevision: 'telemetry',
    images: CHART_CONFIGS.map((_, idx) => {
      const [bottom, top] = getSubplotDomain(idx);
      const height = top - bottom;
      return {
        source: isDark ? '/Overcut.White.Letters.png' : '/Overcut.Black.Letters.png',
        xref: 'paper',
        yref: 'paper',
        x: 0.5,
        y: bottom + height / 2,
        sizex: 0.4,
        sizey: height * 0.8,
        xanchor: 'center',
        yanchor: 'middle',
        opacity: 0.04,
        layer: 'below',
      };
    }),
  };

  // Build axis configurations for each chart
  CHART_CONFIGS.forEach((cfg, idx) => {
    const axisNum = idx + 1;
    const yDomain = getSubplotDomain(idx); // vertical position [bottom, top]
    const isLast = idx === NUM_CHARTS - 1;
    const isFirst = idx === 0;

    const xAxisKey = `xaxis${axisNum === 1 ? '' : axisNum}` as keyof Layout;
    const yAxisKey = `yaxis${axisNum === 1 ? '' : axisNum}` as keyof Layout;

    const xAxisConfig: Partial<LayoutAxis> = {
      domain: [0, 1] as [number, number], // always full width
      anchor: `y${axisNum === 1 ? '' : axisNum}` as any,
      showgrid: true,
      gridcolor: gridColor,
      gridwidth: 1,
      zeroline: false,
      showticklabels: isLast,
      tickfont: { size: 10, color: textColor },
      title: isLast
        ? { text: 'Distance (m)', font: { size: 11, color: textColor } }
        : { text: '' },
      // Sync all x-axes together
      ...(isFirst ? {} : { matches: 'x' }),
      showspikes: false,
      range: [0, maxDistance],
      // @ts-ignore
      minallowed: -50,
      // @ts-ignore
      maxallowed: maxDistance + 50,
    };

    const yAxisConfig: Partial<LayoutAxis> = {
      domain: yDomain, // vertical slice for this subplot
      anchor: `x${axisNum === 1 ? '' : axisNum}` as any,
      title: {
        text: cfg.title,
        font: { size: 10, color: textColor },
        standoff: 5,
      },
      showgrid: true,
      gridcolor: gridColor,
      gridwidth: 1,
      zeroline: cfg.isDelta || cfg.channel === 'lateral_g' || cfg.channel === 'longitudinal_g',
      zerolinecolor: zeroLineColor,
      zerolinewidth: 1,
      tickfont: { size: 9, color: textColor },
      ...(cfg.yRange ? { range: cfg.yRange } : {}),
      fixedrange: true,
    };

    (layout as Record<string, unknown>)[xAxisKey] = xAxisConfig;
    (layout as Record<string, unknown>)[yAxisKey] = yAxisConfig;
  });

  layout.shapes = cornerShapes as Layout['shapes'];
  layout.annotations = cornerAnnotations as Layout['annotations'];

  return layout;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ChartStack({ telemetryData, theme }: ChartStackProps) {
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

  const traces = useMemo(
    () => buildTraces(telemetryData, driverColors),
    [telemetryData, driverColors]
  );

  const maxDistance = telemetryData.distance.length > 0
    ? telemetryData.distance[telemetryData.distance.length - 1]
    : 0;

  const cornerShapes = useMemo(() => {
    const corners = telemetryData.circuit_info?.corners ?? [];
    const lineColor = isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.13)';
    return corners.map(corner => ({
      type: 'line' as const,
      xref: 'x' as const,
      yref: 'paper' as const,
      x0: corner.distance,
      x1: corner.distance,
      y0: 0,
      y1: 1,
      line: { color: lineColor, width: 1, dash: 'dot' as const },
    }));
  }, [telemetryData.circuit_info, isDark]);

  const cornerAnnotations = useMemo(() => {
    const corners = telemetryData.circuit_info?.corners ?? [];
    const label = (corner: typeof corners[0]) =>
      corner.letter ? `${corner.number}${corner.letter}` : String(corner.number);
    const base = { xref: 'x' as const, yref: 'paper' as const, showarrow: false,
      font: { color: '#22C55E', size: 9, family: 'Inter, system-ui, sans-serif' } };
    return corners.flatMap(corner => [
      { ...base, x: corner.distance, y: 0, text: label(corner), yanchor: 'top' as const, yshift: -2 },
      { ...base, x: corner.distance, y: 1, text: label(corner), yanchor: 'bottom' as const, yshift: 2 },
    ]);
  }, [telemetryData.circuit_info]);

  // Keep a ref so crosshair handlers always see the latest corner shapes
  const cornerShapesRef = useRef(cornerShapes);
  cornerShapesRef.current = cornerShapes;

  const layout = useMemo(
    () => buildLayout(isDark, maxDistance, cornerShapes, cornerAnnotations),
    [isDark, maxDistance, cornerShapes, cornerAnnotations]
  );

  const config: Partial<Config> = useMemo(
    () => ({
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toImage'] as Config['modeBarButtonsToRemove'],
      displaylogo: false,
      scrollZoom: true,
      doubleClick: 'reset',
    }),
    []
  );

  // Update plot data/layout when telemetry or theme changes; attach crosshair
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    Plotly.react(el, traces as PlotData[], layout, config);

    const lineColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)';

    // Throttle crosshair updates to one per animation frame to avoid lag
    let rafId: number | null = null;
    let pendingX: number | null = null;

    const flushCrosshair = () => {
      if (pendingX === null) return;
      const x = pendingX;
      pendingX = null;
      rafId = null;
      Plotly.relayout(el, {
        shapes: [
          ...cornerShapesRef.current,
          {
            type: 'line',
            xref: 'x',   // data-space x (all x-axes share the same range via `matches`)
            yref: 'paper', // paper-space y → spans the FULL figure height (0 = bottom, 1 = top)
            x0: x,
            x1: x,
            y0: 0,
            y1: 1,
            line: { color: lineColor, width: 1, dash: 'solid' },
          } as Partial<Layout['shapes'][0]>,
        ],
      } as Partial<Layout>);
    };

    const onHover = (data: { points: Array<{ x: number }> }) => {
      if (!data.points?.length) return;
      pendingX = data.points[0].x;
      if (rafId === null) rafId = requestAnimationFrame(flushCrosshair);
    };

    const onUnhover = () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      pendingX = null;
      Plotly.relayout(el, { shapes: cornerShapesRef.current } as Partial<Layout>);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).on('plotly_hover', onHover);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).on('plotly_unhover', onUnhover);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).removeListener?.('plotly_hover', onHover);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).removeListener?.('plotly_unhover', onUnhover);
    };
  }, [traces, layout, config, isDark]);

  // Resize observer lives independently — never torn down on data updates
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      Plotly.Plots.resize(el);
    });
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, []);

  // Speed = 3 units, others = 1 unit each → 10 units × 170px + margins
  const plotHeight = TOTAL_WEIGHT * 170 + 100;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-chart)] overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Telemetry Comparison — All Channels
        </h2>
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
          {telemetryData.drivers.map((d, i) => (
            <span
              key={i}
              className="flex items-center gap-1.5 font-medium"
              style={{ color: driverColors[i] }}
            >
              <span className="inline-block h-0.5 w-5 rounded" style={{ backgroundColor: driverColors[i] }} />
              {d.abbreviation}
              <span className="text-[var(--text-secondary)] font-normal ml-0.5">
                Lap {d.lap_number} · {d.lap_time}
              </span>
            </span>
          ))}

          <span className="hidden text-[10px] text-[var(--text-secondary)] sm:block ml-auto">
            Scroll to zoom · Drag to pan · Dbl-click to reset
          </span>
        </div>
      </div>

      {/* Chart area */}
      <div
        ref={containerRef}
        style={{ height: `${plotHeight}px`, width: '100%' }}
        className="no-transition"
      />
    </div>
  );
}
