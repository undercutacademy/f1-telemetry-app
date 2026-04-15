# F1 Telemetry Analysis Web App — Builder Prompt

## Project Overview

Build a **free, open-source F1 telemetry data analysis web application** that allows users to compare driver performance using publicly available Formula 1 telemetry data. The app pulls data from the **FastF1 Python library** (`pip install fastf1`), which accesses F1's official live-timing API. It provides lap timing, car telemetry, position data, tyre data, weather data, event schedules, and session results as extended Pandas DataFrames.

**Reference websites for inspiration (study their UX and feature set):**
- https://tracinginsights.com/
- https://www.f1-tempo.com/
- https://www.gp-tempo.com/

---

## Architecture

### Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Backend** | Python (FastAPI or Flask) | Handles FastF1 data fetching, caching, and processing |
| **Frontend** | React + TypeScript | Modern SPA with responsive layout |
| **Charts** | Plotly.js (preferred) or Recharts / D3.js | Interactive, zoomable, high-performance graphs with shared X-axes |
| **Styling** | Tailwind CSS | Light/dark theme support via CSS variables or Tailwind dark mode |
| **State Mgmt** | React Context or Zustand | For theme, selections, and telemetry data state |
| **Deployment** | Docker NETLIFY (frontend) + Render (backend) | Containerized for easy deployment |

> **Why Plotly.js?** It natively supports linked/shared axes, hover crosshairs across subplots, zoom sync, and WebGL rendering for large telemetry datasets (~500-800 data points per lap). It also supports `make_subplots` with shared x-axes out of the box — critical for this project.

### Data Flow

```
User selects Year → Event → Session → Drivers → Laps
        ↓
Frontend sends request to Backend API
        ↓
Backend: FastF1 loads session → picks drivers → picks laps → gets telemetry
        ↓
Backend: Normalizes distance, computes delta, computes accelerations
        ↓
Backend: Returns JSON with telemetry arrays + track coordinates + driver/team metadata
        ↓
Frontend: Renders all charts with distance on X-axis, synced zoom/pan
```

---

## FastF1 Data Source — Technical Details

### Installation & Setup
```python
pip install fastf1
```

### Core API Pattern
```python
import fastf1

# Enable caching (CRITICAL — avoids re-downloading ~200-500MB per session)
fastf1.Cache.enable_cache('./fastf1_cache')

# Load a session
session = fastf1.get_session(year, event_name_or_round, session_type)
# session_type: 'FP1', 'FP2', 'FP3', 'Q', 'SQ' (Sprint Quali), 'S' (Sprint), 'R' (Race)
session.load(telemetry=True, laps=True, weather=False)
```

### Available Telemetry Channels (from the F1 live timing API)
**Car Data:**
- `Speed` (float): Car speed in km/h
- `RPM` (float): Engine RPM
- `nGear` (int): Current gear number
- `Throttle` (float): Throttle pedal pressure, 0–100%
- `Brake` (bool): Whether brakes are applied or not
- `DRS` (int): DRS indicator

**Position Data:**
- `X` (float): X position in 1/10 meter (from 2020 onwards)
- `Y` (float): Y position in 1/10 meter
- `Z` (float): Z position in 1/10 meter
- `Status` (str): OffTrack / OnTrack

**Computed Channels (added by FastF1):**
- `Distance`: Cumulative distance driven since first sample (via `add_distance()`)
- `RelativeDistance`: Relative distance (0.0 to 1.0) driven since first sample
- `DriverAhead`: Car number of driver ahead (via `add_driver_ahead()`)
- `DistanceToDriverAhead`: Distance to driver ahead

**Timing:**
- `Time` (timedelta): Time offset from start of the data slice
- `SessionTime` (timedelta): Time elapsed since session start
- `Date` (datetime): Full timestamp of the sample
- `Source` (str): 'car', 'pos', or 'interpolated'

**Telemetry sample rate:** ~240ms for car data, ~220ms for position data. They do not align — FastF1 handles resampling/interpolation automatically when merging.

**Data availability:** Telemetry data is available from the **2018 season onwards**. Schedule and results go further back.

