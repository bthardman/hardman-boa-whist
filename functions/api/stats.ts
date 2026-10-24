// GET /api/stats — everyone's stats and the recent games, for the app (Cloudflare Pages Function).
import { readStats } from '../../stats/db.ts';
import { json, type StatsContext } from '../../stats/http.ts';

export async function onRequestGet({ env }: StatsContext): Promise<Response> {
  if (!env.DB) return json({ error: 'Stats are not set up' }, 503);
  const stats = await readStats(env.DB);
  // Readable from the Render fallback address too; it's only the family's game results.
  return json(stats, 200, { 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
}
