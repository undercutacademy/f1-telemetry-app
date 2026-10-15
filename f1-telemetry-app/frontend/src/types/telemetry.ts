// ─── Telemetry Channel Data ───────────────────────────────────────────────────

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
  dist_ahead: number[];  // meters to car ahead (NaN = unknown); [] when not in data
  gap_ahead: number[];   // seconds to car ahead (dist / speed); [] when not in data
  driver_ahead: string[]; // abbreviation of car ahead ('' = none); [] when not in data
}

// ─── Driver Information ───────────────────────────────────────────────────────

export interface DriverInfo {
  abbreviation: string;
  full_name: string;
  number: string;
  team: string;
  team_color: string;
  lap_number: number;
  lap_time: string;
  channels: TelemetryChannels;
}

// ─── Circuit / Track ──────────────────────────────────────────────────────────

export interface CornerInfo {
  number: number;
  letter: string;
  angle: number;
  distance: number;
  x: number;
  y: number;
}

export interface CircuitInfo {
  corners: CornerInfo[];
  marshal_lights: CornerInfo[];
  marshal_sectors: CornerInfo[];
  rotation: number;
}

export interface TelemetryData {
  track: {
    x: number[];
    y: number[];
  };
  distance: number[];
  drivers: DriverInfo[];
  circuit_info: CircuitInfo;
}

// ─── Selection Data ───────────────────────────────────────────────────────────

export interface EventInfo {
  round: number;
  name: string;
  slug: string;
  country: string;
  date: string;
}

export interface SessionInfo {
  type: string;
  name: string;
  date: string;
  available: boolean;
}

export interface DriverListItem {
  abbreviation: string;
  full_name: string;
  number: string;
  team: string;
  team_color: string;
}

// ─── Lap Data ─────────────────────────────────────────────────────────────────

export interface LapInfo {
  lap_number: number;
  lap_time: string;
  lap_time_seconds: number;
  sector1: string;
  sector2: string;
  sector3: string;
  compound: string;
  tyre_life: number;
  is_personal_best: boolean;
  is_fastest: boolean;
  is_valid: boolean;
}

// ─── Session-wide analysis (every driver, every lap) ──────────────────────────

/** One lap of one driver, normalized from analysis.json or derived from laps/*.json. */
export interface SessionLap {
  driver: string;
  lap: number;
  time: number | null;       // seconds
  s1: number | null;
  s2: number | null;
  s3: number | null;
  compound: string;
  tyreLife: number;
  stint: number;
  position: number | null;   // null when the data source has no positions
  pitIn: boolean;
  pitOut: boolean;
  sessionTime: number | null; // session clock at lap end (s); null in derived data
  trackStatus: string;       // FastF1 status digits ('1' green, '4' SC, '5' red, '6'/'7' VSC)
  hasTelemetry: boolean;
}

export interface SessionResult {
  driver: string;
  position: number | null;
  grid: number | null;
  status: string;
}

export interface WeatherData {
  time: number[];            // session seconds
  air_temp: (number | null)[];
  track_temp: (number | null)[];
  humidity: (number | null)[];
  pressure: (number | null)[];
  wind_speed: (number | null)[];
  wind_direction: (number | null)[];
  rainfall: (number | null)[];
}

export interface SessionAnalysis {
  /** 'analysis' = analysis.json (true positions, pit flags); 'derived' = rebuilt from laps/*.json */
  source: 'analysis' | 'derived';
  laps: SessionLap[];
  results: SessionResult[];
  weather: WeatherData | null;
}

// ─── API Request / Response Types ─────────────────────────────────────────────

export interface TelemetryRequest {
  year: number;
  event: string;
  slug: string;
  session: string;
  drivers: string[];
  laps: (number | 'fastest')[];
}

export type TyreCompound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTERMEDIATE' | 'WET' | string;

export const TYRE_COLORS: Record<string, string> = {
  SOFT: '#E8002D',
  MEDIUM: '#FFF200',
  HARD: '#C8C8C8',
  INTERMEDIATE: '#39B54A',
  WET: '#0067FF',
  UNKNOWN: '#6B7280',
};
