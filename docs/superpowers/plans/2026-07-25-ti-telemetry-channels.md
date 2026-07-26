# TracingInsights-style Telemetry Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DRS, Driver Actions, Elevation and Vertical G subplots to the telemetry chart, behind a channel-toggle chip row, with the Z data channel added to the CDN pipeline.

**Architecture:** Frontend computes the new channels in `useTelemetry.ts` (mirroring the existing delta/G-force pattern) and `ChartStack.tsx` filters its subplot list by a persisted toggle state. The `f1-data` ingestion script gains a `z` field; the FastAPI backend gets a parity port. Sessions without `z` gracefully disable the two elevation-based charts.

**Tech Stack:** React + TypeScript + Plotly (frontend), Python + FastF1 + numpy (pipeline/backend).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-ti-telemetry-channels-design.md`
- No test framework exists in either repo. Verification = `npm run build` (runs `tsc`) for frontend tasks; `python -m py_compile` + a small run-script for Python tasks.
- Never hardcode theme colors in components — use CSS vars / `utils/colors.ts` (CLAUDE.md).
- Driver order and color assignment logic must not change.
- Existing 8 subplots default ON; new 4 default OFF. localStorage key: `oat-f1.channel-toggles`.
- Action classification priority (spec): Braking → Full Throttle (≥98) → Lift & Coast (≤5, no brake) → Cornering (|latG| ≥ 1.5) → Rolling. Codes 0–4 in that order.
- DRS open = FastF1 raw values {10, 12, 14} → 1, else 0.
- Z is emitted in meters (FastF1 value × 0.1), like x/y.
- Frontend repo: `F1 Data analysis` (this repo). Pipeline repo: `C:\Users\lucas\OneDrive\Desktop\Cursor Projects\f1-data`.
- End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: New channel types + computation in the frontend data layer

**Files:**
- Modify: `f1-telemetry-app/frontend/src/types/telemetry.ts:3-13` (TelemetryChannels)
- Modify: `f1-telemetry-app/frontend/src/hooks/useTelemetry.ts` (RawTelFile ~line 155, computation ~lines 104-151, normalization + response assembly ~lines 342-424)

**Interfaces:**
- Consumes: existing helpers `linearInterp`, `nearestBefore`, `npGrad`, `movingAvg`, `clamp`, `NUM_POINTS` in `useTelemetry.ts`.
- Produces: `TelemetryChannels` gains `drs: number[]`, `actions: number[]`, `elevation: number[]`, `vertical_g: number[]`. `elevation`/`vertical_g` are `[]` when the session file has no `z`. Task 3 renders these exact keys.

- [ ] **Step 1: Extend `TelemetryChannels`** in `types/telemetry.ts`:

```ts
export interface TelemetryChannels {
  speed: number[];
  rpm: number[];
  gear: number[];
  throttle: number[];
  brake: number[];
  delta_time: number[];
  lateral_g: number[];
  longitudinal_g: number[];
  faster_segments: number[];
  drs: number[];
  actions: number[];
  elevation: number[];   // meters; [] when session has no z data
  vertical_g: number[];  // [] when session has no z data
}
```

- [ ] **Step 2: Extend `RawTelFile`** in `useTelemetry.ts` — add `z?: number[];` after `y: number[];`.

- [ ] **Step 3: Add computation helpers** in `useTelemetry.ts`, directly after `computeFasterSegments`:

```ts
const DRS_OPEN = new Set([10, 12, 14]);

// Spec priority order — codes are stable and rendered by ChartStack's ACTION_CATEGORIES.
function computeActions(throttle: number[], brake: number[], lateralG: number[]): number[] {
  return throttle.map((t, i) => {
    if (brake[i] > 0) return 0;                  // Braking
    if (t >= 98) return 1;                       // Full Throttle
    if (t <= 5) return 2;                        // Lift & Coast
    if (Math.abs(lateralG[i] ?? 0) >= 1.5) return 3; // Cornering
    return 4;                                    // Rolling
  });
}

