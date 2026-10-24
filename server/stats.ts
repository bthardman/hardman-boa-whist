// Stats: tallies each seat's rounds during a game, and reports each finished game to the stats
// API (a Cloudflare Pages Function backed by D1), retrying for a while if it can't be reached.
import { randomUUID } from 'crypto';
import type { GameState } from '../shared/types.ts';
import type { GameRecord, GameRecordPlayer, RecordPlayerKind } from '../shared/stats.ts';
import { displayName } from '../shared/players.ts';
import type { Ctx } from './context.ts';

export type SeatTally = Pick<GameRecordPlayer, 'roundsMade' | 'zeroBids' | 'zeroBidsMade' | 'bidTotal' | 'tricksTotal'>;

export const emptyTally = (): SeatTally => ({ roundsMade: 0, zeroBids: 0, zeroBidsMade: 0, bidTotal: 0, tricksTotal: 0 });

/** Adds the round that just finished to each seat's tally (seats don't change during a game). */
export function tallyRound(ctx: Ctx, room: GameState): void {
  const tallies = ctx.tallies.get(room.roomId);
  if (!tallies) return;
  room.players.forEach((p, seat) => {
    const t = tallies[seat];
    if (!t) return;
    const bid = p.bid ?? 0;
    const made = bid === p.tricksWon;
    t.bidTotal += bid;
    t.tricksTotal += p.tricksWon;
    if (made) t.roundsMade++;
    if (bid === 0) {
      t.zeroBids++;
      if (made) t.zeroBidsMade++;
    }
  });
}

/** The record of a game that has just been won. */
export function buildGameRecord(ctx: Ctx, room: GameState): GameRecord {
  const tallies = ctx.tallies.get(room.roomId) ?? [];
  const scores = room.players.map((_, seat) => room.scoreboard[seat] ?? 0);
  const players: GameRecordPlayer[] = room.players.map((p, seat) => {
    const kind: RecordPlayerKind = p.isBot ? 'bot' : p.guestName ? 'guest' : 'family';
    const key = kind === 'bot' ? `bot:${p.botName}` : kind === 'guest' ? `guest:${p.guestName!.toLowerCase()}` : p.selectedAvatar;
    const score = scores[seat];
    return {
      seat,
      key,
      kind,
      name: displayName(p),
      score,
      place: 1 + scores.filter((s) => s > score).length,
      ...(tallies[seat] ?? emptyTally())
    };
  });
  const winnerSeat = room.winner ? room.players.indexOf(room.winner) : -1;
  return {
    id: randomUUID(),
    endedAt: Date.now(),
    kind: room.isPractice ? 'practice' : 'family',
    winningScore: room.winningScore ?? 5,
    rounds: room.roundNumber,
    botDifficulty: room.players.some((p) => p.isBot) ? (room.botDifficulty ?? 'medium') : null,
    winnerKey: (players[winnerSeat] ?? players.find((p) => p.place === 1) ?? players[0]).key,
    players
  };
}

export function reportFinishedGame(ctx: Ctx, room: GameState): void {
  if (!ctx.reportGame) return;
  try {
    ctx.reportGame(buildGameRecord(ctx, room));
  } catch (err) {
    console.error('Could not report the game to stats', err);
  }
}

/** Waits between attempts when the stats API can't be reached (then gives up). */
const RETRY_DELAYS_MS = [5_000, 30_000, 2 * 60_000, 10 * 60_000];

/** Sends finished games to the stats API at `url` (the Pages site), signed with the shared secret. */
export function httpGameReporter(url: string, secret: string, setTimer: Ctx['setTimer']): (record: GameRecord) => void {
  const endpoint = `${url.replace(/\/+$/, '')}/api/games`;
  const attempt = (record: GameRecord, tries: number) => {
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(record)
    })
      .then((res) => {
        if (res.ok) return;
        // A wrong secret or a rejected record won't fix itself: say so rather than retrying.
        if (res.status === 400 || res.status === 401) {
          console.error(`The stats API refused a game (${res.status}). Check STATS_SECRET matches on Render and Cloudflare.`);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      })
      .catch((err) => {
        if (tries >= RETRY_DELAYS_MS.length) {
          console.error('Gave up reporting a game to the stats API', err);
          return;
        }
        setTimer(() => attempt(record, tries + 1), RETRY_DELAYS_MS[tries]);
      });
  };
  return (record) => attempt(record, 0);
}
