// POST /api/games — the game server reports each finished game here (Cloudflare Pages Function).
import { parseGameRecord } from '../../shared/stats.ts';
import { insertGame } from '../../stats/db.ts';
import { json, sameSecret, type StatsContext } from '../../stats/http.ts';

export async function onRequestPost({ request, env }: StatsContext): Promise<Response> {
  if (!env.DB || !env.STATS_SECRET) return json({ error: 'Stats are not set up' }, 503);
  // Only the game server knows the secret, so nobody can post made-up results.
  if (!sameSecret(request.headers.get('authorization') ?? '', `Bearer ${env.STATS_SECRET}`)) {
    return json({ error: 'Not allowed' }, 401);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }
  const game = parseGameRecord(body);
  if (!game) return json({ error: 'Bad game record' }, 400);
  await insertGame(env.DB, game);
  return json({ ok: true }, 201);
}
