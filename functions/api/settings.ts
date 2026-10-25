// GET / PUT /api/settings — the family table's settings (points to win, pace, computer difficulty),
// saved here by the game server so they survive restarts (Cloudflare Pages Function).
import { parseTableSettings } from '../../shared/stats.ts';
import { readTableSettings, saveTableSettings } from '../../stats/db.ts';
import { json, sameSecret, type StatsContext } from '../../stats/http.ts';

/** Only the game server reads and writes these. */
function refuse({ request, env }: StatsContext): Response | null {
  if (!env.DB || !env.STATS_SECRET) return json({ error: 'Stats are not set up' }, 503);
  if (!sameSecret(request.headers.get('authorization') ?? '', `Bearer ${env.STATS_SECRET}`)) {
    return json({ error: 'Not allowed' }, 401);
  }
  return null;
}

export async function onRequestGet(context: StatsContext): Promise<Response> {
  const refusal = refuse(context);
  if (refusal) return refusal;
  return json((await readTableSettings(context.env.DB!)) ?? {}, 200, { 'cache-control': 'no-store' });
}

export async function onRequestPut(context: StatsContext): Promise<Response> {
  const refusal = refuse(context);
  if (refusal) return refusal;
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }
  const settings = parseTableSettings(body);
  if (!settings) return json({ error: 'Bad settings' }, 400);
  await saveTableSettings(context.env.DB!, settings);
  return json({ ok: true });
}
