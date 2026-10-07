// Entry point the server uses to get a computer player's move.
import type { BotDifficulty, GameState } from '../../shared/types.ts';
import { getForbiddenBid } from '../utils/biddingRules.ts';
import { buildBotView, type RoundLogEntry } from './botView.ts';
import { makeRng } from './simulate.ts';
import { strategyFor } from './strategies.ts';

export type { RoundLogEntry } from './botView.ts';

export type BotMove = { kind: 'bid'; bid: number } | { kind: 'play'; cardId: string };

/**
 * Chooses a move for the player at `seat`, seeing only what that player could see.
 * The server still validates the move like any other.
 */
export function chooseMove(room: GameState, seat: number, roundLog: RoundLogEntry[], difficulty: BotDifficulty): BotMove | null {
  const view = buildBotView(room, seat, roundLog);
  const strategy = strategyFor(difficulty);
  const rng = makeRng((Date.now() ^ (seat * 7919)) >>> 0);
  if (room.state === 'bidding') {
    const isLastBidder = room.players.filter((p) => typeof p.bid === 'number').length === room.players.length - 1;
    return { kind: 'bid', bid: strategy.bid(view, isLastBidder ? getForbiddenBid(room.players) : null, rng) };
  }
  if (room.state === 'tricks' && view.hand.length) {
    return { kind: 'play', cardId: strategy.play(view, rng).id };
  }
  return null;
}
