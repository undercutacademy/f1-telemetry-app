import { useCallback, useRef, type ReactNode } from 'react';
import type { DriverListItem, SessionAnalysis } from '../../types/telemetry';
import { downloadChart } from './PlotlyChart';

/** Everything an analysis chart needs, built once by SessionAnalysis. */
export interface AnalysisContext {
  data: SessionAnalysis;
  drivers: DriverListItem[];
  isDark: boolean;
  colors: Record<string, string>;
  /** Drivers picked in the selection panel; charts show these first / highlighted. */
  focus: string[];
  /** Drivers in finishing (race) or best-lap (other sessions) order. */
  order: string[];
  sessionType: string;
  /** e.g. "2025 Abu Dhabi Grand Prix · Race" — used in exported image titles. */
  label: string;
  onPickLap: (abbr: string, lap: number) => void;
}

export function DownloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export const smallButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1 ' +
  'text-xs font-medium text-[var(--text-secondary)] hover:border-red-500 hover:text-red-500';

export function Toggle({ label, checked, onChange, title }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; title?: string;
}) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-[var(--text-secondary)]" title={title}>
      <input type="checkbox" className="h-3.5 w-3.5 accent-red-600" checked={checked}
        onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

interface ChartCardProps {
  title: string;
  description?: string;
  ctx: AnalysisContext;
  controls?: ReactNode;
  /** Renders the chart; must pass the provided ref callback to PlotlyChart's elRef. */
  children: (elRef: (el: HTMLDivElement | null) => void) => ReactNode;
}

export default function ChartCard({ title, description, ctx, controls, children }: ChartCardProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const setEl = useCallback((e: HTMLDivElement | null) => { el.current = e; }, []);

  const download = () => {
    if (!el.current) return;
    const file = `${ctx.label} ${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadChart(el.current, `${title} — ${ctx.label}`, file, ctx.isDark);
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-chart)] overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{description}</p>}
        </div>
        <button type="button" onClick={download} className={smallButton} title="Download chart as PNG">
          <DownloadIcon /> PNG
        </button>
      </div>
      {controls && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)] px-4 py-2">
          {controls}
        </div>
      )}
      {children(setEl)}
    </section>
  );
}
