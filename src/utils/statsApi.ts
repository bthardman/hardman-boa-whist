// Fetches the family's stats and game history (stored in Cloudflare D1 by the stats API).
import type { StatsResponse } from '../../shared/stats';

/** Same address the app was loaded from: the Pages site, the Render fallback, or the dev server. */
export async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch('/api/stats', { cache: 'no-store' });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new Error(`Stats unavailable (${res.status})`);
  }
  return res.json();
}