### Getting Laps & Telemetry
```python
# Get all laps for a driver
driver_laps = session.laps.pick_driver('VER')  # 3-letter abbreviation

# Get specific lap(s)
fastest_lap = driver_laps.pick_fastest()
specific_lap = driver_laps[driver_laps['LapNumber'] == 15].iloc[0]

# Get telemetry for a lap
telemetry = lap.get_telemetry()
# or with car data only:
car_data = lap.get_car_data()
# or with position data only:
pos_data = lap.get_pos_data()

# Add distance channel
telemetry = telemetry.add_distance()
```

### Getting Driver & Team Metadata
```python
# Session results contain driver info
results = session.results
# Columns: Abbreviation, TeamName, TeamColor, DriverNumber, FullName, etc.

# Get team color for a driver
driver_info = results[results['Abbreviation'] == 'VER'].iloc[0]
team_color = f"#{driver_info['TeamColor']}"  # Hex color string
```

### Getting Event Schedule
```python
# Full season schedule
schedule = fastf1.get_event_schedule(year)
# Columns: EventName, EventDate, Country, Location, EventFormat, etc.

# Specific event
event = fastf1.get_event(year, round_or_name)
```

### Getting Circuit Info
```python
circuit_info = session.get_circuit_info()
# Contains: corners (with distance, number, letter), marshal_lights, marshal_sectors
```

---

## Frontend Requirements

### Theme System
- **Light theme** and **Dark theme** — user-toggleable via a button in the header
- Use CSS custom properties or Tailwind's `dark:` classes
- All chart backgrounds, gridlines, text, and tooltips must respect the active theme
- Charts should use semi-transparent gridlines and clean axis labels

### Color Rules (CRITICAL)
- **NEVER use the same color for both drivers being compared**
- Use official F1 team colors as the base. FastF1 provides `TeamColor` in hex for each driver via `session.results`
- If both drivers are on the **same team**, differentiate them clearly:
  - Driver 1: team's primary color (solid line)
  - Driver 2: team's secondary/lighter variant or a contrasting complementary color (dashed or dotted line)
- Display a color legend with driver abbreviation, full name, team, and the color swatch
- Colors must be clearly visible on BOTH light and dark themes. Adjust brightness/saturation if needed per theme

### Dropdown Selection Flow (Top of Page)
Build a cascading selection panel at the top of the page:

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Year ▼]  [Grand Prix ▼]  [Session ▼]  [Driver 1 ▼]  [Driver 2 ▼]│
│                                                                     │
│  Driver 1 Laps: [Lap selector / dropdown / grid]                    │
│  Driver 2 Laps: [Lap selector / dropdown / grid]                    │
│                                                                     │
│  [Load / Compare]  [Reset]                                          │
└─────────────────────────────────────────────────────────────────────┘
```

**Step-by-step cascade logic:**

1. **Year dropdown**: Populate with available years (2018 to current). On selection, fetch the event schedule for that year.
2. **Grand Prix / Event dropdown**: Populated after year is selected. Show event names (e.g., "Bahrain Grand Prix", "Monaco Grand Prix"). Use `fastf1.get_event_schedule(year)`.
3. **Session dropdown**: Populated after event is selected. Options depend on the event format:
   - Standard weekend: FP1, FP2, FP3, Qualifying, Race
   - Sprint weekend: FP1, Qualifying, Sprint Shootout, Sprint, Race
   - Show only sessions that have data available (completed sessions)
4. **Driver 1 & Driver 2 dropdowns**: Populated after session is selected. List all drivers who participated in that session. Show: `Abbreviation — Full Name (Team)`. Example: `VER — Max Verstappen (Red Bull Racing)`
5. **Lap Selection**: After drivers are chosen, display their lap data so the user can pick which lap(s) to analyze:
   - Show a compact table or selectable list for each driver with columns: Lap Number, Lap Time, Tyre Compound, Sector 1/2/3 times
   - Highlight the fastest lap
   - Allow selecting one lap per driver for telemetry comparison
   - Optionally support "Fastest Lap" as a quick-select button
6. **Load / Compare button**: Triggers the telemetry fetch and chart rendering
7. **Reset button**: Clears all selections and charts

### Loading States
- Show skeleton loaders or a spinner with a message while FastF1 loads session data (it can take 10-30 seconds for the first load of a session)
- Show progress feedback: "Loading session data...", "Fetching telemetry...", "Processing..."
- Cache session data on the backend so subsequent requests for the same session are instant

---

## Charts & Visualizations

### X-Axis: Distance (Normalized & Aligned)
- **ALL telemetry charts use Distance (meters) on the X-axis**, NOT time
- Normalize the distance between both drivers so graphs are aligned:
  - Resample both telemetry traces to a common distance array (e.g., 0 to max track distance in uniform steps)
  - Use linear interpolation to align samples to the same distance points
  - This ensures that when comparing two drivers, the same X position on the chart corresponds to the same point on track

```python
# Backend processing example for distance normalization
import numpy as np