function computeVerticalG(elevation: number[], time: number[]): number[] {
  if (elevation.length !== NUM_POINTS) return [];
  const dt = npGrad(time).map(v => (Math.abs(v) < 1e-6 ? 1e-6 : v));
  const vz = npGrad(elevation).map((dz, i) => dz / dt[i]);
  const az = npGrad(vz).map((dv, i) => dv / dt[i] / 9.81);
  return clamp(movingAvg(az), -6, 6).map(v => Math.round(v * 1e4) / 1e4);
}
```

- [ ] **Step 4: Normalize the new inputs** — in the `normalized = telFiles.map(...)` block, add to the returned object:

```ts
drs: tel.drs && tel.drs.length
  ? nearestBefore(d, tel.drs.map(v => (DRS_OPEN.has(v) ? 1 : 0)), commonDist)
  : new Array(NUM_POINTS).fill(0),
elevation: tel.z && tel.z.length ? linearInterp(d, tel.z, commonDist) : [],
```

- [ ] **Step 5: Assemble the new channels** — after the `accels` computation add:

```ts
const verticalGs = normalized.map(n => computeVerticalG(n.elevation, n.time));
const actions = normalized.map((n, i) =>
  computeActions(n.throttle, n.brake, accels[i].lateral_g)
);
```

and in the `channels:` object of the response:

```ts
drs:        normalized[i].drs,
actions:    actions[i],
elevation:  normalized[i].elevation,
vertical_g: verticalGs[i],
```

- [ ] **Step 6: Verify** — `cd f1-telemetry-app/frontend && npm run build`. Expected: clean tsc + vite build. (The new channels are unrendered so the UI is unchanged.)

- [ ] **Step 7: Commit**

```bash
git add f1-telemetry-app/frontend/src/types/telemetry.ts f1-telemetry-app/frontend/src/hooks/useTelemetry.ts
git commit -m "feat(telemetry): compute drs, actions, elevation, vertical_g channels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: ChannelToggles component with persisted state

**Files:**
- Create: `f1-telemetry-app/frontend/src/components/ChannelToggles.tsx`

**Interfaces:**
- Produces (consumed by Task 3):

```ts
export interface ToggleItem { key: string; label: string; disabled?: boolean; disabledReason?: string }
export default function ChannelToggles(props: {
  items: ToggleItem[];
  enabled: Record<string, boolean>;
  onToggle: (key: string) => void;
}): JSX.Element
export function useChannelToggles(defaults: Record<string, boolean>):
  [Record<string, boolean>, (key: string) => void]
```

- [ ] **Step 1: Write the component + hook**:

```tsx
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
```

- [ ] **Step 2: Verify** — `npm run build` passes (component compiles even though unused; tsc `noUnusedLocals` applies to locals, not exports).

- [ ] **Step 3: Commit**

```bash
git add f1-telemetry-app/frontend/src/components/ChannelToggles.tsx
git commit -m "feat(ui): ChannelToggles chip row with localStorage persistence

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Dynamic subplots + four new chart renderings in ChartStack

Read the `dataviz` skill before writing chart colors (session rule). The action-lane palette below is the starting point; adjust per that skill if it conflicts.

**Files:**
- Modify: `f1-telemetry-app/frontend/src/components/ChartStack.tsx` (whole file — module-level constants become functions of the active config list)

**Interfaces:**
- Consumes: `TelemetryChannels` keys from Task 1 (`drs`, `actions`, `elevation`, `vertical_g`); `ChannelToggles` + `useChannelToggles` from Task 2.
- Produces: no new exports; `ChartStackProps` unchanged (`telemetryData`, `theme`).

- [ ] **Step 1: Extend `ChartConfig` and `CHART_CONFIGS`**:

```ts
interface ChartConfig {
  title: string;
  channel: keyof TelemetryChannels;
  label: string;          // chip label
  defaultOn: boolean;
  weight: number;
  yRange?: [number, number];
  isStep?: boolean;
  isDelta?: boolean;
  isFill?: boolean;
  isHeatmap?: boolean;     // actions lanes
  firstDriverOnly?: boolean; // elevation
  needsElevation?: boolean;  // disable chip when session has no z
  unit?: string;
}

