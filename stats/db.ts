// Stats storage in Cloudflare D1 (SQLite), used by the Pages Functions in functions/api.
// Kept separate from the functions so it can be tested locally against an in-memory SQLite.
import {
  BID_SLOTS,
  COMPARED_STATS,
  parseTableSettings,
  type ComparedStat,
  type GameKind,
  type GameRecord,
  type HeadToHead,
  type PersonStats,
  type PersonSummary,
  type RecentGame,
  type StatsResponse,
  type TableSettings
} from '../shared/stats.ts';

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
  `CREATE INDEX IF NOT EXISTS games_by_end ON games (ended_at)`,
  `CREATE TABLE IF NOT EXISTS table_settings (
    id TEXT PRIMARY KEY,
    winning_score INTEGER NOT NULL,
    game_speed TEXT NOT NULL,
    bot_difficulty TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`
];

/** Columns added after the first release: added to an existing database the first time it's used. */
const ADDED_COLUMNS = [
  `ALTER TABLE game_players ADD COLUMN sliders INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE game_players ADD COLUMN early_rounds INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE game_players ADD COLUMN last_hearts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE game_players ADD COLUMN high_bids INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE game_players ADD COLUMN bid_counts TEXT NOT NULL DEFAULT ''`
];

/** Creates the tables on first use (once per database connection object). */
const ready = new WeakSet<object>();
export async function ensureSchema(db: D1Like): Promise<void> {
  if (ready.has(db)) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  for (const sql of ADDED_COLUMNS) {
    try {
      await db.prepare(sql).run();
    } catch (err) {
      if (!/duplicate column/i.test(String((err as Error)?.message ?? err))) throw err;
    }
  }
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
             (game_id, seat, player_key, kind, name, score, place, rounds_made, zero_bids, zero_bids_made, bid_total, tricks_total,
              sliders, early_rounds, last_hearts, high_bids, bid_counts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          game.id, p.seat, p.key, p.kind, p.name, p.score, p.place, p.roundsMade, p.zeroBids, p.zeroBidsMade, p.bidTotal, p.tricksTotal,
          p.sliders, p.earlyRounds, p.lastHearts, p.highBids, p.bidCounts.join(',')
        )
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
  sliders: number;
  early_rounds: number;
  last_hearts: number;
  high_bids: number;
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
         SUM(p.score) AS points,
         SUM(p.sliders) AS sliders,
         SUM(p.early_rounds) AS early_rounds,
         SUM(p.last_hearts) AS last_hearts,
         SUM(p.high_bids) AS high_bids
       FROM game_players p JOIN games g ON g.id = p.game_id
       WHERE p.kind = 'family'
       GROUP BY p.player_key, g.kind`
    )
    .all<TotalsRow>();

  // Streaks, bid counts, head-to-head and fair shares need everyone's results game by game, in order.
  const results = await db
    .prepare(
      `SELECT p.game_id, p.player_key, p.kind AS player_kind, g.kind, p.place, p.bid_counts,
         p.sliders, p.early_rounds, p.last_hearts, p.high_bids, p.zero_bids
       FROM game_players p JOIN games g ON g.id = p.game_id
       ORDER BY g.ended_at ASC, p.game_id`
    )
    .all<ResultRow>();

  // Each game's totals of the compared stats, so each person's fair share is that total split by the seats.
  const gameTotals = new Map<string, { seats: number; totals: Record<ComparedStat, number> }>();
  for (const row of results.results) {
    const game = gameTotals.get(row.game_id) ?? { seats: 0, totals: zeroCompared() };
    game.seats++;
    for (const stat of COMPARED_STATS) game.totals[stat] += comparedValue(row, stat);
    gameTotals.set(row.game_id, game);
  }

  const streaks = new Map<string, { best: number; current: number }>();
  const bidCounts = new Map<string, number[]>();
  const expected = new Map<string, Record<ComparedStat, number>>();
  const familyGames = new Map<string, { key: string; place: number }[]>();
  for (const row of results.results) {
    if (row.player_kind !== 'family') continue;
    const id = `${row.player_key}|${row.kind}`;
    const s = streaks.get(id) ?? { best: 0, current: 0 };
    s.current = row.place === 1 ? s.current + 1 : 0;
    s.best = Math.max(s.best, s.current);
    streaks.set(id, s);

    const counts = bidCounts.get(id) ?? new Array(BID_SLOTS).fill(0);
    (row.bid_counts ?? '').split(',').forEach((n, bid) => {
      if (bid < BID_SLOTS) counts[bid] += Number(n) || 0;
    });
    bidCounts.set(id, counts);

    const game = gameTotals.get(row.game_id)!;
    const share = expected.get(id) ?? zeroCompared();
    for (const stat of COMPARED_STATS) share[stat] += game.totals[stat] / game.seats;
    expected.set(id, share);

    if (row.kind === 'family') {
      const seats = familyGames.get(row.game_id) ?? [];
      seats.push({ key: row.player_key, place: Number(row.place) });
      familyGames.set(row.game_id, seats);
    }
  }
  const headToHead = tallyHeadToHead(familyGames.values());

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
      currentStreak: streak.current,
      sliders: Number(row.sliders ?? 0),
      earlyRounds: Number(row.early_rounds ?? 0),
      lastHearts: Number(row.last_hearts ?? 0),
      highBids: Number(row.high_bids ?? 0),
      bidCounts: bidCounts.get(`${row.player_key}|${row.kind}`) ?? new Array(BID_SLOTS).fill(0),
      expected: expected.get(`${row.player_key}|${row.kind}`) ?? zeroCompared()
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

  return { people: [...people.values()], recent, headToHead };
}

type ResultRow = {
  game_id: string;
  player_key: string;
  player_kind: string;
  kind: GameKind;
  place: number;
  bid_counts: string | null;
  sliders: number | null;
  early_rounds: number | null;
  last_hearts: number | null;
  high_bids: number | null;
  zero_bids: number | null;
};

const zeroCompared = (): Record<ComparedStat, number> =>
  Object.fromEntries(COMPARED_STATS.map((s) => [s, 0])) as Record<ComparedStat, number>;

const COLUMN: Record<ComparedStat, keyof ResultRow> = {
  sliders: 'sliders',
  earlyRounds: 'early_rounds',
  lastHearts: 'last_hearts',
  highBids: 'high_bids',
  zeroBids: 'zero_bids'
};
const comparedValue = (row: ResultRow, stat: ComparedStat) => Number(row[COLUMN[stat]] ?? 0);

/** Each pair of family members' record in the family games they both played: the higher place wins. */
function tallyHeadToHead(games: Iterable<{ key: string; place: number }[]>): HeadToHead[] {
  const pairs = new Map<string, HeadToHead>();
  for (const seats of games) {
    for (const x of seats) {
      for (const y of seats) {
        if (x.key >= y.key) continue; // each pair once, in name order
        const id = `${x.key}|${y.key}`;
        const pair = pairs.get(id) ?? { a: x.key, b: y.key, aWins: 0, bWins: 0, ties: 0 };
        if (x.place < y.place) pair.aWins++;
        else if (y.place < x.place) pair.bWins++;
        else pair.ties++;
        pairs.set(id, pair);
      }
    }
  }
  return [...pairs.values()];
}

/** The family table's saved settings, if any have been saved. */
export async function readTableSettings(db: D1Like): Promise<TableSettings | null> {
  await ensureSchema(db);
  const rows = await db
    .prepare(`SELECT winning_score, game_speed, bot_difficulty FROM table_settings WHERE id = 'family'`)
    .all<{ winning_score: number; game_speed: string; bot_difficulty: string }>();
  const row = rows.results[0];
  if (!row) return null;
  return parseTableSettings({ winningScore: Number(row.winning_score), gameSpeed: row.game_speed, botDifficulty: row.bot_difficulty });
}

export async function saveTableSettings(db: D1Like, settings: TableSettings): Promise<void> {
  await ensureSchema(db);
  await db
    .prepare(
      `INSERT INTO table_settings (id, winning_score, game_speed, bot_difficulty, updated_at) VALUES ('family', ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET winning_score = excluded.winning_score, game_speed = excluded.game_speed,
         bot_difficulty = excluded.bot_difficulty, updated_at = excluded.updated_at`
    )
    .bind(settings.winningScore, settings.gameSpeed, settings.botDifficulty, Date.now())
    .run();
}
