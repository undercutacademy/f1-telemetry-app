# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

This repository contains the **OAT-F1 telemetry analyzer** (Overcut Academy). The app lives entirely under `f1-telemetry-app/`:

- `f1-telemetry-app/frontend/` — React + Vite + TypeScript SPA (Netlify).
- `f1-telemetry-app/backend/` — FastAPI + FastF1 server. **Not used in production** (see Architecture below); kept around for local development and reference.

Two other locations matter, even though they are separate repos checked out elsewhere on disk and listed as additional working directories:

- `C:\Users\lucas\OneDrive\Desktop\Cursor Projects\f1-data\scripts\` — the data-ingestion scripts that populate the CDN.
- `C:\Users\lucas\OneDrive\Desktop\Cursor Projects\f1-data\.github\workflows\` — the GitHub Actions that run those scripts (auto-process every 2h, backfill, schedule update).

## Architecture — the important thing to internalize

The frontend talks to a **CDN, not the backend**, in production. There is no live API.

```
[FastF1] → process_session.py (in f1-data repo)
        → commits pre-normalized JSON tree to github.com/undercutacademy/f1-data
        → jsDelivr / statically.io / githack serve those files
        → frontend `cdnGet()` fetches them directly
```

What this means concretely:

- All data fetching is in [useTelemetry.ts](f1-telemetry-app/frontend/src/hooks/useTelemetry.ts), which hits `cdn.jsdelivr.net/gh/undercutacademy/f1-data@master/...` with a fallback chain of three mirrors.
- The data is **pre-normalized to a 500-point common distance grid** by `process_session.py`. The frontend still does its own normalization on top (in case driver laps differ in length), plus delta-time, faster-segment, and G-force computation — that signal-processing code is a TypeScript port of `backend/services/processing.py`. **If you change one, you almost always need to change the other** to keep parity.
- The CDN tree shape is `<year>/<event-slug>/<session-type>/{drivers.json, corners.json, laps/<DRV>.json, telemetry/<DRV>_<lap>.json}` plus `<year>/events.json` and a top-level `index.json` listing available years. Event slugs come from `slugify()` in `process_session.py` (lowercase, non-alphanumerics → `-`).
- The FastAPI backend exposes the same data shape (events/sessions/drivers/laps/telemetry routes), but the production frontend does not call it. Backend changes do not ship anywhere unless you also rewire the frontend.

When deciding where to make a change:

- New telemetry channel / signal-processing tweak → port both `backend/services/processing.py` **and** `useTelemetry.ts`, **and** update `scripts/process_session.py` in the `f1-data` repo if the channel needs to be emitted in the pre-normalized JSON.
- New event metadata / schedule logic → `scripts/update_schedule.py` and `scripts/process_session.py` in the `f1-data` repo (and likely re-run a backfill).
- New chart / UI feature → frontend only.

## Running locally

`start.bat` (at repo root) is the canonical "just run it" path on Windows. It creates the Python venv on first run, installs deps, and launches both servers in separate windows:

- Backend on `http://localhost:8111` (uvicorn, `--reload`)
- Frontend on `http://localhost:3111` (Vite dev server)
- API docs on `http://localhost:8111/docs`

Vite is configured to proxy `/api/*` to the backend (see [vite.config.ts](f1-telemetry-app/frontend/vite.config.ts)), but **the production code path does not use that proxy** — it goes straight to the CDN. To exercise the backend locally you have to wire the frontend to call it (`useTelemetry.ts` would need to be swapped to hit `/api/...` instead of `cdnGet(...)`).

Manual equivalents:

```powershell
# Backend
cd f1-telemetry-app\backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8111 --reload

# Frontend
cd f1-telemetry-app\frontend
npm install
npm run dev          # dev server on :3111
npm run build        # tsc && vite build → dist/
npm run preview      # serve the built dist/
```

There are no test or lint scripts wired up in `package.json` or the backend. Type-check is just `tsc` (run as part of `npm run build`).

## Deployment