const CHART_CONFIGS: ChartConfig[] = [
  { title: 'Speed (km/h)', channel: 'speed', label: 'Speed', defaultOn: true, weight: 3, yRange: [0, 380], unit: 'km/h' },
  { title: 'Delta Time (s)', channel: 'delta_time', label: 'Delta', defaultOn: true, weight: 1, unit: 's', isDelta: true },
  { title: 'RPM', channel: 'rpm', label: 'RPM', defaultOn: true, weight: 1, yRange: [5000, 14000], unit: 'RPM' },
  { title: 'Gear', channel: 'gear', label: 'Gear', defaultOn: true, weight: 1.5, yRange: [0, 9], isStep: true },
  { title: 'Throttle (%)', channel: 'throttle', label: 'Throttle', defaultOn: true, weight: 1, yRange: [0, 100], unit: '%', isFill: true },
  { title: 'Brake', channel: 'brake', label: 'Brake', defaultOn: true, weight: 1, yRange: [-0.1, 1.1], isStep: true, isFill: true },
  { title: 'Lateral G', channel: 'lateral_g', label: 'Lat G', defaultOn: true, weight: 1, unit: 'G' },
  { title: 'Long. G', channel: 'longitudinal_g', label: 'Long G', defaultOn: true, weight: 1, unit: 'G' },
  { title: 'DRS', channel: 'drs', label: 'DRS', defaultOn: false, weight: 0.7, yRange: [-0.1, 1.1], isStep: true },
  { title: 'Actions', channel: 'actions', label: 'Actions', defaultOn: false, weight: 1, isHeatmap: true },
  { title: 'Elevation (m)', channel: 'elevation', label: 'Elev', defaultOn: false, weight: 1, unit: 'm', firstDriverOnly: true, needsElevation: true },
  { title: 'Vertical G', channel: 'vertical_g', label: 'Vert G', defaultOn: false, weight: 1, unit: 'G', needsElevation: true },
];

const ACTION_CATEGORIES = [
  { code: 0, label: 'Braking',       color: '#EF4444' },
  { code: 1, label: 'Full Throttle', color: '#22C55E' },
  { code: 2, label: 'Lift & Coast',  color: '#F59E0B' },
  { code: 3, label: 'Cornering',     color: '#3B82F6' },
  { code: 4, label: 'Rolling',       color: '#9CA3AF' },
];
```

- [ ] **Step 2: Make geometry functions take the active list.** Delete module-level `NUM_CHARTS`, `CHART_WEIGHTS`, `TOTAL_WEIGHT`, `TOTAL_GAP`, `UNIT_HEIGHT`, and rewrite:

```ts
const GAP = 0.012;

function totalWeight(configs: ChartConfig[]): number {
  return configs.reduce((a, c) => a + c.weight, 0);
}

function getSubplotDomain(configs: ChartConfig[], row: number): [number, number] {
  const unit = (1 - GAP * (configs.length - 1)) / totalWeight(configs);
  let topOffset = 0;
  for (let i = 0; i < row; i++) topOffset += configs[i].weight * unit + GAP;
  const top = 1 - topOffset;
  const bottom = top - configs[row].weight * unit;
  return [Math.max(0, bottom), Math.min(1, top)];
}
```

`buildTraces` and `buildLayout` gain a `configs: ChartConfig[]` first parameter and iterate `configs` instead of `CHART_CONFIGS`; every `getSubplotDomain(idx)` call becomes `getSubplotDomain(configs, idx)`; `isLast` uses `configs.length`; `layout.images` maps over `configs`.

- [ ] **Step 3: Render the new chart kinds inside `buildTraces`'s config loop**, before the existing "Normal channels" block:

```ts
if (cfg.isHeatmap) {
  // One lane per driver; reversed so driver 0 is the top row
  for (let d = drivers.length - 1; d >= 0; d--) {
    const dn = drivers[d];
    const codes = dn.channels.actions;
    if (!codes || !codes.length) continue;
    traces.push({
      x: distance,
      y: [dn.abbreviation],
      z: [codes],
      type: 'heatmap',
      xaxis: xAxis,
      yaxis: yAxis,
      colorscale: ACTION_CATEGORIES.flatMap((c, i, arr) => [
        [i / arr.length, c.color], [(i + 1) / arr.length, c.color],
      ]) as Array<[number, string]>,
      zmin: -0.5,
      zmax: 4.5,
      showscale: false,
      text: [codes.map(c => ACTION_CATEGORIES[c]?.label ?? '')] as unknown as string[],
      hovertemplate: `%{text}<extra>${dn.abbreviation}</extra>`,
      showlegend: false,
    } as unknown as Partial<PlotData>);
  }
  return;
}

