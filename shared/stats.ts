// Game records and stats, shared by the game server (which reports finished games), the stats
// API on Cloudflare Pages (which stores them in D1) and the app (which shows them).
import type { BotDifficulty, GameSpeed } from './types.ts';

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
  /** Sliders: tricks won by a card of 7 or lower that they saw on the table and went under or threw away to. */
  sliders: number;
  /** How many rounds they bid 0, 1, … 7. */
  bidCounts: number[];
  /** Early tricks: rounds (bid 1+) where they reached their bid within the first bid + 1 tricks. */
  earlyRounds: number;
  /** Last-trick hearts: winning the round's final trick with a heart to make their bid exactly. */
  lastHearts: number;
  /** Rounds they bid high for the table size (see highBidFrom). */
  highBids: number;
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
  sliders: number;
  /** Rounds they bid 0, 1, … 7. */
  bidCounts: number[];
  earlyRounds: number;
  lastHearts: number;
  highBids: number;
  /** Each compared stat's fair share at the tables they played at (for badges). */
  expected: Record<ComparedStat, number>;
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

/** Two family members' record against each other in family games (higher place wins). */
export type HeadToHead = { a: string; b: string; aWins: number; bWins: number; ties: number };

export type StatsResponse = { people: PersonSummary[]; recent: RecentGame[]; headToHead: HeadToHead[] };

/** Bids run from 0 to the hand size. */
export const BID_SLOTS = 8;

/** A "high" bid depends on the table: with two players everyone bids higher. */
export function highBidFrom(players: number): number {
  return players <= 2 ? 5 : players <= 4 ? 4 : 3;
}

/** Stats that depend on the table (how many players, how they play), so badges compare them to a fair share. */
export const COMPARED_STATS = ['sliders', 'earlyRounds', 'lastHearts', 'highBids', 'zeroBids'] as const;
export type ComparedStat = (typeof COMPARED_STATS)[number];

export type BadgeId = 'slider' | 'early' | 'lastHeart' | 'highCaller' | 'zeroCaller';
export type Badge = { id: BadgeId; label: string; detail: string };

/** Badges only appear once someone has played this many rounds, so one lucky game doesn't count. */
export const BADGE_MIN_ROUNDS = 10;

const BADGES: { id: BadgeId; stat: ComparedStat; label: string; min: number; ratio: number; what: (n: number) => string }[] = [
  { id: 'slider', stat: 'sliders', label: 'Slider', min: 3, ratio: 1.3, what: (n) => `${n} sliders: went under or threw away so a 7 or lower took the trick` },
  { id: 'early', stat: 'earlyRounds', label: 'Early bird', min: 3, ratio: 1.3, what: (n) => `Got their tricks in early ${n} times (e.g. bid 2, won 2 of the first 3)` },
  { id: 'lastHeart', stat: 'lastHearts', label: 'Final card heart', min: 2, ratio: 1.5, what: (n) => `Made their bid with a heart on the last trick ${n} times` },
  { id: 'highCaller', stat: 'highBids', label: 'High caller', min: 3, ratio: 1.3, what: (n) => `Bid high ${n} times (5+ with two players, 4+ with three or four, 3+ with more)` },
  { id: 'zeroCaller', stat: 'zeroBids', label: 'Zero caller', min: 3, ratio: 1.3, what: (n) => `Bid 0 ${n} times` }
];

/**
 * The badges someone has earned: they do it noticeably more than their fair share at the tables they
 * played at (each game's total split evenly between its seats), and more than just a couple of times.
 */
export function badgesFor(s: PersonStats): Badge[] {
  if (s.rounds < BADGE_MIN_ROUNDS) return [];
  return BADGES.filter((b) => {
    const actual = s[b.stat];
    return actual >= b.min && actual >= b.ratio * s.expected[b.stat];
  }).map((b) => ({
    id: b.id,
    label: b.label,
    detail: `${b.what(s[b.stat])}, against a fair share of ${Math.round(s.expected[b.stat] * 10) / 10}`
  }));
}

/** The bid someone makes most often (lowest wins a tie), or null before they've bid. */
export function usualBid(s: PersonStats): number | null {
  let best: number | null = null;
  s.bidCounts.forEach((n, bid) => {
    if (n > 0 && (best === null || n > s.bidCounts[best])) best = bid;
  });
  return best;
}

/** The family table's settings, saved so they survive server restarts. */
export type TableSettings = { winningScore: number; gameSpeed: GameSpeed; botDifficulty: BotDifficulty };

export function parseTableSettings(body: unknown): TableSettings | null {
  if (!body || typeof body !== 'object') return null;
  const s = body as Record<string, unknown>;
  if (!isInt(s.winningScore, 1, 5)) return null;
  if (s.gameSpeed !== 'slow' && s.gameSpeed !== 'normal' && s.gameSpeed !== 'fast') return null;
  if (s.botDifficulty !== 'easy' && s.botDifficulty !== 'medium' && s.botDifficulty !== 'hard') return null;
  return { winningScore: s.winningScore, gameSpeed: s.gameSpeed, botDifficulty: s.botDifficulty };
}

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
    // Added later: records from an older server don't have these.
    const sliders = p.sliders ?? 0;
    const earlyRounds = p.earlyRounds ?? 0;
    const lastHearts = p.lastHearts ?? 0;
    const highBids = p.highBids ?? 0;
    const bidCounts = p.bidCounts ?? [];
    if (!isInt(sliders, 0, 5000) || !isInt(earlyRounds, 0, 5000) || !isInt(lastHearts, 0, 5000) || !isInt(highBids, 0, 5000)) return null;
    if (!Array.isArray(bidCounts) || bidCounts.length > BID_SLOTS || !bidCounts.every((n) => isInt(n, 0, 5000))) return null;
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
      tricksTotal: p.tricksTotal as number,
      sliders,
      earlyRounds,
      lastHearts,
      highBids,
      bidCounts: Array.from({ length: BID_SLOTS }, (_, i) => (bidCounts[i] as number | undefined) ?? 0)
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
