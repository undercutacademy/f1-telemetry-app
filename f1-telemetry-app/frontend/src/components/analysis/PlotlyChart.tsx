import { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Config, Data, Layout } from 'plotly.js';

// ─── Shared look ──────────────────────────────────────────────────────────────

export function chartColors(isDark: boolean) {
  return {
    bg: isDark ? '#111111' : '#F8F9FA',
    text: isDark ? '#FFFFFF' : '#1A1A2E',
    muted: isDark ? '#A1A1AA' : '#6B7280',
    grid: isDark ? '#27272A' : '#E5E7EB',
    zero: isDark ? '#3F3F46' : '#D1D5DB',
    hoverBg: isDark ? '#09090B' : '#FFFFFF',
  };
}

/** Base layout every analysis chart starts from: theme colours + faint logo watermark. */
export function baseLayout(isDark: boolean, extra: Partial<Layout> = {}): Partial<Layout> {
  const c = chartColors(isDark);
  return {
    paper_bgcolor: c.bg,
    plot_bgcolor: c.bg,
    font: { color: c.text, family: 'Inter, system-ui, sans-serif', size: 11 },
    margin: { t: 16, r: 16, b: 48, l: 56 },
    hovermode: 'closest',
    hoverlabel: {
      bgcolor: c.hoverBg,
      bordercolor: c.zero,
      font: { color: c.text, size: 11, family: 'Inter, monospace' },
      namelength: -1,
    },
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.18, bgcolor: 'transparent', font: { size: 11 } },
    dragmode: 'pan',
    images: [{
      source: isDark ? '/Overcut.White.Letters.png' : '/Overcut.Black.Letters.png',
      xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, sizex: 0.5, sizey: 0.5,
      xanchor: 'center', yanchor: 'middle', opacity: 0.04, layer: 'below',
    }],
    ...extra,
  };
}

export function axis(isDark: boolean, title: string, extra: Record<string, unknown> = {}) {
  const c = chartColors(isDark);
  return {
    title: { text: title, font: { size: 11, color: c.text }, standoff: 6 },
    gridcolor: c.grid,
    zerolinecolor: c.zero,
    tickfont: { size: 10, color: c.text },
    ...extra,
  };
}

const CONFIG: Partial<Config> = {
  responsive: true,
  displayModeBar: true,
  displaylogo: false,
  scrollZoom: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toImage'] as Config['modeBarButtonsToRemove'],
};

// ─── PNG export ───────────────────────────────────────────────────────────────

/**
 * Download the current figure as PNG with a title and site credit burned in, so
 * a shared image still says what it shows and where it came from.
 */
export function downloadChart(el: HTMLElement, title: string, filename: string, isDark: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gd = el as any;
  if (!gd.data) return;
  const c = chartColors(isDark);
  const layout = gd.layout as Partial<Layout>;
  const margin = layout.margin ?? {};
  const width = Math.max(el.clientWidth, 900);
  const height = el.clientHeight + 70;
  Plotly.downloadImage(
    {
      data: gd.data,
      layout: {
        ...layout,
        width,
        height,
        margin: { ...margin, t: (margin.t ?? 16) + 50, b: (margin.b ?? 48) + 20 },
        title: { text: `<b>${title}</b>`, x: 0.01, xanchor: 'left', y: 0.985, font: { size: 16, color: c.text } },
        annotations: [
          ...(layout.annotations ?? []),
          {
            text: 'f1.overcutacademy.com · OAT-F1', xref: 'paper', yref: 'paper',
            x: 1, y: 0, xanchor: 'right', yanchor: 'top', yshift: -(margin.b ?? 48) - 6,
            showarrow: false, font: { size: 11, color: c.muted },
          },
        ],
      },
    },
    { format: 'png', filename, width, height, scale: 2 },
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface PlotClickPoint {
  x: number | string;
  y: number | string;
  customdata?: unknown;
  curveNumber: number;
  pointNumber: number | number[];
}

interface PlotlyChartProps {
  data: Data[];
  layout: Partial<Layout>;
  height: number;
  onClick?: (p: PlotClickPoint) => void;
  /** Lets the parent trigger a download: receives the plot element once mounted. */
  elRef?: (el: HTMLDivElement | null) => void;
}

export default function PlotlyChart({ data, layout, height, onClick, elRef }: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    elRef?.(ref.current);
    return () => elRef?.(null);
  }, [elRef]);

  useEffect(() => {
    if (!ref.current) return;
    Plotly.react(ref.current, data, layout, CONFIG);
  }, [data, layout]);

  // Click + resize wiring lives for the element's lifetime, not per data update.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (ev: { points?: PlotClickPoint[] }) => {
      const p = ev.points?.[0];
      if (p && clickRef.current) clickRef.current(p);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).on?.('plotly_click', handler);
    // The observer can fire after a tab switch purged the plot; resizing a
    // purged div throws, so only resize a live, attached plot.
    const ro = new ResizeObserver(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (el.isConnected && (el as any)._fullLayout) Plotly.Plots.resize(el);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).removeListener?.('plotly_click', handler);
      Plotly.purge(el);
    };
  }, []);

  return <div ref={ref} className="no-transition" style={{ height: `${height}px`, width: '100%' }} />;
}