if (cfg.firstDriverOnly) {
  const vals = drivers[0].channels[cfg.channel] as number[];
  if (!vals || !vals.length) return;
  traces.push({
    x: distance,
    y: vals,
    type: 'scatter',
    mode: 'lines',
    name: 'Elevation',
    xaxis: xAxis,
    yaxis: yAxis,
    line: { color: driverColors[0], width: 1.5, shape: 'linear' },
    fill: 'tozeroy',
    showlegend: false,
    hovertemplate: `%{y:.1f} m<extra>Elevation</extra>`,
  });
  return;
}
```

Also change the guard at the top of the loop from `if (!drivers.length || !drivers[0].channels[cfg.channel]) return;` to also skip empty arrays: `const first = drivers[0]?.channels[cfg.channel]; if (!first || !(first as number[]).length) return;` — this is what hides Elevation/Vert-G/DRS subplot traces for sessions without data. In `buildLayout`, `zeroline` also applies when `cfg.channel === 'vertical_g'`.

- [ ] **Step 4: Wire toggles into the component.** In `ChartStack`:

```ts
const DEFAULT_TOGGLES = Object.fromEntries(CHART_CONFIGS.map(c => [c.channel, c.defaultOn]));
// inside the component:
const [enabled, toggle] = useChannelToggles(DEFAULT_TOGGLES);
const hasElevation = (telemetryData.drivers[0]?.channels.elevation?.length ?? 0) > 0;

const activeConfigs = useMemo(
  () => CHART_CONFIGS.filter(c => enabled[c.channel] && !(c.needsElevation && !hasElevation)),
  [enabled, hasElevation]
);

const toggleItems = CHART_CONFIGS.map(c => ({
  key: c.channel,
  label: c.label,
  disabled: c.needsElevation && !hasElevation,
  disabledReason: 'No elevation data for this session',
}));
```

`buildTraces`/`buildLayout` calls pass `activeConfigs`; `plotHeight` becomes `totalWeight(activeConfigs) * 170 + 100`; render `<ChannelToggles items={toggleItems} enabled={enabled} onToggle={toggle} />` between the title bar and the chart div. Guard the empty case: if `activeConfigs.length === 0`, render a "No channels selected" placeholder div instead of the plot.

- [ ] **Step 5: Verify build + run.** `npm run build` clean, then `npm run dev` → load 2026 Hungarian Q, BOT vs BOR: chips render, existing 8 unchanged by default, enabling DRS + Actions adds working subplots, Elev/Vert G chips disabled with tooltip (no z data yet). Toggle state survives reload.

- [ ] **Step 6: Commit**

```bash
git add f1-telemetry-app/frontend/src/components/ChartStack.tsx
git commit -m "feat(charts): channel toggles + DRS, Actions, Elevation, Vertical G subplots

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Backend parity port

**Files:**
- Modify: `f1-telemetry-app/backend/services/processing.py`

**Interfaces:**
- Consumes: existing `normalize_telemetry` / `compute_accelerations` structure (read the file first; mirror its numpy style).
- Produces: response channel dicts gain `drs`, `actions`, `elevation`, `vertical_g` keys matching the TS output of Task 1 exactly (same thresholds, same rounding, same `[]`-when-no-z rule).

- [ ] **Step 1: Add the two pure functions** (place next to `compute_accelerations`):

```python
DRS_OPEN = {10, 12, 14}

def compute_actions(throttle, brake, lateral_g):
    """Per-point driver action class. Priority: braking, full throttle,
    lift & coast, cornering, rolling — mirrors useTelemetry.computeActions."""
    out = []
    for i in range(len(throttle)):
        if brake[i] > 0:
            out.append(0)
        elif throttle[i] >= 98:
            out.append(1)
        elif throttle[i] <= 5:
            out.append(2)
        elif abs(lateral_g[i]) >= 1.5:
            out.append(3)
        else:
            out.append(4)
    return out


def compute_vertical_g(elevation, time_s):
    """d²z/dt² in G, smoothed and clamped — mirrors useTelemetry.computeVerticalG."""
    z = np.asarray(elevation, dtype=float)
    if z.size == 0:
        return []
    t = np.asarray(time_s, dtype=float)
    dt = np.gradient(t)
    dt[np.abs(dt) < 1e-6] = 1e-6
    vz = np.gradient(z) / dt
    az = np.gradient(vz) / dt / 9.81
    kernel = np.ones(7) / 7
    az = np.convolve(az, kernel, mode="same")
    return np.round(np.clip(az, -6, 6), 4).tolist()
```

