import { useEffect, useRef, useMemo } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Layout, PlotData, Config, LayoutAxis } from 'plotly.js';
import type { TelemetryData, TelemetryChannels } from '../types/telemetry';
import { adjustColorForTheme, offsetTeamColor } from '../utils/colors';
import ChannelToggles, { useChannelToggles } from './ChannelToggles';

interface ChartStackProps {
  telemetryData: TelemetryData;
  theme: 'dark' | 'light';
}

// ─── Chart configuration ──────────────────────────────────────────────────────

interface ChartConfig {
  title: string;
  channel: keyof TelemetryChannels;
  label: string;          // chip label
  defaultOn: boolean;
  weight: number;
  yRange?: [number, number];
  isStep?: boolean;
  isDelta?: boolean;
  isFill?: boolean;
  isHeatmap?: boolean;     // actions lanes
  firstDriverOnly?: boolean; // elevation
  needsElevation?: boolean;  // disable chip when session has no z
  unit?: string;
}

const CHART_CONFIGS: ChartConfig[] = [
  { title: 'Speed (km/h)', channel: 'speed', label: 'Speed', defaultOn: true, weight: 3, yRange: [0, 380], unit: 'km/h' },
  { title: 'Delta Time (s)', channel: 'delta_time', label: 'Delta', defaultOn: true, weight: 1, unit: 's', isDelta: true },
  { title: 'RPM', channel: 'rpm', label: 'RPM', defaultOn: true, weight: 1, yRange: [5000, 14000], unit: 'RPM' },
  { title: 'Gear', channel: 'gear', label: 'Gear', defaultOn: true, weight: 1.5, yRange: [0, 9], isStep: true },
  { title: 'Throttle (%)', channel: 'throttle', label: 'Throttle', defaultOn: true, weight: 1, yRange: [0, 100], unit: '%', isFill: true },
  { title: 'Brake', channel: 'brake', label: 'Brake', defaultOn: true, weight: 1, yRange: [-0.1, 1.1], isStep: true, isFill: true },
  { title: 'Lateral G', channel: 'lateral_g', label: 'Lat G', defaultOn: true, weight: 1, unit: 'G' },
  { title: 'Long. G', channel: 'longitudinal_g', label: 'Long G', defaultOn: true, weight: 1, unit: 'G' },
  { title: 'DRS', channel: 'drs', label: 'DRS', defaultOn: false, weight: 0.7, yRange: [-0.1, 1.1], isStep: true },
  { title: 'Actions', channel: 'actions', label: 'Actions', defaultOn: false, weight: 1, isHeatmap: true },
  { title: 'Elevation (m)', channel: 'elevation', label: 'Elev', defaultOn: false, weight: 1, unit: 'm', firstDriverOnly: true, needsElevation: true },
  { title: 'Vertical G', channel: 'vertical_g', label: 'Vert G', defaultOn: false, weight: 1, unit: 'G', needsElevation: true },
];

// Action-lane categorical palette — validated against the `dataviz` skill's
// six-check validator (scripts/validate_palette.js) for both light (#fcfcfb)
// and dark (#1a1a19) chart surfaces. The brief's original hex/order (Tailwind
// red-500/green-500/amber-500/blue-500/gray-400) failed the adjacent-pair CVD
// check and (in dark mode) the lightness band, regardless of order. Swapping
// in the dataviz skill's validated categorical steps (same hue families, in
// an order that clears the adjacent-pair CVD gate: Braking, Full Throttle,
// Lift & Coast, Cornering, Rolling) passes lightness band, CVD separation
// (warn band, >=6) and the normal-vision floor (>=15) — but only with
// mode-specific steps: the light-surface amber (`#EDA100`) is too light to
// clear the dark-surface lightness band, so dark mode uses the skill's
// dark-stepped hues (same hue families, re-stepped darker/less bright).
// "Rolling" (gray) intentionally reads as low-chroma — it represents a
// neutral/coasting state, not a color meant to compete with the four active
// hues. Each cell also carries a hover tooltip label (secondary encoding),
// which the skill requires for any pair in the CVD warn band.
const ACTION_CATEGORIES_LIGHT = [
  { code: 0, label: 'Braking',       color: '#E34948' },
  { code: 1, label: 'Full Throttle', color: '#008300' },
  { code: 2, label: 'Lift & Coast',  color: '#EDA100' },
  { code: 3, label: 'Cornering',     color: '#2A78D6' },
  { code: 4, label: 'Rolling',       color: '#898781' },
];

const ACTION_CATEGORIES_DARK = [
  { code: 0, label: 'Braking',       color: '#E66767' },
  { code: 1, label: 'Full Throttle', color: '#008300' },
  { code: 2, label: 'Lift & Coast',  color: '#C98500' },
  { code: 3, label: 'Cornering',     color: '#3987E5' },
  { code: 4, label: 'Rolling',       color: '#898781' },
];

function actionCategories(isDark: boolean) {
  return isDark ? ACTION_CATEGORIES_DARK : ACTION_CATEGORIES_LIGHT;
}

// ─── Build subplot layout ─────────────────────────────────────────────────────

const GAP = 0.012; // gap between subplots

function totalWeight(configs: ChartConfig[]): number {
  return configs.reduce((a, c) => a + c.weight, 0);
}

