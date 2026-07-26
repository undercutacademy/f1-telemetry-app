import { useState, useCallback } from 'react';

export interface ToggleItem {
  key: string;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}

const STORAGE_KEY = 'oat-f1.channel-toggles';

export function useChannelToggles(
  defaults: Record<string, boolean>
): [Record<string, boolean>, (key: string) => void] {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  });

  const toggle = useCallback((key: string) => {
    setEnabled(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  return [enabled, toggle];
}

export default function ChannelToggles({ items, enabled, onToggle }: {
  items: ToggleItem[];
  enabled: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-4 py-2">
      {items.map(item => {
        const on = enabled[item.key] && !item.disabled;
        return (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            title={item.disabled ? item.disabledReason : undefined}
            onClick={() => onToggle(item.key)}
            className={
              'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ' +
              (item.disabled
                ? 'cursor-not-allowed border-[var(--border)] text-[var(--text-secondary)] opacity-40'
                : on
                  ? 'border-transparent bg-[var(--text-primary)] text-[var(--bg-chart)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]')
            }
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
