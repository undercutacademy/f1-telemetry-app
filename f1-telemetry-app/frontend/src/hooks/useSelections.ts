import { create } from 'zustand';

export interface DriverSelection {
  abbr: string | null;
  lap: number | 'fastest' | null;
}

interface SelectionsState {
  year: number | null;
  event: string | null;
  session: string | null;
  drivers: DriverSelection[];

  setYear: (year: number) => void;
  setEvent: (event: string) => void;
  setSession: (session: string) => void;
  addDriver: (init?: DriverSelection) => void;
  removeDriver: (index: number) => void;
  setDriverAbbr: (index: number, abbr: string) => void;
  setDriverLap: (index: number, lap: number | 'fastest') => void;
  /** Driver and lap in one step, so the fastest-lap auto-select doesn't override the lap. */
  setDriver: (index: number, abbr: string, lap: number) => void;
  /** Replace the whole driver list (restoring a shared link). Pads to the 2-driver minimum. */
  setDrivers: (drivers: DriverSelection[]) => void;
  reset: () => void;
}

const initialDrivers = [
  { abbr: null, lap: null },
  { abbr: null, lap: null },
];

const initialState = {
  year: null,
  event: null,
  session: null,
  drivers: initialDrivers,
};

export const useSelections = create<SelectionsState>((set) => ({
  ...initialState,

  setYear: (year) =>
    set({
      year,
      // Reset downstream selections when year changes
      event: null,
      session: null,
      drivers: initialDrivers,
    }),

  setEvent: (event) =>
    set({
      event,
      // Reset downstream selections when event changes
      session: null,
      drivers: initialDrivers,
    }),

  setSession: (session) =>
    set({
      session,
      // Reset driver and lap selections when session changes
      drivers: initialDrivers,
    }),

  addDriver: (init) =>
    set((state) => ({
      drivers: [...state.drivers, init ?? { abbr: null, lap: null }],
    })),

  removeDriver: (index) =>
    set((state) => {
      const newDrivers = [...state.drivers];
      newDrivers.splice(index, 1);
      return { drivers: newDrivers };
    }),

  setDriverAbbr: (index, abbr) =>
    set((state) => {
      const newDrivers = [...state.drivers];
      newDrivers[index] = { abbr, lap: null };
      return { drivers: newDrivers };
    }),

  setDriverLap: (index, lap) =>
    set((state) => {
      const newDrivers = [...state.drivers];
      newDrivers[index] = { ...newDrivers[index], lap };
      return { drivers: newDrivers };
    }),

  setDriver: (index, abbr, lap) =>
    set((state) => {
      const newDrivers = [...state.drivers];
      newDrivers[index] = { abbr, lap };
      return { drivers: newDrivers };
    }),

  setDrivers: (drivers) =>
    set({
      drivers: [...drivers, ...initialDrivers].slice(0, Math.max(2, Math.min(5, drivers.length))),
    }),

  reset: () => set(initialState),
}));
