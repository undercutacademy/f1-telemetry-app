import React from 'react';

interface LoadingStateProps {
  message?: string;
  fullScreen?: boolean;
}

export default function LoadingState({
  message = 'Loading...',
  fullScreen = false,
}: LoadingStateProps) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-4 py-8">
      {/* F1-inspired animated spinner */}
      <div className="relative h-16 w-16">
        {/* Outer ring */}
        <div className="absolute inset-0 animate-spin rounded-full border-4 border-[var(--border)] border-t-red-600" />
        {/* Inner ring (counter-rotating) */}
        <div
          className="absolute inset-2 rounded-full border-4 border-[var(--border)] border-b-red-400"
          style={{ animation: 'spin 1.5s linear infinite reverse' }}
        />
        {/* Center dot */}
        <div className="absolute inset-[22px] rounded-full bg-red-600" />
      </div>

      {/* Message */}
      <div className="text-center">
        <p className="text-sm font-medium text-[var(--text-primary)]">{message}</p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          FastF1 may take a moment to cache data
        </p>
      </div>

      {/* Animated dots */}
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-bounce rounded-full bg-red-600"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-page)] bg-opacity-90 backdrop-blur-sm">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-10 shadow-2xl">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-8">
      {content}
    </div>
  );
}

// ─── Skeleton Loader ──────────────────────────────────────────────────────────

export function SkeletonBlock({
  height = 'h-8',
  width = 'w-full',
  className = '',
}: {
  height?: string;
  width?: string;
  className?: string;
}) {
  return <div className={`skeleton rounded-lg ${height} ${width} ${className}`} />;
}
