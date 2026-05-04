import type { LapInfo } from '../types/telemetry';
import { TYRE_COLORS } from '../types/telemetry';
import { adjustColorForTheme, getContrastColor } from '../utils/colors';
import { useTheme } from '../context/ThemeContext';

interface LapSelectorProps {
  laps: LapInfo[];
  selectedLap: number | 'fastest' | null;
  onSelectLap: (lap: number | 'fastest') => void;
  driverColor: string;
  driverAbbr?: string;
  loading?: boolean;
}

// ─── Tyre Compound Chip ───────────────────────────────────────────────────────

function TyreChip({ compound }: { compound: string }) {
  const upper = compound?.toUpperCase() ?? 'UNKNOWN';
  const bg = TYRE_COLORS[upper] ?? TYRE_COLORS.UNKNOWN;
  const textColor = getContrastColor(bg);
  const label = upper.charAt(0); // S, M, H, I, W

  return (
    <span
      className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold shadow-sm"
      style={{ backgroundColor: bg, color: textColor }}
      title={upper}
    >
      {label}
    </span>
  );
}

// ─── Sector Time Display ──────────────────────────────────────────────────────

function SectorTime({ time }: { time: string }) {
  if (!time || time === 'N/A' || time === 'nan' || time.toLowerCase() === 'nan') {
    return <span className="text-[var(--text-secondary)] opacity-50">—</span>;
  }
  return <span>{time}</span>;
}