# Create common distance reference
max_distance = max(tel1['Distance'].max(), tel2['Distance'].max())
common_distance = np.linspace(0, max_distance, num=500)  # 500 evenly spaced points

# Interpolate each channel to common distance
for channel in ['Speed', 'RPM', 'nGear', 'Throttle', 'Brake']:
    tel1_interp[channel] = np.interp(common_distance, tel1['Distance'], tel1[channel])
    tel2_interp[channel] = np.interp(common_distance, tel2['Distance'], tel2[channel])
```

### Chart 1: Track Map (Circuit Visualization)
- Render the circuit using X, Y position coordinates from telemetry
- Color each segment of the track based on **which driver is faster** at that point:
  - Compare speeds at each distance point
  - Color the track segment with Driver 1's color where Driver 1 is faster
  - Color with Driver 2's color where Driver 2 is faster
- Maintain correct aspect ratio (X and Y axes must have equal scaling so the track shape is accurate)
- Optionally overlay corner numbers from `circuit_info.corners`
- Add a legend: "Driver 1 color = faster" / "Driver 2 color = faster"
- This should be an SVG or canvas rendering, not a standard line chart

### Chart 2: Speed vs Distance
- Y-axis: Speed (km/h)
- Two overlaid lines (one per driver) with their respective colors
- Shared crosshair/tooltip showing both values on hover
- Zoomable and pannable

### Chart 3: Delta Time vs Distance
- Y-axis: Cumulative time delta (seconds)
- Compute as: for each distance point, calculate the difference in elapsed time between Driver 1 and Driver 2
- Positive = Driver 1 is ahead; Negative = Driver 2 is ahead
- Use an **area fill**: green area above zero (Driver 1 gaining), red area below zero (Driver 2 gaining) — or use driver colors with transparency
- Zero line clearly marked

```python
# Delta time computation
# For each common distance point, find the time each driver reached that distance
# Delta = Time_Driver2(d) - Time_Driver1(d)
time1 = np.interp(common_distance, tel1['Distance'], tel1['Time'].dt.total_seconds())
time2 = np.interp(common_distance, tel2['Distance'], tel2['Time'].dt.total_seconds())
delta = time2 - time1  # Positive means Driver 1 is faster
```

### Chart 4: RPM vs Distance
- Y-axis: Engine RPM
- Two overlaid lines, same style as Speed chart

### Chart 5: Gear vs Distance
- Y-axis: Gear number (integer, 1–8)
- Use step-plot style (discrete values — gears don't interpolate smoothly)
- Two overlaid step lines, different colors
- Y-axis ticks at each gear number (1, 2, 3, 4, 5, 6, 7, 8)

### Chart 6: Throttle vs Distance
- Y-axis: Throttle % (0–100)
- Two overlaid lines
- Consider adding a subtle filled area under each line for visual clarity

### Chart 7: Brake vs Distance
- Y-axis: Brake (binary: On/Off, or 0/1)
- Use filled rectangular blocks or step-fill areas to show braking zones
- Each driver gets their own row/lane or overlaid with transparency
- Make it easy to see braking points and where one driver brakes earlier/later

### Chart 8: Lateral Acceleration vs Distance
- Y-axis: Lateral G-force (g)
- **Computed channel** — not directly in FastF1, must be derived:

```python
# Lateral acceleration from X, Y coordinates and speed
# Using the change in heading angle and speed:
dx = np.gradient(tel['X'])
dy = np.gradient(tel['Y'])
heading = np.arctan2(dy, dx)
d_heading = np.gradient(heading)
dt = np.gradient(tel['Time'].dt.total_seconds())

