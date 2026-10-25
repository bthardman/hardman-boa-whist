import { describe, expect, it } from 'vitest';
import type { GameRecord, GameRecordPlayer } from '../shared/stats.ts';
import { insertGame, readStats, readTableSettings, saveTableSettings } from './db.ts';
import { onRequestPost } from '../functions/api/games.ts';
import { onRequestGet } from '../functions/api/stats.ts';
import * as settingsApi from '../functions/api/settings.ts';

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
  sliders: 0,
  earlyRounds: 0,
  lastHearts: 0,
  highBids: 0,
  bidCounts: [1, 4, 3, 0, 0, 0, 0, 0],
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
    expect(await readStats(sqlite!.sqliteD1())).toEqual({ people: [], recent: [], headToHead: [] });
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

  it('adds up sliders, early tricks, last-trick hearts and how often each bid was made', async () => {
    const db = sqlite!.sqliteD1();
    const extra = { sliders: 2, earlyRounds: 3, lastHearts: 1, highBids: 2 };
    await insertGame(db, game([player(0, 'brad', 5, 1, extra), player(1, 'rowan', 3, 2)]));
    await insertGame(db, game([player(0, 'brad', 2, 2, { ...extra, bidCounts: [0, 1, 5, 0, 0, 0, 0, 0] }), player(1, 'rowan', 5, 1)]));
    const brad = (await readStats(db)).people.find((p) => p.key === 'brad')!.family!;
    expect(brad).toMatchObject({ sliders: 4, earlyRounds: 6, lastHearts: 2, highBids: 4 });
    expect(brad.bidCounts).toEqual([1, 5, 8, 0, 0, 0, 0, 0]);
  });

  it("works out each person's fair share of sliders etc. from the tables they played at", async () => {
    const db = sqlite!.sqliteD1();
    // Two-player games: 6 sliders between two seats is a fair share of 3 each; Brad had all 6.
    await insertGame(db, game([player(0, 'brad', 5, 1, { sliders: 6 }), player(1, 'rowan', 3, 2)]));
    // A three-player game with a computer player: 3 last-trick hearts shared three ways.
    await insertGame(db, game([player(0, 'brad', 5, 1), player(1, 'rowan', 3, 2, { lastHearts: 3 }), player(2, 'bot:Player 2', 1, 3)]));
    const people = (await readStats(db)).people;
    const brad = people.find((p) => p.key === 'brad')!.family!;
    const rowan = people.find((p) => p.key === 'rowan')!.family!;
    expect(brad.expected).toMatchObject({ sliders: 3, lastHearts: 1 });
    expect(rowan.expected).toMatchObject({ sliders: 3, lastHearts: 1 });
    expect(brad.expected.zeroBids).toBeCloseTo(2); // everyone bid 0 once per game
  });

  it('keeps head-to-head records between family members in family games', async () => {
    const db = sqlite!.sqliteD1();
    await insertGame(db, game([player(0, 'brad', 5, 1), player(1, 'rowan', 3, 2), player(2, 'tony', 3, 2)]));
    await insertGame(db, game([player(0, 'brad', 1, 2), player(1, 'rowan', 5, 1), player(2, 'guest:Sam', 0, 3)]));
    await insertGame(db, game([player(0, 'brad', 5, 1), player(1, 'bot:Player 2', 1, 2)], { kind: 'practice' }));
    const h2h = (await readStats(db)).headToHead;
    expect(h2h).toEqual(
      expect.arrayContaining([
        { a: 'brad', b: 'rowan', aWins: 1, bWins: 1, ties: 0 },
        { a: 'brad', b: 'tony', aWins: 1, bWins: 0, ties: 0 },
        { a: 'rowan', b: 'tony', aWins: 0, bWins: 0, ties: 1 }
      ])
    );
    expect(h2h).toHaveLength(3); // guests, computer players and practice games aren't included
  });

  it('upgrades a database made before the newer stats were added', async () => {
    const db = sqlite!.sqliteD1();
    await db.prepare(`CREATE TABLE game_players (game_id TEXT NOT NULL, seat INTEGER NOT NULL, player_key TEXT NOT NULL, kind TEXT NOT NULL,
      name TEXT NOT NULL, score INTEGER NOT NULL, place INTEGER NOT NULL, rounds_made INTEGER NOT NULL, zero_bids INTEGER NOT NULL,
      zero_bids_made INTEGER NOT NULL, bid_total INTEGER NOT NULL, tricks_total INTEGER NOT NULL, PRIMARY KEY (game_id, seat))`).run();
    await db.prepare(`INSERT INTO game_players VALUES ('old', 0, 'carol', 'family', 'Carol', 5, 1, 5, 0, 0, 9, 9)`).run();
    await db.prepare(`CREATE TABLE games (id TEXT PRIMARY KEY, ended_at INTEGER NOT NULL, kind TEXT NOT NULL, winning_score INTEGER NOT NULL,
      rounds INTEGER NOT NULL, bot_difficulty TEXT, winner_key TEXT NOT NULL)`).run();
    await db.prepare(`INSERT INTO games VALUES ('old', 1800000000000, 'family', 5, 9, NULL, 'carol')`).run();

    await insertGame(db, game([player(0, 'carol', 5, 1, { sliders: 1 }), player(1, 'derek', 1, 2)]));
    const carol = (await readStats(db)).people.find((p) => p.key === 'carol')!.family!;
    expect(carol).toMatchObject({ games: 2, wins: 2, sliders: 1 });
  });

  it('saves the family table settings', async () => {
    const db = sqlite!.sqliteD1();
    expect(await readTableSettings(db)).toBeNull();
    await saveTableSettings(db, { winningScore: 3, gameSpeed: 'fast', botDifficulty: 'hard' });
    await saveTableSettings(db, { winningScore: 2, gameSpeed: 'fast', botDifficulty: 'hard' });
    expect(await readTableSettings(db)).toEqual({ winningScore: 2, gameSpeed: 'fast', botDifficulty: 'hard' });
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

  it('only lets the game server read and save the table settings', async () => {
    const env = { DB: sqlite!.sqliteD1(), STATS_SECRET: 'shh-its-a-secret' };
    const request = (method: string, auth: string | null, body?: unknown) =>
      new Request('https://example.test/api/settings', {
        method,
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    const settings = { winningScore: 3, gameSpeed: 'slow', botDifficulty: 'easy' };
    expect((await settingsApi.onRequestGet({ env, request: request('GET', null) })).status).toBe(401);
    expect((await settingsApi.onRequestPut({ env, request: request('PUT', 'Bearer nope', settings) })).status).toBe(401);
    expect((await settingsApi.onRequestPut({ env, request: request('PUT', 'Bearer shh-its-a-secret', { ...settings, winningScore: 9 }) })).status).toBe(400);
    expect((await settingsApi.onRequestPut({ env, request: request('PUT', 'Bearer shh-its-a-secret', settings) })).status).toBe(200);
    const res = await settingsApi.onRequestGet({ env, request: request('GET', 'Bearer shh-its-a-secret') });
    expect(await res.json()).toEqual(settings);
  });

  it('says so when stats are not set up', async () => {
    expect((await onRequestGet({ env: {}, request: new Request('https://example.test/api/stats') })).status).toBe(503);
    expect((await post({}, {}, 'Bearer x')).status).toBe(503);
  });
});
