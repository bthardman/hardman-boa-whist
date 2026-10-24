import { describe, expect, it } from 'vitest';
import type { GameRecord, GameRecordPlayer } from '../shared/stats.ts';
import { insertGame, readStats } from './db.ts';
import { onRequestPost } from '../functions/api/games.ts';
import { onRequestGet } from '../functions/api/stats.ts';

// Node's built-in SQLite (Node 22+) stands in for Cloudflare D1.
const sqlite = await import('./sqliteD1.ts').catch(() => null);

const player = (seat: number, key: string, score: number, place: number, extra: Partial<GameRecordPlayer> = {}): GameRecordPlayer => ({
  seat,
  key,
  kind: key.startsWith('guest:') ? 'guest' : key.startsWith('bot:') ? 'bot' : 'family',
  name: key.replace(/^(guest|bot):/, ''),
  score,
  place,
  roundsMade: score,
  zeroBids: 1,
  zeroBidsMade: 0,
  bidTotal: 6,
  tricksTotal: 7,
  ...extra
});

let counter = 0;
const game = (players: GameRecordPlayer[], extra: Partial<GameRecord> = {}): GameRecord => ({
  id: `game-${++counter}`,
  endedAt: 1_800_000_000_000 + counter * 1000,
  kind: 'family',
  winningScore: 5,
  rounds: 8,
  botDifficulty: null,
  winnerKey: players.find((p) => p.place === 1)!.key,
  players,
  ...extra
});

describe.skipIf(!sqlite)('stats storage', () => {
  it('starts empty', async () => {
    expect(await readStats(sqlite!.sqliteD1())).toEqual({ people: [], recent: [] });
  });

  it('keeps family games and practice apart, and gives guests and computer players history but no stats', async () => {
    const db = sqlite!.sqliteD1();
    await insertGame(db, game([player(0, 'brad', 5, 1), player(1, 'rowan', 3, 2), player(2, 'guest:Sam', 1, 3)]));
    await insertGame(db, game([player(0, 'rowan', 4, 1), player(1, 'bot:Player 2', 2, 2)], { kind: 'practice', botDifficulty: 'hard' }));
    const stats = await readStats(db);

    expect(stats.people.map((p) => p.key).sort()).toEqual(['brad', 'rowan']);
    const rowan = stats.people.find((p) => p.key === 'rowan')!;
    expect(rowan.family).toMatchObject({ games: 1, wins: 0, rounds: 8, points: 3 });
    expect(rowan.practice).toMatchObject({ games: 1, wins: 1 });
    expect(stats.people.find((p) => p.key === 'brad')!.practice).toBeNull();

    expect(stats.recent).toHaveLength(2);
    expect(stats.recent[0]).toMatchObject({ kind: 'practice', botDifficulty: 'hard', winnerKey: 'rowan' });
    expect(stats.recent[1].players.map((p) => p.name)).toEqual(['brad', 'rowan', 'Sam']); // in finishing order
  });

  it('stores a game only once if the report is retried', async () => {
    const db = sqlite!.sqliteD1();
    const g = game([player(0, 'brad', 5, 1), player(1, 'tony', 2, 2)]);
    await insertGame(db, g);
    await insertGame(db, g);
    const stats = await readStats(db);
    expect(stats.recent).toHaveLength(1);
    expect(stats.people.find((p) => p.key === 'brad')!.family!.games).toBe(1);
  });

  it('works out the best and current winning streaks', async () => {
    const db = sqlite!.sqliteD1();
    for (const bradWins of [true, true, false, true]) {
      await insertGame(db, game([player(0, 'brad', bradWins ? 5 : 2, bradWins ? 1 : 2), player(1, 'carol', bradWins ? 2 : 5, bradWins ? 2 : 1)]));
    }
    const brad = (await readStats(db)).people.find((p) => p.key === 'brad')!.family!;
    expect(brad).toMatchObject({ games: 4, wins: 3, bestStreak: 2, currentStreak: 1 });
  });
});

describe.skipIf(!sqlite)('stats API', () => {
  const post = (env: Parameters<typeof onRequestPost>[0]['env'], body: unknown, auth?: string) =>
    onRequestPost({
      env,
      request: new Request('https://example.test/api/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      })
    });

  it('only accepts game results from the game server, and only well-formed ones', async () => {
    const env = { DB: sqlite!.sqliteD1(), STATS_SECRET: 'shh-its-a-secret' };
    const good = game([player(0, 'brad', 5, 1), player(1, 'rowan', 3, 2)]);
    expect((await post(env, good)).status).toBe(401);
    expect((await post(env, good, 'Bearer wrong-secret')).status).toBe(401);
    expect((await post(env, '{not json', 'Bearer shh-its-a-secret')).status).toBe(400);
    expect((await post(env, { ...good, players: [] }, 'Bearer shh-its-a-secret')).status).toBe(400);
    expect((await post(env, good, 'Bearer shh-its-a-secret')).status).toBe(201);

    const res = await onRequestGet({ env, request: new Request('https://example.test/api/stats') });
    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats.recent).toHaveLength(1);
    expect(stats.people).toHaveLength(2);
  });

  it('says so when stats are not set up', async () => {
    expect((await onRequestGet({ env: {}, request: new Request('https://example.test/api/stats') })).status).toBe(503);
    expect((await post({}, {}, 'Bearer x')).status).toBe(503);
  });
});