# Angular velocity
omega = d_heading / dt

# Lateral acceleration (v * omega), convert to g
speed_ms = tel['Speed'] / 3.6  # km/h to m/s
lateral_acc_g = (speed_ms * omega) / 9.81

# Smooth with a rolling window to reduce noise
lateral_acc_g = pd.Series(lateral_acc_g).rolling(window=5, center=True).mean()
```

### Chart 9: Longitudinal Acceleration vs Distance
- Y-axis: Longitudinal G-force (g)
- **Computed channel** — derived from speed changes:

```python
# Longitudinal acceleration from speed derivative
speed_ms = tel['Speed'] / 3.6
dt = np.gradient(tel['Time'].dt.total_seconds())
long_acc = np.gradient(speed_ms) / dt
long_acc_g = long_acc / 9.81

# Smooth
long_acc_g = pd.Series(long_acc_g).rolling(window=5, center=True).mean()
```

### Chart Layout & Interaction
- **All 8 telemetry charts (excluding track map) must share the same X-axis (Distance)**
- Stack them vertically in a single scrollable column with synchronized X-axis zoom/pan
- When you zoom into a section on one chart, ALL charts zoom to the same distance range
- Unified crosshair: hovering on any chart shows a vertical line across ALL charts at the same distance point
- Each chart shows both drivers' values in the tooltip
- Track map sits at the top, full width
- Consider using Plotly's `make_subplots(shared_xaxes=True)` pattern or equivalent in the chosen charting library

### Chart Sizing
- Track map: ~400px tall, full width, maintain aspect ratio
- Each telemetry chart: ~150-200px tall, full width
- Total page is scrollable
- Consider a "mini-map" or overview bar that shows the full distance range and highlights the currently zoomed region

---

## Backend API Endpoints

Design these REST API endpoints:

### `GET /api/years`
Returns list of available years (2018 to current).

### `GET /api/events?year={year}`
Returns event schedule for the given year.
```json
[
  { "round": 1, "name": "Bahrain Grand Prix", "country": "Bahrain", "date": "2024-03-02" },
  ...
]
```

### `GET /api/sessions?year={year}&event={round_or_name}`
Returns available sessions for the event.
```json
[
  { "type": "FP1", "name": "Practice 1", "date": "2024-03-01T11:30:00", "available": true },
  { "type": "Q", "name": "Qualifying", "date": "2024-03-02T15:00:00", "available": true },
  ...
]
```

### `GET /api/drivers?year={year}&event={round}&session={type}`
Returns drivers who participated in the session.
```json
[
  {
    "abbreviation": "VER",
    "full_name": "Max Verstappen",
    "number": 1,
    "team": "Red Bull Racing",
    "team_color": "#3671C6"
  },
  ...
]
```

### `GET /api/laps?year={year}&event={round}&session={type}&driver={abbreviation}`
Returns lap data for the specified driver.
```json
[
  {
    "lap_number": 1,
    "lap_time": "1:32.456",
    "lap_time_seconds": 92.456,
    "sector1": "28.123",
    "sector2": "34.567",
    "sector3": "29.766",
    "compound": "SOFT",
    "tyre_life": 3,
    "is_personal_best": false,
    "is_fastest": false,
    "is_valid": true
  },
  ...
]
```

### `POST /api/telemetry`
Main telemetry comparison endpoint.
```json
// Request
{
  "year": 2024,
  "event": 1,
  "session": "Q",
  "driver1": { "abbreviation": "VER", "lap": 15 },
  "driver2": { "abbreviation": "NOR", "lap": 18 }
}

// Response
{
  "track": {
    "x": [...],  // Track X coordinates (from one of the drivers)
    "y": [...]   // Track Y coordinates
  },
  "distance": [...],  // Common distance array (meters), normalized
  "driver1": {
    "abbreviation": "VER",
    "full_name": "Max Verstappen",
    "team": "Red Bull Racing",
    "color": "#3671C6",
    "lap_number": 15,
    "lap_time": "1:29.456",
    "channels": {
      "speed": [...],
      "rpm": [...],
      "gear": [...],
      "throttle": [...],
      "brake": [...],
      "delta_time": [...],
      "lateral_g": [...],
      "longitudinal_g": [...],
      "faster_segments": [...]  // Boolean array: true where this driver is faster
    }
  },
  "driver2": {
    // Same structure as driver1
  },
  "circuit_info": {
    "corners": [
      { "number": 1, "letter": "", "distance": 350.5 },
      ...
    ]
  }
}
```

---

## Backend Processing Logic (Detailed)

### Distance Normalization Algorithm
```python
import numpy as np
import pandas as pd

