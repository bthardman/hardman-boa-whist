// Stats storage in Cloudflare D1 (SQLite), used by the Pages Functions in functions/api.
// Kept separate from the functions so it can be tested locally against an in-memory SQLite.
import type { GameKind, GameRecord, PersonStats, PersonSummary, RecentGame, StatsResponse } from '../shared/stats.ts';

/** The parts of Cloudflare's D1 API this module uses. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    ended_at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    winning_score INTEGER NOT NULL,
    rounds INTEGER NOT NULL,
    bot_difficulty TEXT,
    winner_key TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS game_players (
    game_id TEXT NOT NULL,
    seat INTEGER NOT NULL,
    player_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    place INTEGER NOT NULL,
    rounds_made INTEGER NOT NULL,
    zero_bids INTEGER NOT NULL,
    zero_bids_made INTEGER NOT NULL,
    bid_total INTEGER NOT NULL,
    tricks_total INTEGER NOT NULL,
    PRIMARY KEY (game_id, seat)
  )`,
  `CREATE INDEX IF NOT EXISTS game_players_by_key ON game_players (player_key)`,
  `CREATE INDEX IF NOT EXISTS games_by_end ON games (ended_at)`
];

/** Creates the tables on first use (once per database connection object). */
const ready = new WeakSet<object>();
export async function ensureSchema(db: D1Like): Promise<void> {
  if (ready.has(db)) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  ready.add(db);
}

/** Stores a finished game. Storing the same game twice (a retried report) changes nothing. */
export async function insertGame(db: D1Like, game: GameRecord): Promise<void> {
  await ensureSchema(db);
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO games (id, ended_at, kind, winning_score, rounds, bot_difficulty, winner_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(game.id, game.endedAt, game.kind, game.winningScore, game.rounds, game.botDifficulty, game.winnerKey),
    ...game.players.map((p) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO game_players
             (game_id, seat, player_key, kind, name, score, place, rounds_made, zero_bids, zero_bids_made, bid_total, tricks_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(game.id, p.seat, p.key, p.kind, p.name, p.score, p.place, p.roundsMade, p.zeroBids, p.zeroBidsMade, p.bidTotal, p.tricksTotal)
    )
  ]);
}

type TotalsRow = {
  player_key: string;
  kind: GameKind;
  games: number;
  wins: number;
  rounds: number;
  rounds_made: number;
  bid_total: number;
  zero_bids: number;
  zero_bids_made: number;
  points: number;
};

/**
 * Everyone's stats (family members only: guests and computer players appear in the history but
 * don't get stats), split into family games and practice, plus the most recent games.
 */
export async function readStats(db: D1Like, recentLimit = 20): Promise<StatsResponse> {
  await ensureSchema(db);
  const totals = await db
    .prepare(
      `SELECT p.player_key, g.kind,
         COUNT(*) AS games,
         SUM(CASE WHEN p.place = 1 THEN 1 ELSE 0 END) AS wins,
         SUM(g.rounds) AS rounds,
         SUM(p.rounds_made) AS rounds_made,
         SUM(p.bid_total) AS bid_total,
         SUM(p.zero_bids) AS zero_bids,
         SUM(p.zero_bids_made) AS zero_bids_made,
         SUM(p.score) AS points
       FROM game_players p JOIN games g ON g.id = p.game_id
       WHERE p.kind = 'family'
       GROUP BY p.player_key, g.kind`
    )
    .all<TotalsRow>();

  // Winning streaks need each person's results in order.
  const results = await db
    .prepare(
      `SELECT p.player_key, g.kind, p.place
       FROM game_players p JOIN games g ON g.id = p.game_id
       WHERE p.kind = 'family'
       ORDER BY g.ended_at ASC`
    )
    .all<{ player_key: string; kind: GameKind; place: number }>();
  const streaks = new Map<string, { best: number; current: number }>();
  for (const row of results.results) {
    const id = `${row.player_key}|${row.kind}`;
    const s = streaks.get(id) ?? { best: 0, current: 0 };
    s.current = row.place === 1 ? s.current + 1 : 0;
    s.best = Math.max(s.best, s.current);
    streaks.set(id, s);
  }

  const people = new Map<string, PersonSummary>();
  for (const row of totals.results) {
    const person = people.get(row.player_key) ?? { key: row.player_key, family: null, practice: null };
    const streak = streaks.get(`${row.player_key}|${row.kind}`) ?? { best: 0, current: 0 };
    const stats: PersonStats = {
      games: Number(row.games),
      wins: Number(row.wins),
      rounds: Number(row.rounds),
      roundsMade: Number(row.rounds_made),
      bidTotal: Number(row.bid_total),
      zeroBids: Number(row.zero_bids),
      zeroBidsMade: Number(row.zero_bids_made),
      points: Number(row.points),
      bestStreak: streak.best,
      currentStreak: streak.current
    };
    person[row.kind] = stats;
    people.set(row.player_key, person);
  }

  const games = await db
    .prepare(
      `SELECT id, ended_at, kind, rounds, winning_score, bot_difficulty, winner_key
       FROM games ORDER BY ended_at DESC LIMIT ?`
    )
    .bind(recentLimit)
    .all<{ id: string; ended_at: number; kind: GameKind; rounds: number; winning_score: number; bot_difficulty: RecentGame['botDifficulty']; winner_key: string }>();
  const recent: RecentGame[] = games.results.map((g) => ({
    id: g.id,
    endedAt: Number(g.ended_at),
    kind: g.kind,
    rounds: Number(g.rounds),
    winningScore: Number(g.winning_score),
    botDifficulty: g.bot_difficulty ?? null,
    winnerKey: g.winner_key,
    players: []
  }));
  if (recent.length) {
    const placeholders = recent.map(() => '?').join(', ');
    const seats = await db
      .prepare(
        `SELECT game_id, player_key, kind, name, score, place FROM game_players
         WHERE game_id IN (${placeholders}) ORDER BY place ASC, seat ASC`
      )
      .bind(...recent.map((g) => g.id))
      .all<{ game_id: string; player_key: string; kind: RecentGame['players'][number]['kind']; name: string; score: number; place: number }>();
    const byId = new Map(recent.map((g) => [g.id, g]));
    for (const s of seats.results) {
      byId.get(s.game_id)?.players.push({ key: s.player_key, kind: s.kind, name: s.name, score: Number(s.score), place: Number(s.place) });
    }
  }

  return { people: [...people.values()], recent };
}