function getSubplotDomain(configs: ChartConfig[], row: number): [number, number] {
  const unit = (1 - GAP * (configs.length - 1)) / totalWeight(configs);
  let topOffset = 0;
  for (let i = 0; i < row; i++) topOffset += configs[i].weight * unit + GAP;
  const top = 1 - topOffset;
  const bottom = top - configs[row].weight * unit;
  return [Math.max(0, bottom), Math.min(1, top)];
}

// ─── Build traces for each chart ─────────────────────────────────────────────

function buildTraces(
  configs: ChartConfig[],
  telemetryData: TelemetryData,
  driverColors: string[],
  isDark: boolean
): Partial<PlotData>[] {
  const traces: Partial<PlotData>[] = [];
  const distance = telemetryData.distance;
  const drivers = telemetryData.drivers;
  const actionCats = actionCategories(isDark);

  configs.forEach((cfg, idx) => {
    const axisNum = idx + 1; // 1-indexed
    const xAxis = `x${axisNum === 1 ? '' : axisNum}` as PlotData['xaxis'];
    const yAxis = `y${axisNum === 1 ? '' : axisNum}` as PlotData['yaxis'];

    if (cfg.isHeatmap) {
      // One lane per driver; reversed so driver 0 is the top row
      for (let d = drivers.length - 1; d >= 0; d--) {
        const dn = drivers[d];
        const codes = dn.channels.actions;
        if (!codes || !codes.length) continue;
        traces.push({
          x: distance,
          y: [dn.abbreviation],
          z: [codes],
          type: 'heatmap',
          xaxis: xAxis,
          yaxis: yAxis,
          colorscale: actionCats.flatMap((c, i, arr) => [
            [i / arr.length, c.color], [(i + 1) / arr.length, c.color],
          ]) as Array<[number, string]>,
          zmin: -0.5,
          zmax: 4.5,
          showscale: false,
          text: [codes.map(c => actionCats[c]?.label ?? '')] as unknown as string[],
          hovertemplate: `%{text}<extra>${dn.abbreviation}</extra>`,
          showlegend: false,
        } as unknown as Partial<PlotData>);
      }
      return;
    }

    if (cfg.firstDriverOnly) {
      const vals = drivers[0].channels[cfg.channel] as number[];
      if (!vals || !vals.length) return;
      traces.push({
        x: distance,
        y: vals,
        type: 'scatter',
        mode: 'lines',
        name: 'Elevation',
        xaxis: xAxis,
        yaxis: yAxis,
        line: { color: driverColors[0], width: 1.5, shape: 'linear' },
        fill: 'tozeroy',
        showlegend: false,
        hovertemplate: `%{y:.1f} m<extra>Elevation</extra>`,
      });
      return;
    }

    // Ensure first driver has the channel (and it isn't an empty array —
    // this hides Elevation/Vert-G/DRS traces for sessions without the data)
    const first = drivers[0]?.channels[cfg.channel];
    if (!first || !(first as number[]).length) return;

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
  configs: ChartConfig[],
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
    images: configs.map((_, idx) => {
      const [bottom, top] = getSubplotDomain(configs, idx);
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
  configs.forEach((cfg, idx) => {
    const axisNum = idx + 1;
    const yDomain = getSubplotDomain(configs, idx); // vertical position [bottom, top]
    const isLast = idx === configs.length - 1;
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
      zeroline: cfg.isDelta || cfg.channel === 'lateral_g' || cfg.channel === 'longitudinal_g' || cfg.channel === 'vertical_g',
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

const DEFAULT_TOGGLES = Object.fromEntries(CHART_CONFIGS.map(c => [c.channel, c.defaultOn]));

export default function ChartStack({ telemetryData, theme }: ChartStackProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const isDark = theme === 'dark';

  const [enabled, toggle] = useChannelToggles(DEFAULT_TOGGLES);
  const hasElevation = (telemetryData.drivers[0]?.channels.elevation?.length ?? 0) > 0;

  const activeConfigs = useMemo(
    () => CHART_CONFIGS.filter(c => enabled[c.channel] && !(c.needsElevation && !hasElevation)),
    [enabled, hasElevation]
  );

  const toggleItems = CHART_CONFIGS.map(c => ({
    key: c.channel,
    label: c.label,
    disabled: c.needsElevation && !hasElevation,
    disabledReason: 'No elevation data for this session',
  }));

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
    () => buildTraces(activeConfigs, telemetryData, driverColors, isDark),
    [activeConfigs, telemetryData, driverColors, isDark]
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
    () => buildLayout(activeConfigs, isDark, maxDistance, cornerShapes, cornerAnnotations),
    [activeConfigs, isDark, maxDistance, cornerShapes, cornerAnnotations]
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
    if (activeConfigs.length === 0) return;
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
  }, [traces, layout, config, isDark, activeConfigs]);

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

  // Speed = 3 units, others = 1 unit each → total weight × 170px + margins
  const plotHeight = totalWeight(activeConfigs) * 170 + 100;

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

      <ChannelToggles items={toggleItems} enabled={enabled} onToggle={toggle} />

      {/* Chart area */}
      {activeConfigs.length === 0 ? (
        <div
          style={{ height: `${plotHeight}px`, width: '100%' }}
          className="flex items-center justify-center text-sm text-[var(--text-secondary)]"
        >
          No channels selected
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{ height: `${plotHeight}px`, width: '100%' }}
          className="no-transition"
        />
      )}
    </div>
  );
}