def normalize_telemetry(tel1, tel2, num_points=500):
    """
    Resample two telemetry DataFrames to a common distance grid.
    """
    # Add distance if not present
    if 'Distance' not in tel1.columns:
        tel1 = tel1.add_distance()
    if 'Distance' not in tel2.columns:
        tel2 = tel2.add_distance()
    
    # Common distance grid
    max_dist = min(tel1['Distance'].max(), tel2['Distance'].max())
    common_dist = np.linspace(0, max_dist, num=num_points)
    
    result = {'distance': common_dist.tolist()}
    
    for driver_tel, key in [(tel1, 'driver1'), (tel2, 'driver2')]:
        dist = driver_tel['Distance'].values
        
        channels = {}
        # Continuous channels — linear interpolation
        for ch in ['Speed', 'RPM', 'Throttle']:
            channels[ch.lower()] = np.interp(common_dist, dist, driver_tel[ch].values).tolist()
        
        # Discrete channels — nearest neighbor / forward fill
        for ch in ['nGear', 'Brake']:
            indices = np.searchsorted(dist, common_dist, side='right') - 1
            indices = np.clip(indices, 0, len(dist) - 1)
            values = driver_tel[ch].values[indices]
            ch_name = 'gear' if ch == 'nGear' else ch.lower()
            channels[ch_name] = values.tolist()
        
        # Time interpolation for delta calculation
        time_seconds = driver_tel['Time'].dt.total_seconds().values
        channels['time'] = np.interp(common_dist, dist, time_seconds).tolist()
        
        result[key] = {'channels': channels}
    
    # Compute delta time
    delta = np.array(result['driver2']['channels']['time']) - np.array(result['driver1']['channels']['time'])
    result['driver1']['channels']['delta_time'] = delta.tolist()
    result['driver2']['channels']['delta_time'] = (-delta).tolist()
    
    return result
```

### Acceleration Computation
```python
def compute_accelerations(tel, common_dist):
    """
    Compute lateral and longitudinal accelerations.
    """
    dist = tel['Distance'].values
    
    # Interpolate X, Y, Speed, Time to common distance
    x = np.interp(common_dist, dist, tel['X'].values)
    y = np.interp(common_dist, dist, tel['Y'].values)
    speed_kmh = np.interp(common_dist, dist, tel['Speed'].values)
    time_s = np.interp(common_dist, dist, tel['Time'].dt.total_seconds().values)
    
    speed_ms = speed_kmh / 3.6
    dt = np.gradient(time_s)
    
    # Avoid division by zero
    dt[dt == 0] = 1e-6
    
    # Longitudinal acceleration
    long_acc = np.gradient(speed_ms) / dt / 9.81
    
    # Lateral acceleration
    dx = np.gradient(x)
    dy = np.gradient(y)
    heading = np.arctan2(dy, dx)
    
    # Unwrap heading to avoid discontinuities at ±π
    heading = np.unwrap(heading)
    d_heading = np.gradient(heading)
    omega = d_heading / dt
    lat_acc = (speed_ms * omega) / 9.81
    
    # Smooth both with rolling average (window=7)
    kernel = np.ones(7) / 7
    long_acc = np.convolve(long_acc, kernel, mode='same')
    lat_acc = np.convolve(lat_acc, kernel, mode='same')
    
    return {
        'longitudinal_g': long_acc.tolist(),
        'lateral_g': lat_acc.tolist()
    }
```

### Track Dominance (Faster Segments)
```python
def compute_faster_segments(speed1, speed2):
    """
    For each distance point, determine which driver is faster.
    Returns boolean arrays: True = this driver is faster.
    """
    s1 = np.array(speed1)
    s2 = np.array(speed2)
    driver1_faster = s1 > s2
    driver2_faster = s2 > s1
    return driver1_faster.tolist(), driver2_faster.tolist()
