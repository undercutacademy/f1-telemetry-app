import React, { useState, useCallback } from 'react';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { useSelections } from './hooks/useSelections';
import { useTelemetry } from './hooks/useTelemetry';
import type { TelemetryData, TelemetryRequest } from './types/telemetry';
import Header from './components/Header';
import SelectionPanel from './components/SelectionPanel';
import TrackMap from './components/TrackMap';
import ChartStack from './components/ChartStack';
import DriverBadge from './components/DriverBadge';
import LoadingState from './components/LoadingState';
import SessionAnalysis from './components/analysis/SessionAnalysis';
import { buildShareSearch, readSharedSelection, replaceUrlSearch } from './utils/shareUrl';

// ─── Helper: Parse string lap time (1:04.301) to seconds ─────────────────────
export function parseLapTime(lapTime: string | undefined): number {
  if (!lapTime || lapTime === '-') return 0;
  // Format MM:SS.ms or SS.ms
  const parts = lapTime.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(lapTime);
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mx-auto mt-4 max-w-screen-2xl px-4 sm:px-6">
      <div className="flex items-start gap-3 rounded-xl border border-red-500 border-opacity-40 bg-red-500 bg-opacity-10 p-4">
        <div className="flex-shrink-0 mt-0.5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#EF4444"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-400">Error</p>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)] break-words">{message}</p>
        </div>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 rounded-lg p-1 text-[var(--text-secondary)] hover:text-red-400 focus:outline-none"
          aria-label="Dismiss error"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Welcome / empty state ────────────────────────────────────────────────────

function WelcomeState() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div className="mx-auto mt-12 max-w-2xl px-4 text-center sm:px-6">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-10 shadow-sm">
        {/* Track outline illustration */}
        <div className="mb-6 flex justify-center">
          <img
            src={isDark ? '/Overcut.White.Letters.png' : '/Overcut.Black.Letters.png'}
            alt="Overcut Academy Logo"
            className="h-20 object-contain"
          />
        </div>

        <h2 className="text-2xl font-bold text-[var(--text-primary)]">OAT - F1</h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          Overcut Academy is happy to present you with OAT F1, a telemetry analyzer for the F1, this is completely free, we just want people to have fun analyzing data. Feel free to use and share this page with your friends.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          Compare lap telemetry data between any two drivers across any season, race weekend, and
          session. Analyze speed traces, delta times, gear patterns, G-forces and more.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: '🏎', label: 'Speed Traces' },
            { icon: '⏱', label: 'Delta Time' },
            { icon: '⚙', label: 'Gear & RPM' },
            { icon: '📡', label: 'G-Forces' },
          ].map(({ icon, label }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-1.5 rounded-xl bg-[var(--bg-chart)] p-3"
            >
              <span className="text-2xl">{icon}</span>
              <span className="text-xs font-medium text-[var(--text-secondary)]">{label}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-lg bg-[var(--bg-chart)] p-3 text-left">
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
            How to get started
          </p>
          <ol className="space-y-1 text-xs text-[var(--text-secondary)]">
            <li>1. Select a year and Grand Prix from the panel above</li>
            <li>2. Choose a session (Race, Qualifying, Practice)</li>
            <li>3. Pick two drivers to compare</li>
            <li>4. Select laps for each driver (or use "Fastest")</li>
            <li>5. Click <span className="font-semibold text-red-500">Compare</span> to load telemetry</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

// ─── Inner App (has access to ThemeContext) ───────────────────────────────────

type RestoreStage = 'year' | 'event' | 'session' | 'drivers' | 'done';

function ShareButton() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2500);
  };
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm">
      <h3 className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
        Share this comparison
      </h3>
      <button
        type="button"
        onClick={copy}
        className="mt-2 inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        {state === 'copied' ? 'Link copied' : 'Copy link'}
      </button>
      {state === 'failed' && (
        <p className="mt-2 break-all text-xs text-[var(--text-secondary)]">
          Copy this link: {window.location.href}
        </p>
      )}
    </div>
  );
}

