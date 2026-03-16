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
  addDriver: () => void;
  removeDriver: (index: number) => void;
  setDriverAbbr: (index: number, abbr: string) => void;
  setDriverLap: (index: number, lap: number | 'fastest') => void;
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

  addDriver: () =>
    set((state) => ({
      drivers: [...state.drivers, { abbr: null, lap: null }],
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

  reset: () => set(initialState),
}));