```

---

## Caching Strategy

FastF1 data does not change after a session is complete, so cache aggressively:

1. **FastF1 built-in cache**: Always enable with `fastf1.Cache.enable_cache('./cache')`. This caches raw API responses.
2. **Application-level cache**: After processing telemetry for a specific (year, event, session, driver, lap) tuple, cache the processed JSON response. Use Redis, file-based cache, or in-memory dict.
3. **Frontend cache**: Store previously fetched dropdown data (events, drivers, laps) in React state so navigating back doesn't re-fetch.

---

## UI/UX Design Guidelines

### Layout Structure
```
┌──────────────────────────────────────────────────────────┐
│  HEADER: Logo / Title — "F1 Telemetry Analysis"  [☀/🌙] │
├──────────────────────────────────────────────────────────┤
│  SELECTION PANEL (sticky top):                           │
│  [Year] [Event] [Session] [Driver 1] [Driver 2]         │
│  Lap selectors + Load button                             │
├──────────────────────────────────────────────────────────┤
│  TRACK MAP (full width)                                  │
│  Color-coded by faster driver                            │
├──────────────────────────────────────────────────────────┤
│  SPEED vs Distance                                       │
├──────────────────────────────────────────────────────────┤
│  DELTA TIME vs Distance                                  │
├──────────────────────────────────────────────────────────┤
│  RPM vs Distance                                         │
├──────────────────────────────────────────────────────────┤
│  GEAR vs Distance                                        │
├──────────────────────────────────────────────────────────┤
│  THROTTLE vs Distance                                    │
├──────────────────────────────────────────────────────────┤
│  BRAKE vs Distance                                       │
├──────────────────────────────────────────────────────────┤
│  LATERAL G vs Distance                                   │
├──────────────────────────────────────────────────────────┤
│  LONGITUDINAL G vs Distance                              │
├──────────────────────────────────────────────────────────┤
│  FOOTER: Credits, FastF1 attribution, open source link   │
└──────────────────────────────────────────────────────────┘
```

### Typography
- Use a clean sans-serif font: Inter, Geist, or system fonts
- Monospace for numerical values in tooltips and lap time displays
- F1-inspired feel without copying official F1 branding

### Responsive
- Desktop-first but must work on tablet
- On mobile, charts stack full-width; selection panel collapses to a vertical form
- Track map scales proportionally

### Accessibility
- Sufficient color contrast ratios (WCAG AA minimum)
- All interactive elements are keyboard-navigable
- Chart tooltips are readable
- Alternative text patterns for the track map

---

## Theme Specifications

### Light Theme
- Background: `#FFFFFF` (page), `#F8F9FA` (chart area)
- Text: `#1A1A2E`
- Grid lines: `#E5E7EB` (subtle gray)
- Axis labels: `#6B7280`
- Card/panel backgrounds: `#FFFFFF` with subtle shadow
- Selection dropdowns: white background, gray borders

### Dark Theme
- Background: `#0F0F1A` (page), `#1A1A2E` (chart area)
- Text: `#E5E7EB`
- Grid lines: `#2D2D44` (subtle)
- Axis labels: `#9CA3AF`
- Card/panel backgrounds: `#1E1E32` with subtle border
- Selection dropdowns: dark background, muted borders

### Driver Colors Per Theme
- On dark backgrounds: Use full-saturation team colors (they pop on dark)
- On light backgrounds: Slightly darken or increase saturation of team colors if they're too light (e.g., McLaren papaya on white needs darkening)
- Always ensure minimum contrast ratio of 3:1 against chart background

---

## File & Folder Structure (Suggested)