function AppInner() {
  const { theme } = useTheme();
  const selReset = useSelections((s) => s.reset);
  const year = useSelections((s) => s.year);
  const event = useSelections((s) => s.event);
  const session = useSelections((s) => s.session);
  const drivers = useSelections((s) => s.drivers);
  const setYear = useSelections((s) => s.setYear);
  const setEvent = useSelections((s) => s.setEvent);
  const setSession = useSelections((s) => s.setSession);
  const setDrivers = useSelections((s) => s.setDrivers);
  const setDriverLap = useSelections((s) => s.setDriverLap);

  const telemetry = useTelemetry();

  const [displayedTelemetry, setDisplayedTelemetry] = useState<TelemetryData | null>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  // Captured at compare time so the dashboard keeps describing the loaded laps
  // even after the user starts picking a different session.
  const [displayedLabel, setDisplayedLabel] = useState({ event: '', session: '', full: '' });
  const lastRequest = React.useRef<TelemetryRequest | null>(null);

  const slug = telemetry.events.find(e => e.name === event)?.slug ?? '';
  const sessionName = telemetry.sessions.find(s => s.type === session)?.name ?? session ?? '';

  // ─── Load telemetry handler ────────────────────────────────────────────────
  // Reads the store directly so it can be fired from effects in the same tick a
  // selection changes, without waiting for a re-render.
  const handleLoadTelemetry = useCallback(async () => {
    const st = useSelections.getState();
    if (
      st.year === null ||
      st.event === null ||
      st.session === null ||
      st.drivers.length < 2 ||
      !st.drivers.every(d => d.abbr !== null && d.lap !== null)
    ) {
      return;
    }

    const request: TelemetryRequest = {
      year: st.year,
      event: st.event,
      slug: telemetry.events.find(e => e.name === st.event)?.slug ?? '',
      session: st.session,
      drivers: st.drivers.map(d => d.abbr!),
      laps: st.drivers.map(d => d.lap!),
    };
    lastRequest.current = request;
    const sName = telemetry.sessions.find(s => s.type === st.session)?.name ?? st.session;
    setDisplayedLabel({ event: st.event, session: sName, full: `${st.year} ${st.event} · ${sName}` });

    await telemetry.fetchTelemetry(request);
  }, [telemetry.events, telemetry.sessions, telemetry.fetchTelemetry]);

  // Update displayed telemetry when new data arrives; auto-collapse panel and
  // put the comparison in the URL so it can be shared.
  React.useEffect(() => {
    if (telemetry.telemetryData) {
      setDisplayedTelemetry(telemetry.telemetryData);
      setIsPanelCollapsed(true);
      const req = lastRequest.current;
      if (req) {
        replaceUrlSearch(buildShareSearch(req.year, req.slug, req.session,
          telemetry.telemetryData.drivers.map(d => ({ abbr: d.abbreviation, lap: d.lap_number }))));
      }
    }
  }, [telemetry.telemetryData]);

  // ─── Restore a shared link (?y=&e=&s=&d=) step by step as data arrives ──────
  const shared = React.useRef(readSharedSelection());
  const [restoreStage, setRestoreStage] = useState<RestoreStage>(shared.current ? 'year' : 'done');
  const [pendingCompare, setPendingCompare] = useState(false);

  React.useEffect(() => {
    const target = shared.current;
    if (!target || restoreStage === 'done') return;

    if (restoreStage === 'year' && telemetry.years.length) {
      if (!telemetry.years.includes(target.year)) { setRestoreStage('done'); return; }
      setYear(target.year);
      setRestoreStage('event');
    } else if (restoreStage === 'event' && telemetry.events.length && !telemetry.loadingEvents) {
      const ev = telemetry.events.find(e => e.slug === target.slug);
      if (!ev) { setRestoreStage('done'); return; }
      setEvent(ev.name);
      setRestoreStage('session');
    } else if (restoreStage === 'session' && telemetry.sessions.length && !telemetry.loadingSessions) {
      const s = telemetry.sessions.find(x => x.type === target.session && x.available);
      if (!s) { setRestoreStage('done'); return; }
      setSession(s.type);
      setRestoreStage('drivers');
    } else if (restoreStage === 'drivers' && telemetry.drivers.length && !telemetry.loadingDrivers) {
      const valid = target.drivers.filter(d => telemetry.drivers.some(a => a.abbreviation === d.abbr));
      if (valid.length) setDrivers(valid.map(d => ({ abbr: d.abbr, lap: d.lap })));
      if (valid.length >= 2) setPendingCompare(true);
      setRestoreStage('done');
    }
  }, [restoreStage, telemetry.years, telemetry.events, telemetry.loadingEvents, telemetry.sessions,
    telemetry.loadingSessions, telemetry.drivers, telemetry.loadingDrivers, setYear, setEvent, setSession, setDrivers]);

  // ─── Compare once every selected driver has a usable lap ────────────────────
  React.useEffect(() => {
    if (!pendingCompare) return;
    if (drivers.length < 2 || drivers.some(d => !d.abbr)) {
      // Not enough drivers to compare yet: open the panel so the user can finish.
      setPendingCompare(false);
      setIsPanelCollapsed(false);
      return;
    }
    if (drivers.some(d => d.lap === null || !telemetry.driversLaps[d.abbr!])) return; // still loading

    // A shared or clicked lap without telemetry (in/out lap, red flag) falls back to the fastest lap.
    let corrected = false;
    drivers.forEach((d, i) => {
      const laps = telemetry.driversLaps[d.abbr!];
      if (typeof d.lap === 'number' && !laps.some(l => l.lap_number === d.lap && l.is_valid)) {
        const best = laps.find(l => l.is_fastest && l.is_valid) ?? laps.find(l => l.is_valid);
        if (best && best.lap_number !== d.lap) { setDriverLap(i, best.lap_number); corrected = true; }
      }
    });
    if (corrected) return;

    setPendingCompare(false);
    handleLoadTelemetry();
  }, [pendingCompare, drivers, telemetry.driversLaps, setDriverLap, handleLoadTelemetry]);

  // Safety valve: a driver with no usable laps would otherwise leave a compare
  // armed indefinitely and fire on some unrelated later change.
  React.useEffect(() => {
    if (!pendingCompare) return;
    const t = setTimeout(() => setPendingCompare(false), 20000);
    return () => clearTimeout(t);
  }, [pendingCompare]);

  // ─── Clicking a lap in a session chart loads its telemetry ─────────────────
  const handlePickLap = useCallback((abbr: string, lap: number) => {
    const st = useSelections.getState();
    const idx = st.drivers.findIndex(d => d.abbr === abbr);
    if (idx >= 0) {
      st.setDriverLap(idx, lap);
    } else {
      const empty = st.drivers.findIndex(d => d.abbr === null);
      if (empty >= 0) st.setDriver(empty, abbr, lap);
      else if (st.drivers.length < 5) st.addDriver({ abbr, lap });
      else st.setDriver(st.drivers.length - 1, abbr, lap);
    }
    setPendingCompare(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // ─── Reset handler ─────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    selReset();
    setDisplayedTelemetry(null);
    setIsPanelCollapsed(false);
    telemetry.clearTelemetry();
    replaceUrlSearch('');
  }, [selReset, telemetry.clearTelemetry]);

  const showTelemetry = displayedTelemetry !== null && !telemetry.loadingTelemetry;
  const showAnalysis = year !== null && event !== null && session !== null && !!slug && telemetry.drivers.length > 0;
  const focus = drivers.map(d => d.abbr).filter((a): a is string => !!a);

  const d1 = displayedTelemetry?.drivers[0];
  const d2 = displayedTelemetry?.drivers[1];
  const lapDelta = d1 && d2 ? parseLapTime(d2.lap_time) - parseLapTime(d1.lap_time) : 0;

  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      {/* ── Header ── */}
      <Header />

      {/* ── Main content ── */}
      <main>
        {/* Selection Panel — sticky below header */}
        <SelectionPanel
          years={telemetry.years}
          events={telemetry.events}
          sessions={telemetry.sessions}
          drivers={telemetry.drivers}
          driversLaps={telemetry.driversLaps}
          loadingYears={telemetry.loadingYears}
          loadingEvents={telemetry.loadingEvents}
          loadingSessions={telemetry.loadingSessions}
          loadingDrivers={telemetry.loadingDrivers}
          loadingDriverLaps={telemetry.loadingDriverLaps}
          loadingTelemetry={telemetry.loadingTelemetry}
          onLoadTelemetry={handleLoadTelemetry}
          onReset={handleReset}
          fetchEvents={telemetry.fetchEvents}
          fetchSessions={telemetry.fetchSessions}
          fetchDrivers={telemetry.fetchDrivers}
          fetchDriverLaps={telemetry.fetchDriverLaps}
          collapsed={isPanelCollapsed}
          onToggleCollapse={() => setIsPanelCollapsed((v) => !v)}
        />

        {/* Error banner */}
        {telemetry.error && (
          <ErrorBanner message={telemetry.error} onDismiss={telemetry.clearError} />
        )}

        {/* Full-screen loading overlay for telemetry fetch */}
        {telemetry.loadingTelemetry && (
          <LoadingState
            message="Loading telemetry data..."
            fullScreen
          />
        )}

        <div className="mx-auto max-w-screen-2xl px-4 pb-12 sm:px-6">
          {/* Telemetry content */}
          {showTelemetry && displayedTelemetry && (
            <>
              {/* ── Main Dashboard Layout ── */}
              <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">

                {/* Left Column: Session Details (4 cols on lg screens) */}
                <div className="lg:col-span-4 flex flex-col gap-4">
                  <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                    Session Details
                  </h2>

                  {displayedTelemetry.drivers.map((drv, idx) => (
                    <DriverBadge
                      key={idx}
                      abbreviation={drv.abbreviation}
                      fullName={drv.full_name}
                      color={drv.team_color}
                      position={`Driver ${idx + 1}`}
                      lapTime={drv.lap_time}
                      lapNumber={drv.lap_number}
                      eventName={displayedLabel.event || 'Unknown Event'}
                      sessionName={displayedLabel.session || 'Unknown Session'}
                    />
                  ))}

                  {/* Lap time delta between D1 and D2, signed: who was faster and by how much */}
                  {d1 && d2 && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm mt-2">
                      <h3 className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                        Lap Time Delta (D1 vs D2)
                      </h3>
                      <p className="mt-2 text-2xl font-bold font-mono text-[var(--text-primary)]">
                        {Math.abs(lapDelta).toFixed(3)}s
                      </p>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {Math.abs(lapDelta) < 0.001
                          ? 'Identical lap times'
                          : `${lapDelta > 0 ? d1.abbreviation : d2.abbreviation} faster`}
                      </p>
                    </div>
                  )}

                  <ShareButton />
                </div>

                {/* Right Column: Track Map (8 cols on lg screens) */}
                <div className="lg:col-span-8 flex flex-col gap-1">
                  <div className="mt-6 lg:mt-0">
                    <TrackMap telemetryData={displayedTelemetry} theme={theme} label={displayedLabel.full} />
                  </div>
                </div>
              </div>

              {/* ── Chart Stack ── */}
              <div className="mt-4">
                <ChartStack telemetryData={displayedTelemetry} theme={theme} label={displayedLabel.full} />
              </div>
            </>
          )}

          {/* Session-wide analysis: every driver, every lap */}
          {showAnalysis && (
            <SessionAnalysis
              year={year}
              eventName={event}
              slug={slug}
              sessionType={session}
              sessionName={sessionName}
              drivers={telemetry.drivers}
              focus={focus}
              theme={theme}
              onPickLap={handlePickLap}
            />
          )}
        </div>

        {/* Welcome / empty state */}
        {!showTelemetry && !showAnalysis && !telemetry.loadingTelemetry && !telemetry.error && (
          <WelcomeState />
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--border)] bg-[var(--panel-bg)] py-4 mt-auto">
        <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <p className="text-xs text-[var(--text-secondary)]">
              Powered by{' '}
              <a
                href="https://www.overcutacademy.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-red-500 hover:text-red-400 hover:underline"
              >
                Overcut Academy
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Root App with providers ──────────────────────────────────────────────────

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