- **Frontend**: Netlify, configured by [netlify.toml](netlify.toml). Build base is `f1-telemetry-app/frontend`, build command is `npm run build`, publish dir is `f1-telemetry-app/frontend/dist`. SPA redirect to `/index.html` is set there. The `VITE_DATA_CDN_URL` build env points at the `undercutacademy/f1-data` jsDelivr URL.
- **Backend**: documented in [deploy_f1_app_guide.md](deploy_f1_app_guide.md) as a Render web service (root `f1-telemetry-app/backend`, start `uvicorn main:app --host 0.0.0.0 --port $PORT`), but again — production frontend does not depend on it. Treat the Render deployment, if it exists, as optional/historical.
- **Custom domain**: `f1.overcutacademy.com` via CNAME from Hostgator to the Netlify site.

## Backend specifics worth knowing

- **FastF1 HTTP cache** is a SQLite file at `backend/fastf1_cache/fastf1_http_cache.sqlite`. [main.py](f1-telemetry-app/backend/main.py) **deletes it on every server startup** and again every 2 hours via a background task — this is deliberate, so the schedule/results reflect freshly run sessions. Don't add code that assumes the cache persists across restarts.
- **App-level cache** ([services/cache.py](f1-telemetry-app/backend/services/cache.py)) is two-tier: in-memory dict + optional Upstash Redis REST. Redis kicks in only if `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. `cache.clear()` only wipes in-memory; Redis is intentionally left intact so cached sessions survive Render cold starts.
- **Session loader** ([services/fastf1_service.py](f1-telemetry-app/backend/services/fastf1_service.py)) keys cached `fastf1` session objects by `(year, event, session, level)` where level ∈ `{light, laps, full}`. A "light" load (≈20 MB) won't satisfy a "full" telemetry request, so the loader keeps separate entries instead of upgrading one in place. Keep this tiering if you touch it — full loads are ~400 MB.
- **CORS** is driven by the `FRONTEND_URL` env var (comma-separated allowed origins, default `*`).

## Frontend specifics worth knowing

- **State**: `useSelections` (Zustand, in [hooks/useSelections.ts](f1-telemetry-app/frontend/src/hooks/useSelections.ts)) owns year/event/session/drivers selection. Changing a parent selection resets all downstream selections — preserve that cascade if you add new selectors.
- **Theming**: `ThemeContext` toggles a `dark` class on `<html>`; all colors are CSS variables (`var(--bg-page)`, `var(--text-primary)`, `var(--panel-bg)`, `var(--border)`, `var(--text-secondary)`, `var(--bg-chart)`). Tailwind is configured with `darkMode: 'class'`. Don't hardcode hex colors in components — go through the CSS vars or `utils/colors.ts` (which has `adjustColorForTheme`, `offsetTeamColor`, `getContrastColor` for team-color manipulation).
- **Charts**: [components/ChartStack.tsx](f1-telemetry-app/frontend/src/components/ChartStack.tsx) builds a single Plotly figure with 8 stacked subplots (Speed/Delta/RPM/Gear/Throttle/Brake/Lat-G/Long-G). Subplot heights are weighted (Speed 3×, Gear 1.5×, others 1×). The "faster_segments" channel is per-driver booleans-as-0/1 used to colorize the speed trace.
- **Lap selection**: `LapInfo.is_valid` means the lap has usable telemetry (not in/out lap, not under red flag — see backend `get_laps`). Laps where `is_valid === false` must remain visually disabled and unclickable in `LapSelector` — this was an explicit fix in the recent commit history.

## A few conventions surfaced from recent work

- Auto-select the fastest valid lap when a driver is picked (`useSelections.setDriverAbbr` does not do this — it's set elsewhere in the selection flow; preserve that UX).
- Mobile layout uses tight horizontal margins around the chart; do not widen the chart's left margin without testing the small-screen case.
- Driver/lap order is preserved (not sorted) when forming the telemetry request — the frontend assigns colors by position, so reordering would change which color belongs to which driver.
