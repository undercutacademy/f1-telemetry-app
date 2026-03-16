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

function AppInner() {
  const { theme } = useTheme();
  const selReset = useSelections((s) => s.reset);
  const year = useSelections((s) => s.year);
  const event = useSelections((s) => s.event);
  const session = useSelections((s) => s.session);
  const drivers = useSelections((s) => s.drivers);

  const telemetry = useTelemetry();

  const [displayedTelemetry, setDisplayedTelemetry] = useState<TelemetryData | null>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  // ─── Load telemetry handler ────────────────────────────────────────────────
  const handleLoadTelemetry = useCallback(async () => {
    if (
      year === null ||
      event === null ||
      session === null ||
      drivers.length < 2 ||
      !drivers.every(d => d.abbr !== null && d.lap !== null)
    ) {
      return;
    }

    const request: TelemetryRequest = {
      year,
      event,
      session,
      drivers: drivers.map(d => d.abbr!),
      laps: drivers.map(d => d.lap!),
    };

    await telemetry.fetchTelemetry(request);
  }, [year, event, session, drivers, telemetry.fetchTelemetry]);

  // Update displayed telemetry when new data arrives; auto-collapse panel
  React.useEffect(() => {
    if (telemetry.telemetryData) {
      setDisplayedTelemetry(telemetry.telemetryData);
      setIsPanelCollapsed(true);
    }
  }, [telemetry.telemetryData]);

  // ─── Reset handler ─────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    selReset();
    setDisplayedTelemetry(null);
    setIsPanelCollapsed(false);
    telemetry.clearTelemetry();
  }, [selReset, telemetry.clearTelemetry]);

  const showTelemetry = displayedTelemetry !== null && !telemetry.loadingTelemetry;

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

        {/* Telemetry content */}
        {showTelemetry && displayedTelemetry && (
          <div className="mx-auto max-w-screen-2xl px-4 pb-12 sm:px-6">

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
                    eventName={event || 'Unknown Event'}
                    sessionName={session || 'Unknown Session'}
                  />
                ))}

                {/* Delta Time Badge: Show delta between D1 and D2 only */}
                {displayedTelemetry.drivers.length >= 2 && (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm mt-2">
                    <h3 className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      Lap Time Delta (D1 vs D2)
                    </h3>
                    <p
                      className="mt-2 text-2xl font-bold font-mono"
                      style={{
                        color: Math.abs(
                          parseLapTime(displayedTelemetry.drivers[0].lap_time) -
                          parseLapTime(displayedTelemetry.drivers[1].lap_time)
                        ) < 0.001 ? 'var(--text-primary)' : '#10B981' // Green for non-zero delta
                      }}
                    >
                      {Math.abs(
                        parseLapTime(displayedTelemetry.drivers[0].lap_time) -
                        parseLapTime(displayedTelemetry.drivers[1].lap_time)
                      ).toFixed(3)}s
                    </p>
                  </div>
                )}
              </div>

              {/* Right Column: Track Map (8 cols on lg screens) */}
              <div className="lg:col-span-8 flex flex-col gap-1">
                <div className="mt-6 lg:mt-0">
                  <TrackMap telemetryData={displayedTelemetry} theme={theme} />
                </div>
              </div>
            </div>

            {/* ── Chart Stack ── */}
            <div className="mt-4">
              <ChartStack telemetryData={displayedTelemetry} theme={theme} />
            </div>
          </div>
        )}

        {/* Welcome / empty state */}
        {!showTelemetry && !telemetry.loadingTelemetry && !telemetry.error && (
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
