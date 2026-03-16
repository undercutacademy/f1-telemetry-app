import React, { useEffect } from 'react';
import type { EventInfo, SessionInfo, DriverListItem, LapInfo } from '../types/telemetry';
import { useSelections } from '../hooks/useSelections';
import LapSelector from './LapSelector';
import { SkeletonBlock } from './LoadingState';
import { adjustColorForTheme, offsetTeamColor } from '../utils/colors';
import { useTheme } from '../context/ThemeContext';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SelectionPanelProps {
  years: number[];
  events: EventInfo[];
  sessions: SessionInfo[];
  drivers: DriverListItem[];
  driversLaps: Record<string, LapInfo[]>;

  loadingYears: boolean;
  loadingEvents: boolean;
  loadingSessions: boolean;
  loadingDrivers: boolean;
  loadingDriverLaps: Record<string, boolean>;
  loadingTelemetry: boolean;

  onLoadTelemetry: () => void;
  onReset: () => void;

  fetchEvents: (year: number) => Promise<void>;
  fetchSessions: (year: number, event: string, slug: string) => Promise<void>;
  fetchDrivers: (year: number, slug: string, session: string) => Promise<void>;
  fetchDriverLaps: (year: number, slug: string, session: string, driver: string) => Promise<void>;

  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

// ─── Styled Select ────────────────────────────────────────────────────────────

interface StyledSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  children: React.ReactNode;
}

