


interface DriverBadgeProps {
  abbreviation: string;
  fullName: string;
  color: string;
  position: string;
  lapTime?: string;
  lapNumber?: number;
  eventName: string;
  sessionName: string;
}

export default function DriverBadge({
  abbreviation,
  fullName,
  color,
  position,
  lapTime,
  lapNumber,
  eventName,
  sessionName,
}: DriverBadgeProps) {
  // The color is now expected to be pre-adjusted and offset before being passed to DriverBadge
  // So, we use it directly.

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm"
    >
      {/* Header: Dot + Name */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="font-bold text-[var(--text-primary)]">
            {fullName} ({abbreviation})
          </span>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{
            backgroundColor: color + '22',
            color: color,
            border: `1px solid ${color}44`,
          }}
        >
          {position}
        </span>
      </div>

      {/* Grid details */}
      <div className="grid grid-cols-2 gap-y-3 text-xs">
        <div>
          <span className="text-[var(--text-secondary)]">Event:</span>
          <p className="mt-0.5 font-medium text-[var(--text-primary)] truncate" title={eventName}>
            {eventName}
          </p>
        </div>
        <div>
          <span className="text-[var(--text-secondary)]">Session:</span>
          <p className="mt-0.5 font-medium text-[var(--text-primary)] truncate" title={sessionName}>
            {sessionName}
          </p>
        </div>
        <div>
          <span className="text-[var(--text-secondary)]">Selected Lap:</span>
          <p className="mt-0.5 font-medium text-[var(--text-primary)]">
            Lap {lapNumber ?? '-'}
          </p>
        </div>
        <div>
          <span className="text-[var(--text-secondary)]">Lap Time:</span>
          <p className="mt-0.5 font-medium font-mono" style={{ color: color }}>
            {lapTime ?? '-'}
          </p>
        </div>
      </div>
    </div>
  );
}
