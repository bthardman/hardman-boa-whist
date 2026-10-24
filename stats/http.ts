// Small helpers for the stats API (Cloudflare Pages Functions in functions/api).
import type { D1Like } from './db.ts';

/** What Cloudflare passes each function: the request, plus the D1 binding and secret from the Pages settings. */
export type StatsEnv = { DB?: D1Like; STATS_SECRET?: string };
export type StatsContext = { request: Request; env: StatsEnv };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Compares every character, so the time taken doesn't reveal how much of a guessed secret was right. */
export function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
