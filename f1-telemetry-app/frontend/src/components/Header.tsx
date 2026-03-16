import { useTheme } from '../context/ThemeContext';

// ─── Sun Icon ─────────────────────────────────────────────────────────────────

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

// ─── Moon Icon ────────────────────────────────────────────────────────────────

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}


// ─── Header Component ─────────────────────────────────────────────────────────

export default function Header() {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--panel-bg)] shadow-sm">
      {/* F1 racing stripe accent */}
      <div className="racing-stripe" />

      <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-3">
          {theme === 'dark' ? (
            <img src="/O%20F1%20WHITE.png" alt="OAT F1 Logo" className="h-8" />
          ) : (
            <img src="/O%20F1%20-%20BLACK.png" alt="OAT F1 Logo" className="h-8" />
          )}
          <div>
            <h1 className="text-lg font-bold leading-tight tracking-tight text-[var(--text-primary)] sm:text-xl">
              OAT - F1
            </h1>
            <p className="hidden text-xs text-[var(--text-secondary)] sm:block">
              Overcut Academy Telemetry F1
            </p>
          </div>
        </div>

        {/* Right: Theme toggle + info */}
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-[var(--text-secondary)] md:block">
            {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
          </span>
          <button
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-chart)] text-[var(--text-secondary)] transition-all duration-200 hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-[var(--panel-bg)]"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>
    </header>
  );
}