- [ ] **Step 2: Wire into the response** — where per-driver channels are assembled (inside `normalize_telemetry` / the telemetry route service), add `drs` (mapped via `DRS_OPEN`, nearest-before normalized like gear/brake), `elevation` (interpolated `Z * 0.1` when the column exists, else `[]`), and the two computed channels. Match the existing interpolation helpers in the file.

- [ ] **Step 3: Verify** — `python -m py_compile f1-telemetry-app/backend/services/processing.py` passes; visually diff thresholds/rounding against Task 1's TS (98, 5, 1.5, ±6 clamp, 4-decimal rounding, 7-point smoothing).

- [ ] **Step 4: Commit**

```bash
git add f1-telemetry-app/backend/services/processing.py
git commit -m "feat(backend): parity port of drs/actions/elevation/vertical_g channels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Pipeline `z` channel + local 2026 re-backfill (f1-data repo)

**Files:**
- Modify: `C:\Users\lucas\OneDrive\Desktop\Cursor Projects\f1-data\scripts\process_session.py:158` (data dict)
- Modify: `C:\Users\lucas\OneDrive\Desktop\Cursor Projects\f1-data\scripts\backfill_year.py` (add `--force`, raise per-session timeout)

**Interfaces:**
- Produces: telemetry JSON files gain `"z": number[]` (meters, 2 decimals, `[]` if FastF1 has no Z column). Frontend Task 1 already reads this key.

- [ ] **Step 1: Emit z** — in the `data = {...}` dict in `process_session.py`, after the `"y"` line:

```python
"z": np.round(_interp(dist, tel["Z"].values.astype(float) * 0.1, common_dist), 2).tolist() if "Z" in tel.columns else [],
```

- [ ] **Step 2: Add `--force` + longer timeout to `backfill_year.py`** — `session_cached` short-circuits every already-processed session, which would skip the whole re-backfill:

```python
force = "--force" in sys.argv          # near the session_filter parsing
```

change the skip check to `if not force and session_cached(root, year, slug, stype):` and change `timeout=600` to `timeout=1800` in `run()` (race sessions exceed 10 min locally).

- [ ] **Step 3: Run the re-backfill in the background** (single instance — do NOT start a second run; today's double-run was only safe by luck):

```bash
cd "/c/Users/lucas/OneDrive/Desktop/Cursor Projects/f1-data" && \
uv run --with "fastf1==3.8.3" python scripts/backfill_year.py 2026 --force
```

Expected: several hours; summary ends `Failed: 0`. Spot-check one file:

```bash
python -c "import json; d=json.load(open('2026/hungarian-grand-prix/Q/telemetry/NOR_16.json')); print(len(d['z']), d['z'][:5])"
```

(any existing `<DRV>_<lap>.json` works; expect 500 values, plausible meters).

- [ ] **Step 4: Commit scripts first, then data; push; purge**

```bash
git add scripts/process_session.py scripts/backfill_year.py
git commit -m "feat: emit z (elevation) channel; backfill --force flag

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git add -A
git commit -m "data: re-backfill 2026 with z channel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git pull --rebase && git push
bash scripts/purge_jsdelivr.sh
```

---

### Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1:** `npm run build` clean in `f1-telemetry-app/frontend`.
- [ ] **Step 2:** `npm run dev` → 2026 Hungarian Q: enable all 12 chips → Elevation shows the Hungaroring profile (~220–250 m band), Vertical G non-flat, DRS bands on straights, Actions lanes match speed trace (Braking red into corners, Full Throttle green on straights).
- [ ] **Step 3:** Load a 2025 session (no z): Elev/Vert G chips disabled with tooltip; other 10 charts fine.
- [ ] **Step 4:** Toggle theme light/dark — no hardcoded-color regressions; check ~375 px width — chip row wraps, chart margins unchanged.
- [ ] **Step 5:** Reload page — toggle selection persisted.