```
f1-telemetry-app/
├── backend/
│   ├── main.py                  # FastAPI app entry point
│   ├── routes/
│   │   ├── events.py            # Year, event, session endpoints
│   │   ├── drivers.py           # Driver list, lap data endpoints
│   │   └── telemetry.py         # Main telemetry comparison endpoint
│   ├── services/
│   │   ├── fastf1_service.py    # FastF1 wrapper: load sessions, get telemetry
│   │   ├── processing.py        # Distance normalization, delta, accelerations
│   │   └── cache.py             # Application-level caching layer
│   ├── models/
│   │   └── schemas.py           # Pydantic models for request/response
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Header.tsx          # Logo, title, theme toggle
│   │   │   ├── SelectionPanel.tsx  # All dropdowns and lap selectors
│   │   │   ├── TrackMap.tsx        # Circuit visualization (SVG/Canvas)
│   │   │   ├── TelemetryChart.tsx  # Reusable chart component
│   │   │   ├── ChartStack.tsx      # Container for all synced charts
│   │   │   ├── LapSelector.tsx     # Lap selection table per driver
│   │   │   ├── DriverBadge.tsx     # Color swatch + driver name
│   │   │   └── LoadingState.tsx    # Skeleton/spinner
│   │   ├── hooks/
│   │   │   ├── useTheme.ts
│   │   │   ├── useTelemetry.ts
│   │   │   └── useSelections.ts
│   │   ├── context/
│   │   │   └── ThemeContext.tsx
│   │   ├── types/
│   │   │   └── telemetry.ts        # TypeScript interfaces
│   │   ├── utils/
│   │   │   └── colors.ts           # Color manipulation helpers
│   │   └── styles/
│   │       └── globals.css         # Tailwind + theme CSS vars
│   ├── package.json
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## Key Implementation Notes

### FastF1 Quirks to Handle
1. **First session load is slow** (10-30s). Always cache. Show loading feedback.
2. **Some laps may not have telemetry** (e.g., in-laps, out-laps, laps with issues). Filter these out when presenting lap options.
3. **Brake is boolean**, not a pressure value. Display as binary on/off zones.
4. **nGear** is an integer. Use step-plot, not line interpolation.
5. **X/Y coordinates** use 1/10 meter units from 2020 onwards. Earlier seasons may differ — normalize.
6. **Sprint weekends** have different session types. Check `event.EventFormat` to determine available sessions.
7. **The `add_distance()` method** can introduce integration error over long distances. For single-lap analysis this is fine.
8. **Lateral/longitudinal acceleration are NOT provided by FastF1** — they must be computed from position and speed data as shown above.

### Performance Considerations
- Telemetry for one lap is ~500-800 data points — manageable for any charting library
- Resample to ~500 points for the comparison to keep the frontend responsive
- Use WebGL-based rendering (Plotly WebGL, or deck.gl for the track map) if performance is an issue
- Gzip API responses — telemetry JSON can be 50-200KB per comparison

### Open Source & Legal
- FastF1 is MIT licensed
- F1 data is publicly available through F1's live timing service
- Include proper attribution to FastF1 in the footer
- Add disclaimer: "This site is unofficial and not associated with Formula 1"
- Host the project on GitHub with an MIT or similar open license

---

## MVP Feature Checklist

- [ ] Year / Event / Session cascade dropdowns
- [ ] Driver selection with team colors
- [ ] Lap selection with lap times and tyre info
- [ ] Distance-normalized telemetry comparison
- [ ] Track map colored by faster driver
- [ ] Speed vs Distance chart
- [ ] Delta Time vs Distance chart
- [ ] RPM vs Distance chart
- [ ] Gear vs Distance chart (step plot)
- [ ] Throttle vs Distance chart
- [ ] Brake vs Distance chart
- [ ] Lateral acceleration vs Distance chart
- [ ] Longitudinal acceleration vs Distance chart
- [ ] All charts share synced X-axis zoom/pan
- [ ] Unified crosshair across all charts
- [ ] Light and dark theme toggle
- [ ] Responsive layout
- [ ] Loading states and error handling
- [ ] FastF1 data caching (backend)
- [ ] Corner numbers on track map

## Stretch Goals

- [ ] Compare more than 2 drivers simultaneously
- [ ] Lap time evolution chart (all laps for selected drivers)
- [ ] Tyre strategy timeline
- [ ] Sector time comparison table
- [ ] Export charts as PNG/SVG
- [ ] Share comparison via URL (encode selections in query params)
- [ ] Weather overlay on telemetry
- [ ] DRS zones highlighted on charts
- [ ] Mini-map distance overview bar
- [ ] Speed trap comparisons
- [ ] Session summary statistics panel
