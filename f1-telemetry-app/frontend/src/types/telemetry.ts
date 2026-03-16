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
