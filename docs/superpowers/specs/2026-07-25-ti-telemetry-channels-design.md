# TracingInsights-style telemetry channels — design

**Date:** 2026-07-25
**Status:** Approved (user: "proceed")

## Goal

Add the four telemetry graphs from TracingInsights' lap-compare view that OAT-F1
lacks: **DRS**, **Driver Actions**, **Elevation**, **Vertical G**. Charts are
selectable via channel toggles; the existing 8 subplots and all current UX rules
(driver color order, mobile margins, lap validity) are unchanged.

Out of scope (explicitly deferred by user): sector/lap-analysis panels and
session-level charts (Race Trace, Lap Time Heatmap, Position Changes, Stint /
Tyre Strategy).

## Data pipeline (`f1-data` repo)

- `scripts/process_session.py`: emit `"z"` in each telemetry JSON — FastF1 `Z`
  column, interpolated to the 500-point distance grid, scaled ×0.1 to meters
  (same scale as x/y), rounded to 2 decimals, `[]` when the column is absent.
- `drs` is already emitted; no change.
- Re-backfill **2026 only**, run locally (GitHub Actions is blocked by F1
  livetiming since ~Jul 17), then push + purge jsDelivr. Older years keep
  working without elevation.

## Signal processing (`frontend/src/hooks/useTelemetry.ts` + parity port in `backend/services/processing.py`)

New per-driver channels on the common distance grid:

| Channel | Source | Method |
|---|---|---|
| `drs` | `drs` in JSON (already fetched) | `nearestBefore` normalization; FastF1 values 10/12/14 → 1 (open), else 0 |
| `elevation` | new `z` | `linearInterp`; meters |
| `vertical_g` | `z` + `time` | vz = dz/dt, az = dvz/dt ÷ 9.81, `npGrad` + `movingAvg` + clamp(−6, 6) — same recipe as longitudinal G |
| `actions` | throttle, brake, lateral G | Per-point class, priority order: 1 Braking (brake on) → 2 Full Throttle (throttle ≥ 98) → 3 Lift & Coast (throttle ≤ 5, no brake) → 4 Cornering (\|latG\| ≥ 1.5 and throttle < 98) → 5 Rolling (else) |

`RawTelFile` gains optional `z: number[]`. Missing/empty `z` ⇒ `elevation` and
`vertical_g` are empty arrays.

## Chart UI (`frontend/src/components/ChartStack.tsx` + new `ChannelToggles.tsx`)

- Checkbox-chip row above the chart. Existing 8 channels default **on**; new 4
  default **off**. Selection persisted in `localStorage`
  (`oat-f1.channel-toggles`, simple JSON of channel→bool).
- Subplot list and height weights become a filtered list. Weights: existing
  unchanged (Speed 3, Gear 1.5, others 1); DRS 0.7, Actions 0.7 × driver count,
  Elevation 1, Vertical G 1.
- **DRS:** filled 0/1 step band per driver, driver team colors.
- **Actions:** one heatmap lane per driver, discrete 5-color scale, theme-aware
  via CSS vars / `utils/colors.ts`; follow dataviz skill palette rules. Category
  labels shown in hover text.
- **Elevation:** single trace (driver 0) — track property, meters on y-axis.
- **Vertical G:** line per driver like Lat/Long G.
- **Degradation:** session files without `z` ⇒ Elevation + Vertical G chips
  disabled with tooltip "No elevation data for this session".

## Rollout

1. Frontend-only: DRS + Actions (works against current CDN data).
2. Pipeline change + local 2026 re-backfill + push + purge.
3. Elevation + Vertical G activate per-session as data arrives.

## Verification

No test infra exists: `npm run build` (tsc) must pass; manual check of one
re-backfilled 2026 session (12 charts) and one old session (chips disabled),
light + dark theme, mobile width (~375 px). Backend port verified by reading
parity against the TS implementation.