function StyledSelect({
  id,
  label,
  value,
  onChange,
  disabled = false,
  loading = false,
  placeholder,
  children,
}: StyledSelectProps) {
  const isDisabled = disabled || loading;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {label}
      </label>
      {loading ? (
        <SkeletonBlock height="h-9" />
      ) : (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isDisabled}
          className={[
            'h-9 rounded-lg border px-3 text-sm font-medium',
            'bg-[var(--panel-bg)] text-[var(--text-primary)]',
            'border-[var(--border)]',
            'focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500',
            isDisabled
              ? 'cursor-not-allowed opacity-40'
              : 'cursor-pointer hover:border-[var(--text-secondary)]',
            'transition-colors duration-150',
          ].join(' ')}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {children}
        </select>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SelectionPanel({
  years,
  events,
  sessions,
  drivers: apiDrivers,
  driversLaps,
  loadingYears,
  loadingEvents,
  loadingSessions,
  loadingDrivers,
  loadingDriverLaps,
  loadingTelemetry,
  onLoadTelemetry,
  onReset,
  fetchEvents,
  fetchSessions,
  fetchDrivers,
  fetchDriverLaps,
  collapsed = false,
  onToggleCollapse,
}: SelectionPanelProps) {
  const { theme } = useTheme();
  const {
    year,
    event,
    session,
    drivers,
    setYear,
    setEvent,
    setSession,
    addDriver,
    removeDriver,
    setDriverAbbr,
    setDriverLap,
  } = useSelections();

  // ─── Slug lookup (CDN paths use slug, telemetry API uses event name) ────────
  const eventSlug = events.find((e) => e.name === event)?.slug ?? '';

  // ─── Cascading fetch effects ─────────────────────────────────────────────

  // When year changes, fetch events
  useEffect(() => {
    if (year !== null) {
      fetchEvents(year);
    }
  }, [year, fetchEvents]);

  // When event changes, fetch sessions
  useEffect(() => {
    if (year !== null && event !== null && eventSlug) {
      fetchSessions(year, event, eventSlug);
    }
  }, [year, event, eventSlug, fetchSessions]);

  // When session changes, fetch drivers
  useEffect(() => {
    if (year !== null && eventSlug && session !== null) {
      fetchDrivers(year, eventSlug, session);
    }
  }, [year, eventSlug, session, fetchDrivers]);

  // When drivers change, fetch their laps if not fetched
  useEffect(() => {
    if (year !== null && eventSlug && session !== null) {
      drivers.forEach((d) => {
        if (d.abbr && !driversLaps[d.abbr] && !loadingDriverLaps[d.abbr]) {
          fetchDriverLaps(year, eventSlug, session, d.abbr);
        }
      });
    }
  }, [year, eventSlug, session, drivers, driversLaps, loadingDriverLaps, fetchDriverLaps]);

  // Auto-select fastest lap when laps finish loading
  useEffect(() => {
    if (year !== null && eventSlug && session !== null) {
      drivers.forEach((d, index) => {
        if (d.abbr && d.lap === null && driversLaps[d.abbr]) {
          const laps = driversLaps[d.abbr];
          const best = laps.find(l => l.is_fastest && l.is_valid) ?? laps.find(l => l.is_valid);
          if (best) setDriverLap(index, best.lap_number);
        }
      });
    }
  }, [driversLaps, drivers, year, eventSlug, session, setDriverLap]);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const getDriverInfo = (abbr: string | null) =>
    apiDrivers.find((d) => d.abbreviation === abbr);

  const canLoad =
    year !== null &&
    event !== null &&
    session !== null &&
    drivers.length >= 2 &&
    drivers.every((d) => d.abbr !== null && d.lap !== null) &&
    !loadingTelemetry;

  const canReset =
    year !== null ||
    event !== null ||
    session !== null ||
    drivers.some((d) => d.abbr !== null);

  const availableSessions = sessions.filter((s) => s.available);

  const colors = ['#E10600', '#0090FF', '#00D2BE', '#FF8700', '#F596C8'];

  // ─── Collapsed summary bar ────────────────────────────────────────────────

  const selectionSummary = [
    year,
    event,
    session,
    drivers.length >= 2 ? `${drivers.map(d => d.abbr || '?').join(' vs ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (collapsed) {
    return (
      <div className="sticky top-[57px] z-40 border-b border-[var(--border)] bg-[var(--panel-bg)] shadow-md">
        <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
          <div className="flex h-10 items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)] truncate">
              {selectionSummary || 'No selection'}
            </span>
            <button
              onClick={onToggleCollapse}
              className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-chart)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-red-500 hover:text-red-500 transition-colors duration-150 ml-4"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              Show panel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky top-[57px] z-40 border-b border-[var(--border)] bg-[var(--panel-bg)] shadow-md">
      <div className="mx-auto max-w-screen-2xl px-4 py-3 sm:px-6">

        {/* ── Row 1: Dropdowns ── */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Year */}
          <StyledSelect
            id="sel-year"
            label="Year"
            value={year?.toString() ?? ''}
            onChange={(v) => setYear(Number(v))}
            disabled={loadingYears || years.length === 0}
            loading={loadingYears}
            placeholder="Year"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </StyledSelect>

          {/* Grand Prix */}
          <StyledSelect
            id="sel-event"
            label="Grand Prix"
            value={event ?? ''}
            onChange={(v) => setEvent(v)}
            disabled={!year || loadingEvents || events.length === 0}
            loading={loadingEvents}
            placeholder="Select Grand Prix"
          >
            {events.map((e) => (
              <option key={e.round} value={e.name}>
                R{e.round} — {e.name}
              </option>
            ))}
          </StyledSelect>

          {/* Session */}
          <StyledSelect
            id="sel-session"
            label="Session"
            value={session ?? ''}
            onChange={(v) => setSession(v)}
            disabled={!event || loadingSessions || availableSessions.length === 0}
            loading={loadingSessions}
            placeholder="Select Session"
          >
            {availableSessions.map((s) => (
              <option key={s.type} value={s.type}>
                {s.name}
              </option>
            ))}
          </StyledSelect>

          {/* Drivers */}
          {drivers.map((d, index) => (
            <div key={`dsel-${index}`} className="flex items-center gap-2">
              <StyledSelect
                id={`sel-driver${index + 1}`}
                label={`Driver ${index + 1}`}
                value={d.abbr ?? ''}
                onChange={(v) => setDriverAbbr(index, v)}
                disabled={!session || loadingDrivers || apiDrivers.length === 0}
                loading={loadingDrivers}
                placeholder={`Select Driver ${index + 1}`}
              >
                {apiDrivers.map((ad) => (
                  <option key={ad.abbreviation} value={ad.abbreviation}>
                    {ad.abbreviation} — {ad.full_name}
                  </option>
                ))}
              </StyledSelect>
              {drivers.length > 2 && (
                <button
                  onClick={() => removeDriver(index)}
                  className="mt-5 h-9 w-9 flex-shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-chart)] text-[var(--text-secondary)] hover:border-red-500 hover:text-red-500 transition-colors"
                  title="Remove Driver"
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          {/* Add Driver Button */}
          {drivers.length >= 2 && drivers.length < 5 && (
            <button
              onClick={addDriver}
              className="mt-5 flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--text-primary)] hover:text-[var(--text-primary)] transition-colors"
            >
              + Add Driver
            </button>
          )}

          {/* Action Buttons */}
          <div className="flex flex-shrink-0 items-end gap-2 pb-0">
            <button
              onClick={onLoadTelemetry}
              disabled={!canLoad}
              className={[
                'flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold',
                'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1',
                canLoad
                  ? 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800'
                  : 'cursor-not-allowed bg-[var(--bg-chart)] text-[var(--text-secondary)] opacity-50',
              ].join(' ')}
              title={canLoad ? 'Load and compare telemetry' : 'Complete all selections first'}
            >
              {loadingTelemetry ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Loading...
                </>
              ) : (
                <>
                  <span>Compare</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </>
              )}
            </button>

            <button
              onClick={onReset}
              disabled={!canReset}
              className={[
                'flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium',
                'border-[var(--border)] bg-[var(--bg-chart)] text-[var(--text-secondary)]',
                'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1',
                canReset
                  ? 'hover:border-red-500 hover:text-red-500'
                  : 'cursor-not-allowed opacity-40',
              ].join(' ')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 .49-3.51" />
              </svg>
              Reset
            </button>

            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-chart)] px-3 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--text-secondary)] transition-colors duration-150"
                title="Collapse selection panel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
                Hide
              </button>
            )}
          </div>
        </div>

        {/* ── Row 2: Lap Selectors ── */}
        {drivers.some(d => d.abbr) && (
          <div
            className="mt-3 grid gap-3"
            style={{ gridTemplateColumns: `repeat(${drivers.length}, minmax(0, 1fr))` }}
          >
            {(() => {
              const counts = new Map<string, number>();
              return drivers.map((d, index) => {
                const info = getDriverInfo(d.abbr);
                const dLaps = d.abbr ? driversLaps[d.abbr] || [] : [];
                const dLoading = d.abbr ? loadingDriverLaps[d.abbr] : false;
                const defaultColor = colors[index % colors.length];

                let rawColor = info?.team_color && info.team_color !== '' ? info.team_color : defaultColor;
                let finalColor = adjustColorForTheme(rawColor, theme);

                // Offset logic for teammates
                if (info) {
                  const count = counts.get(finalColor) || 0;
                  counts.set(finalColor, count + 1);
                  finalColor = offsetTeamColor(finalColor, count, theme);
                }

                return (
                  <div key={`dcol-${index}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div
                        className="h-3 w-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: finalColor }}
                      />
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {d.abbr ? `${d.abbr} — ${info?.full_name}` : `Select Driver ${index + 1}`}
                      </span>
                    </div>
                    <LapSelector
                      laps={dLaps}
                      selectedLap={d.lap}
                      onSelectLap={(lap) => setDriverLap(index, lap)}
                      driverColor={finalColor}
                      driverAbbr={d.abbr ?? undefined}
                      loading={dLoading}
                    />
                  </div>
                );
              });
            })()}
          </div>
        )}

        {/* ── Selection progress indicator ── */}
        <div className="mt-2 flex items-center gap-1.5">
          {[
            { label: 'Year', done: year !== null },
            { label: 'GP', done: event !== null },
            { label: 'Session', done: session !== null },
            ...drivers.flatMap((d, index) => [
              { label: `D${index + 1}`, done: d.abbr !== null },
              { label: `D${index + 1} Lap`, done: d.lap !== null },
            ]),
          ].map(({ label, done }, i, arr) => (
            <React.Fragment key={label}>
              <div className="flex items-center gap-1">
                <div
                  className={[
                    'h-1.5 w-1.5 rounded-full transition-colors duration-300',
                    done ? 'bg-green-500' : 'bg-[var(--border)]',
                  ].join(' ')}
                />
                <span
                  className={[
                    'text-[10px] font-medium hidden sm:block',
                    done ? 'text-green-500' : 'text-[var(--text-secondary)] opacity-50',
                  ].join(' ')}
                >
                  {label}
                </span>
              </div>
              {i < arr.length - 1 && (
                <div
                  className={[
                    'h-px flex-1 transition-colors duration-300',
                    done ? 'bg-green-500 opacity-40' : 'bg-[var(--border)]',
                  ].join(' ')}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