// ─── Skeleton Row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {[...Array(7)].map((_, i) => (
        <td key={i} className="px-2 py-1.5">
          <div className="skeleton h-4 rounded" />
        </td>
      ))}
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LapSelector({
  laps,
  selectedLap,
  onSelectLap,
  driverColor,
  driverAbbr,
  loading = false,
}: LapSelectorProps) {
  const { theme } = useTheme();
  const adjustedColor = adjustColorForTheme(driverColor, theme);

  // Find the fastest lap
  const fastestLap = laps.find((l) => l.is_fastest);
  const fastestLapNumber = fastestLap?.lap_number ?? null;

  const handleFastestClick = () => {
    onSelectLap('fastest');
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="skeleton h-5 w-24 rounded" />
          <div className="skeleton h-6 w-16 rounded-full" />
        </div>
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--bg-chart)]">
                {['Lap', 'Time', 'Cmp', 'S1', 'S2', 'S3', 'Life'].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left font-semibold text-[var(--text-secondary)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (laps.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-6">
        <p className="text-sm text-[var(--text-secondary)]">
          {driverAbbr ? `No laps available for ${driverAbbr}` : 'Select a driver to see laps'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3">
      {/* Header row */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-secondary)]">
          {driverAbbr ? `${driverAbbr} — Select Lap` : 'Select Lap'}
        </span>
        <div className="flex items-center gap-2">
          {/* Current selection indicator */}
          {selectedLap !== null && (
            <span
              className="text-xs font-medium"
              style={{ color: adjustedColor }}
            >
              {selectedLap === 'fastest' ? 'Fastest Selected' : `Lap ${selectedLap} Selected`}
            </span>
          )}
          {/* Fastest lap quick-select */}
          <button
            onClick={handleFastestClick}
            className="rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-yellow-400"
            style={{
              backgroundColor: selectedLap === 'fastest' ? '#FFD700' : '#FFD70022',
              color: selectedLap === 'fastest' ? '#000' : '#FFD700',
              border: '1px solid #FFD70066',
            }}
            title={fastestLap ? `Fastest: Lap ${fastestLapNumber} — ${fastestLap.lap_time}` : 'Fastest lap'}
          >
            Fastest
          </button>
        </div>
      </div>

      {/* Lap table */}
      <div className="lap-table-scroll overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--bg-chart)]">
              <th className="px-2 py-1.5 text-left font-semibold text-[var(--text-secondary)]">Lap</th>
              <th className="px-2 py-1.5 text-left font-semibold text-[var(--text-secondary)]">Time</th>
              <th className="px-2 py-1.5 text-center font-semibold text-[var(--text-secondary)]">Cmp</th>
              <th className="px-2 py-1.5 text-left font-semibold text-[var(--text-secondary)]">S1</th>
              <th className="px-2 py-1.5 text-left font-semibold text-[var(--text-secondary)]">S2</th>
              <th className="px-2 py-1.5 text-left font-semibold text-[var(--text-secondary)]">S3</th>
              <th className="px-2 py-1.5 text-right font-semibold text-[var(--text-secondary)]">Life</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {laps.map((lap) => {
              const isSelected =
                selectedLap === lap.lap_number ||
                (selectedLap === 'fastest' && lap.is_fastest);
              const isFastest = lap.is_fastest;
              const isPersonalBest = lap.is_personal_best;
              const isInvalid = !lap.is_valid;

              return (
                <tr
                  key={lap.lap_number}
                  onClick={isInvalid ? undefined : () => onSelectLap(lap.lap_number)}
                  className={`transition-colors duration-100 ${isInvalid ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  style={{
                    backgroundColor: isSelected
                      ? adjustedColor + '22'
                      : 'transparent',
                    borderLeft: isSelected
                      ? `3px solid ${adjustedColor}`
                      : isFastest
                      ? '3px solid #FFD700'
                      : '3px solid transparent',
                    opacity: isInvalid ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !isInvalid) {
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                        adjustedColor + '11';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                        'transparent';
                    }
                  }}
                  title={isInvalid ? 'No telemetry available for this lap' : undefined}
                >
                  {/* Lap number */}
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="font-mono font-semibold"
                        style={{ color: isSelected ? adjustedColor : 'var(--text-primary)' }}
                      >
                        {lap.lap_number}
                      </span>
                      {isFastest && (
                        <span className="text-[10px] leading-none" title="Fastest lap">
                          ★
                        </span>
                      )}
                      {isPersonalBest && !isFastest && (
                        <span
                          className="text-[10px] leading-none"
                          style={{ color: '#9B59B6' }}
                          title="Personal best"
                        >
                          PB
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Lap time */}
                  <td className="px-2 py-1.5">
                    <span
                      className="font-mono tabular-nums"
                      style={{
                        color: isFastest
                          ? '#FFD700'
                          : isPersonalBest
                          ? '#9B59B6'
                          : 'var(--text-primary)',
                        fontWeight: isFastest || isPersonalBest ? '600' : '400',
                      }}
                    >
                      {lap.lap_time}
                    </span>
                  </td>

                  {/* Tyre compound */}
                  <td className="px-2 py-1.5 text-center">
                    <TyreChip compound={lap.compound} />
                  </td>

                  {/* Sectors */}
                  <td className="px-2 py-1.5 font-mono tabular-nums text-[var(--text-secondary)]">
                    <SectorTime time={lap.sector1} />
                  </td>
                  <td className="px-2 py-1.5 font-mono tabular-nums text-[var(--text-secondary)]">
                    <SectorTime time={lap.sector2} />
                  </td>
                  <td className="px-2 py-1.5 font-mono tabular-nums text-[var(--text-secondary)]">
                    <SectorTime time={lap.sector3} />
                  </td>

                  {/* Tyre life */}
                  <td className="px-2 py-1.5 text-right text-[var(--text-secondary)]">
                    {lap.tyre_life ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-[var(--text-secondary)]">
        <span className="flex items-center gap-1">
          <span className="text-yellow-400">★</span> Fastest Lap
        </span>
        <span className="flex items-center gap-1">
          <span style={{ color: '#9B59B6' }}>PB</span> Personal Best
        </span>
        <span className="flex items-center gap-1 opacity-50">
          <span>~~</span> Invalid
        </span>
      </div>
    </div>
  );
}
