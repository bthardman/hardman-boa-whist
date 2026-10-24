// Game records and stats, shared by the game server (which reports finished games), the stats
// API on Cloudflare Pages (which stores them in D1) and the app (which shows them).
import type { BotDifficulty } from './types.ts';

/** 'family': two or more people (computer players allowed). 'practice': one person against the computer. */
export type GameKind = 'family' | 'practice';
export type RecordPlayerKind = 'family' | 'guest' | 'bot';

export type GameRecordPlayer = {
  seat: number;
  /** Who this is across games: the family face (e.g. 'brad'), 'guest:<name>' or 'bot:<name>'. */
  key: string;
  kind: RecordPlayerKind;
  /** The name shown at the time. */
  name: string;
  /** Final points. */
  score: number;
  /** 1 = winner; tied players share a place. */
  place: number;
  /** Rounds where they won exactly the tricks they bid. */
  roundsMade: number;
  zeroBids: number;
  zeroBidsMade: number;
  bidTotal: number;
  tricksTotal: number;
};

export type GameRecord = {
  /** Unique per game, so a report that's retried is only stored once. */
  id: string;
  endedAt: number;
  kind: GameKind;
  winningScore: number;
  rounds: number;
  /** Set when computer players took part. */
  botDifficulty: BotDifficulty | null;
  winnerKey: string;
  players: GameRecordPlayer[];
};

/** One person's totals for one kind of game. */
export type PersonStats = {
  games: number;
  wins: number;
  rounds: number;
  roundsMade: number;
  bidTotal: number;
  zeroBids: number;
  zeroBidsMade: number;
  points: number;
  bestStreak: number;
  currentStreak: number;
};

export type PersonSummary = { key: string; family: PersonStats | null; practice: PersonStats | null };

export type RecentGame = {
  id: string;
  endedAt: number;
  kind: GameKind;
  rounds: number;
  winningScore: number;
  botDifficulty: BotDifficulty | null;
  winnerKey: string;
  players: { key: string; kind: RecordPlayerKind; name: string; score: number; place: number }[];
};

export type StatsResponse = { people: PersonSummary[]; recent: RecentGame[] };

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Checks a game record sent to the stats API; returns null if anything is missing or out of range. */
export function parseGameRecord(body: unknown): GameRecord | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as Record<string, unknown>;
  if (!isText(r.id, 64) || !isInt(r.endedAt, 1_600_000_000_000, 4_000_000_000_000)) return null;
  if (r.kind !== 'family' && r.kind !== 'practice') return null;
  if (!isInt(r.winningScore, 1, 20) || !isInt(r.rounds, 1, 500) || !isText(r.winnerKey, 60)) return null;
  if (r.botDifficulty !== null && r.botDifficulty !== 'easy' && r.botDifficulty !== 'medium' && r.botDifficulty !== 'hard') return null;
  if (!Array.isArray(r.players) || r.players.length < 2 || r.players.length > 7) return null;
  const players: GameRecordPlayer[] = [];
  for (const raw of r.players) {
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as Record<string, unknown>;
    if (!isInt(p.seat, 0, 6) || !isText(p.key, 60) || !isText(p.name, 40)) return null;
    if (p.kind !== 'family' && p.kind !== 'guest' && p.kind !== 'bot') return null;
    const counts = [p.score, p.place, p.roundsMade, p.zeroBids, p.zeroBidsMade, p.bidTotal, p.tricksTotal];
    if (!counts.every((n) => isInt(n, 0, 5000))) return null;
    players.push({
      seat: p.seat,
      key: p.key,
      kind: p.kind,
      name: p.name,
      score: p.score as number,
      place: p.place as number,
      roundsMade: p.roundsMade as number,
      zeroBids: p.zeroBids as number,
      zeroBidsMade: p.zeroBidsMade as number,
      bidTotal: p.bidTotal as number,
      tricksTotal: p.tricksTotal as number
    });
  }
  return {
    id: r.id,
    endedAt: r.endedAt,
    kind: r.kind,
    winningScore: r.winningScore,
    rounds: r.rounds,
    botDifficulty: r.botDifficulty as BotDifficulty | null,
    winnerKey: r.winnerKey,
    players
  };
}
