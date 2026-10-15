import type { DriverSelection } from '../hooks/useSelections';

/**
 * A comparison encoded in the query string, e.g.
 *   ?y=2025&e=abu-dhabi-grand-prix&s=R&d=NOR-12,VER-15
 * Driver order is kept: colours are assigned by position.
 */
export interface SharedSelection {
  year: number;
  slug: string;
  session: string;
  drivers: Array<{ abbr: string; lap: number | null }>;
}

export function readSharedSelection(search: string = window.location.search): SharedSelection | null {
  const q = new URLSearchParams(search);
  const year = Number(q.get('y'));
  const slug = q.get('e');
  const session = q.get('s');
  if (!Number.isInteger(year) || year < 1950 || !slug || !session) return null;

  const drivers = (q.get('d') ?? '')
    .split(',')
    .map(part => {
      const [abbr, lap] = part.split('-');
      const n = Number(lap);
      return { abbr: (abbr ?? '').toUpperCase(), lap: Number.isInteger(n) && n > 0 ? n : null };
    })
    .filter(d => /^[A-Z]{3}$/.test(d.abbr))
    .slice(0, 5);

  return { year, slug, session, drivers };
}

export function buildShareSearch(
  year: number, slug: string, session: string, drivers: DriverSelection[],
): string {
  const q = new URLSearchParams({ y: String(year), e: slug, s: session });
  const d = drivers
    .filter(x => x.abbr)
    .map(x => (typeof x.lap === 'number' ? `${x.abbr}-${x.lap}` : x.abbr))
    .join(',');
  if (d) q.set('d', d);
  // Commas are safe in a query string and keep the link readable.
  return `?${q.toString().replace(/%2C/g, ',')}`;
}

export function replaceUrlSearch(search: string) {
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, '', url);
  }
}
