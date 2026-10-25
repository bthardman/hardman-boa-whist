// Stats: tallies each seat's rounds during a game, and reports each finished game to the stats
// API (a Cloudflare Pages Function backed by D1), retrying for a while if it can't be reached.
import { randomUUID } from 'crypto';
import type { GameState, OwnedCard } from '../shared/types.ts';
import { BID_SLOTS, highBidFrom, type GameRecord, type GameRecordPlayer, type RecordPlayerKind } from '../shared/stats.ts';
import { cardValue } from './utils/cardUtils.ts';
import { displayName } from '../shared/players.ts';
import type { Ctx } from './context.ts';

export type SeatTally = Pick<
  GameRecordPlayer,
  'roundsMade' | 'zeroBids' | 'zeroBidsMade' | 'bidTotal' | 'tricksTotal' | 'sliders' | 'bidCounts' | 'earlyRounds' | 'lastHearts' | 'highBids'
>;

export const emptyTally = (): SeatTally => ({
  roundsMade: 0,
  zeroBids: 0,
  zeroBidsMade: 0,
  bidTotal: 0,
  tricksTotal: 0,
  sliders: 0,
  earlyRounds: 0,
  lastHearts: 0,
  highBids: 0,
  bidCounts: new Array(BID_SLOTS).fill(0)
});

const SLIDER_MAX = cardValue('7');

/**
 * Sliders: a trick won by a card of 7 or lower of the suit led (a low trump ruffing in doesn't count).
 * Everyone who played after that card went under it or threw away, so each of them gets a slider.
 *
 * Also early tricks: the winner reaching their bid (1+) within the first bid + 1 tricks of the round;
 * and last-trick hearts: winning the round's final trick with a heart to make their bid exactly.
 * Call this before the trick is added to the winner's tricks and to completedTricks.
 */
export function tallyTrick(ctx: Ctx, room: GameState, trick: OwnedCard[], winnerSeat: number): void {
  const tallies = ctx.tallies.get(room.roomId);
  const winnerId = room.players[winnerSeat]?.playerId;
  if (!tallies || !winnerId || !trick.length) return;
  const winner = room.players[winnerSeat];
  const trickNumber = (room.completedTricks?.length ?? 0) + 1;
  if (winner.bid && winner.tricksWon + 1 === winner.bid && trickNumber <= winner.bid + 1 && tallies[winnerSeat]) {
    tallies[winnerSeat].earlyRounds++;
  }
  const lastTrick = room.players.every((p) => p.hand.length === 0);
  const winningCard = trick.find((c) => c.playerId === winnerId)?.card;
  if (lastTrick && winningCard?.suit === 'hearts' && winner.tricksWon + 1 === winner.bid && tallies[winnerSeat]) {
    tallies[winnerSeat].lastHearts++;
  }
  const at = trick.findIndex((c) => c.playerId === winnerId);
  const winning = trick[at];
  if (!winning || winning.card.suit !== trick[0].card.suit || cardValue(winning.card.value) > SLIDER_MAX) return;
  const sliders = trick.slice(at + 1).map((c) => room.players.findIndex((p) => p.playerId === c.playerId));
  if (!sliders.length) return;
  for (const seat of sliders) if (tallies[seat]) tallies[seat].sliders++;
}

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
    if (bid < BID_SLOTS) t.bidCounts[bid]++;
    if (bid >= highBidFrom(room.players.length)) t.highBids++;
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
      ...(tallies[seat] ?? emptyTally()),
      bidCounts: [...(tallies[seat] ?? emptyTally()).bidCounts]
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
