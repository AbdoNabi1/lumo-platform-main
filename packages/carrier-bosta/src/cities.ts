import type { BostaCity } from "./governorates";

export const EGYPT_COUNTRY_ID = "60e4482c7cb7d4bc4849c4d5";
export const CITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface Entry {
  readonly at: number;
  readonly cities: readonly BostaCity[];
}

/**
 * Process-wide city list, keyed by country id and never by tenant (Ruling 9): the list is public
 * Bosta data. A failed fetch is not cached, and concurrent callers share one in-flight fetch.
 */
export class BostaCityDirectory {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<readonly BostaCity[]>>();

  constructor(private readonly now: () => number = Date.now) {}

  cities(
    countryId: string,
    fetchList: () => Promise<readonly BostaCity[]>,
  ): Promise<readonly BostaCity[]> {
    const cached = this.entries.get(countryId);
    if (cached && this.now() - cached.at < CITY_CACHE_TTL_MS) return Promise.resolve(cached.cities);
    const running = this.inflight.get(countryId);
    if (running) return running;
    const started = fetchList().then(
      (cities) => {
        this.entries.set(countryId, { at: this.now(), cities });
        this.inflight.delete(countryId);
        return cities;
      },
      (error: unknown) => {
        this.inflight.delete(countryId);
        throw error;
      },
    );
    this.inflight.set(countryId, started);
    return started;
  }
}
