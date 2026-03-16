import { useState, useEffect, useCallback } from 'react';
import axios, { type AxiosError } from 'axios';
import type {
  EventInfo,
  SessionInfo,
  DriverListItem,
  LapInfo,
  TelemetryData,
  TelemetryRequest,
} from '../types/telemetry';

// ─── Axios Instance ───────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 120_000, // 2 minutes — FastF1 can be slow on first load
});

// ─── Error Extraction Helper ──────────────────────────────────────────────────

function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const axErr = err as AxiosError<{ detail?: string; message?: string }>;
    const detail = axErr.response?.data?.detail || axErr.response?.data?.message;
    if (detail) return String(detail);
    if (axErr.message) return axErr.message;
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
}

// ─── Hook Types ───────────────────────────────────────────────────────────────

export interface UseTelemetryReturn {
  // Data
  years: number[];
  events: EventInfo[];
  sessions: SessionInfo[];
  drivers: DriverListItem[];
  driversLaps: Record<string, LapInfo[]>;
  telemetryData: TelemetryData | null;

  // Loading states
  loadingYears: boolean;
  loadingEvents: boolean;
  loadingSessions: boolean;
  loadingDrivers: boolean;
  loadingDriverLaps: Record<string, boolean>;
  loadingTelemetry: boolean;

  // Error
  error: string | null;
  clearError: () => void;

  // Actions
  fetchEvents: (year: number) => Promise<void>;
  fetchSessions: (year: number, event: string) => Promise<void>;
  fetchDrivers: (year: number, event: string, session: string) => Promise<void>;
  fetchDriverLaps: (year: number, event: string, session: string, driver: string) => Promise<void>;
  fetchTelemetry: (request: TelemetryRequest) => Promise<void>;
  clearTelemetry: () => void;
}

// ─── Main Hook ────────────────────────────────────────────────────────────────

export function useTelemetry(): UseTelemetryReturn {
  // Data state
  const [years, setYears] = useState<number[]>([]);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [drivers, setDrivers] = useState<DriverListItem[]>([]);
  const [driversLaps, setDriversLaps] = useState<Record<string, LapInfo[]>>({});
  const [telemetryData, setTelemetryData] = useState<TelemetryData | null>(null);

  // Loading states
  const [loadingYears, setLoadingYears] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [loadingDriverLaps, setLoadingDriverLaps] = useState<Record<string, boolean>>({});
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  // ─── Fetch Years on Mount ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingYears(true);
      try {
        const res = await api.get<number[]>('/years');
        if (!cancelled) setYears(res.data);
      } catch (err) {
        if (!cancelled) setError(extractErrorMessage(err));
      } finally {
        if (!cancelled) setLoadingYears(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // ─── Fetch Events ──────────────────────────────────────────────────────────
  const fetchEvents = useCallback(async (year: number) => {
    setLoadingEvents(true);
    setEvents([]);
    setSessions([]);
    setDrivers([]);
    setDriversLaps({});
    setError(null);
    try {
      const res = await api.get<EventInfo[]>(`/events/${year}`);
      setEvents(res.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  // ─── Fetch Sessions ────────────────────────────────────────────────────────
  const fetchSessions = useCallback(async (year: number, event: string) => {
    setLoadingSessions(true);
    setSessions([]);
    setDrivers([]);
    setDriversLaps({});
    setError(null);
    try {
      const res = await api.get<SessionInfo[]>(`/sessions/${year}/${encodeURIComponent(event)}`);
      setSessions(res.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  // ─── Fetch Drivers ─────────────────────────────────────────────────────────
  const fetchDrivers = useCallback(async (year: number, event: string, session: string) => {
    setLoadingDrivers(true);
    setDrivers([]);
    setDriversLaps({});
    setError(null);
    try {
      const res = await api.get<DriverListItem[]>(
        `/drivers/${year}/${encodeURIComponent(event)}/${encodeURIComponent(session)}`
      );
      setDrivers(res.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  // ─── Fetch Driver Laps ───────────────────────────────────────────────────
  const fetchDriverLaps = useCallback(
    async (year: number, event: string, session: string, driver: string) => {
      setLoadingDriverLaps((prev) => ({ ...prev, [driver]: true }));
      setError(null);
      try {
        const res = await api.get<LapInfo[]>(
          `/laps/${year}/${encodeURIComponent(event)}/${encodeURIComponent(session)}/${encodeURIComponent(driver)}`
        );
        setDriversLaps((prev) => ({ ...prev, [driver]: res.data }));
      } catch (err) {
        setError(extractErrorMessage(err));
      } finally {
        setLoadingDriverLaps((prev) => ({ ...prev, [driver]: false }));
      }
    },
    []
  );

  // ─── Fetch Telemetry ───────────────────────────────────────────────────────
  const fetchTelemetry = useCallback(async (request: TelemetryRequest) => {
    setLoadingTelemetry(true);
    setTelemetryData(null);
    setError(null);
    try {
      const res = await api.post<TelemetryData>('/telemetry', request);
      setTelemetryData(res.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoadingTelemetry(false);
    }
  }, []);

  const clearTelemetry = useCallback(() => {
    setTelemetryData(null);
    setError(null);
  }, []);

  return {
    years,
    events,
    sessions,
    drivers,
    driversLaps,
    telemetryData,
    loadingYears,
    loadingEvents,
    loadingSessions,
    loadingDrivers,
    loadingDriverLaps,
    loadingTelemetry,
    error,
    clearError,
    fetchEvents,
    fetchSessions,
    fetchDrivers,
    fetchDriverLaps,
    fetchTelemetry,
    clearTelemetry,
  };
}
