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

// ─── CDN base (static JSON files served via jsDelivr) ────────────────────────

const CDN = (import.meta.env.VITE_DATA_CDN_URL ?? '').replace(/\/$/, '');

async function cdnGet<T>(path: string): Promise<T> {
  const url = `${CDN}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CDN fetch failed: ${res.status} ${url}`);
  return res.json() as Promise<T>;
}

// ─── Render backend — telemetry only ─────────────────────────────────────────

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 120_000,
});

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
  years: number[];
  events: EventInfo[];
  sessions: SessionInfo[];
  drivers: DriverListItem[];
  driversLaps: Record<string, LapInfo[]>;
  telemetryData: TelemetryData | null;

  loadingYears: boolean;
  loadingEvents: boolean;
  loadingSessions: boolean;
  loadingDrivers: boolean;
  loadingDriverLaps: Record<string, boolean>;
  loadingTelemetry: boolean;

  error: string | null;
  clearError: () => void;

  fetchEvents: (year: number) => Promise<void>;
  fetchSessions: (year: number, event: string, slug: string) => Promise<void>;
  fetchDrivers: (year: number, slug: string, session: string) => Promise<void>;
  fetchDriverLaps: (year: number, slug: string, session: string, driver: string) => Promise<void>;
  fetchTelemetry: (request: TelemetryRequest) => Promise<void>;
  clearTelemetry: () => void;
}

// ─── Main Hook ────────────────────────────────────────────────────────────────

export function useTelemetry(): UseTelemetryReturn {
  const [years, setYears] = useState<number[]>([]);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [drivers, setDrivers] = useState<DriverListItem[]>([]);
  const [driversLaps, setDriversLaps] = useState<Record<string, LapInfo[]>>({});
  const [telemetryData, setTelemetryData] = useState<TelemetryData | null>(null);

  const [loadingYears, setLoadingYears] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [loadingDriverLaps, setLoadingDriverLaps] = useState<Record<string, boolean>>({});
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  // ─── Years ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingYears(true);
      try {
        const data = await cdnGet<number[]>('index.json');
        if (!cancelled) setYears(data);
      } catch (err) {
        if (!cancelled) setError(extractErrorMessage(err));
      } finally {
        if (!cancelled) setLoadingYears(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // ─── Events ────────────────────────────────────────────────────────────────
  const fetchEvents = useCallback(async (year: number) => {
    setLoadingEvents(true);
    setEvents([]);
    setSessions([]);
    setDrivers([]);
    setDriversLaps({});
    setError(null);
    try {
      const data = await cdnGet<EventInfo[]>(`${year}/events.json`);
      setEvents(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  // ─── Sessions ──────────────────────────────────────────────────────────────
  const fetchSessions = useCallback(async (_year: number, _event: string, slug: string) => {
    setLoadingSessions(true);
    setSessions([]);
    setDrivers([]);
    setDriversLaps({});
    setError(null);
    try {
      const data = await cdnGet<SessionInfo[]>(`${_year}/${slug}/sessions.json`);
      setSessions(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  // ─── Drivers ───────────────────────────────────────────────────────────────
  const fetchDrivers = useCallback(async (year: number, slug: string, session: string) => {
    setLoadingDrivers(true);
    setDrivers([]);
    setDriversLaps({});
    setError(null);
    try {
      const data = await cdnGet<DriverListItem[]>(`${year}/${slug}/${session}/drivers.json`);
      setDrivers(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  // ─── Driver Laps ───────────────────────────────────────────────────────────
  const fetchDriverLaps = useCallback(
    async (year: number, slug: string, session: string, driver: string) => {
      setLoadingDriverLaps((prev) => ({ ...prev, [driver]: true }));
      setError(null);
      try {
        const data = await cdnGet<LapInfo[]>(`${year}/${slug}/${session}/laps/${driver}.json`);
        setDriversLaps((prev) => ({ ...prev, [driver]: data }));
      } catch (err) {
        setError(extractErrorMessage(err));
      } finally {
        setLoadingDriverLaps((prev) => ({ ...prev, [driver]: false }));
      }
    },
    []
  );

  // ─── Telemetry (stays on Render — needs heavy FastF1 processing) ───────────
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
