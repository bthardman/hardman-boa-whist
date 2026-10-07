// What a computer player is allowed to know: its own hand plus everything that is
// public at the table. It never sees anyone else's cards.
import type { Card, GameState } from '../../shared/types.ts';
import { cardKey, fullDeck, shuffleInPlace, type PlayedCard, type Rng, type SimState } from './simulate.ts';

/** One card played this round, in order. Public information. */
export type RoundLogEntry = { seat: number; card: Card; ledSuit: string };

export type BotView = {
  seat: number;
  numPlayers: number;
  hand: Card[];
  /** Bids so far, by seat (undefined = not bid yet). */
  bids: (number | undefined)[];
  tricksWon: number[];
  /** Cards still held by each seat. */
  handSizes: number[];
  trick: PlayedCard[];
  /** Seat that bids / leads first this round. */
  firstPlayer: number;
  /** Every card already played this round (including the current trick). */
  played: Card[];
  /** Suits each seat has shown it has run out of. */
  voids: Set<string>[];
};

export function buildBotView(room: GameState, seat: number, roundLog: RoundLogEntry[]): BotView {
  const n = room.players.length;
  const voids = Array.from({ length: n }, () => new Set<string>());
  for (const entry of roundLog) {
    if (entry.card.suit !== entry.ledSuit) voids[entry.seat].add(entry.ledSuit);
  }
  const seatOf = new Map(room.players.map((p, i) => [p.playerId, i]));
  return {
    seat,
    numPlayers: n,
    hand: room.players[seat].hand.map((c) => c.card),
    bids: room.players.map((p) => p.bid),
    tricksWon: room.players.map((p) => p.tricksWon),
    handSizes: room.players.map((p) => p.hand.length),
    trick: room.currentTrick.map((c) => ({ seat: seatOf.get(c.playerId) ?? 0, card: c.card })),
    firstPlayer: room.firstPlayer,
    played: roundLog.map((e) => e.card),
    voids
  };
}

/**
 * Guesses the hidden hands: deals every card the bot hasn't seen to the other seats,
 * matching their hand sizes and (where possible) the suits they're known to be out of.
 */
export function sampleHands(view: BotView, rng: Rng): Card[][] {
  const seen = new Set([...view.hand, ...view.played].map(cardKey));
  const unseen = fullDeck().filter((c) => !seen.has(cardKey(c)));
  const others = Array.from({ length: view.numPlayers }, (_, s) => s).filter((s) => s !== view.seat);

  for (let attempt = 0; attempt < 30; attempt++) {
    const respectVoids = attempt < 25;
    const hands = dealOnce(view, others, shuffleInPlace(unseen.slice(), rng), respectVoids, rng);
    if (hands) return hands;
  }
  throw new Error('Could not deal hidden hands');
}

function dealOnce(view: BotView, others: number[], cards: Card[], respectVoids: boolean, rng: Rng): Card[][] | null {
  // Cards nobody was dealt (most of the deck with few players) go to an extra "stock" pile,
  // so which cards are in play at all is guessed fairly too.
  const stock = view.numPlayers;
  const hands: Card[][] = Array.from({ length: view.numPlayers + 1 }, () => []);
  hands[view.seat] = view.hand.slice();
  const needed = others.reduce((sum, s) => sum + view.handSizes[s], 0);
  const capacity = [...view.handSizes, cards.length - needed];
  const room = (s: number) => capacity[s] - hands[s].length;
  const takers = [...others, stock];
  const isVoid = (s: number, suit: string) => s !== stock && respectVoids && view.voids[s].has(suit);
  // Deal the most restricted cards first so voids are less likely to paint us into a corner.
  const eligible = (c: Card) => takers.filter((s) => room(s) > 0 && !isVoid(s, c.suit));
  const order = cards.slice().sort((a, b) => eligibleCount(view, others, a) - eligibleCount(view, others, b));
  for (const card of order) {
    const seats = eligible(card);
    if (!seats.length) return null;
    // Weight by space left so hands fill evenly.
    const total = seats.reduce((sum, s) => sum + room(s), 0);
    let pick = rng() * total;
    let chosen = seats[seats.length - 1];
    for (const s of seats) {
      pick -= room(s);
      if (pick < 0) {
        chosen = s;
        break;
      }
    }
    hands[chosen].push(card);
  }
  if (!others.every((s) => hands[s].length === view.handSizes[s])) return null;
  hands.pop(); // drop the stock
  return hands;
}

function eligibleCount(view: BotView, others: number[], card: Card): number {
  return others.filter((s) => !view.voids[s].has(card.suit)).length;
}

/**
 * A complete position to simulate from: the bot's view plus one guess of the hidden hands.
 * `next` is the seat to play: the bot itself mid-round, or the first player when bidding.
 */
export function simStateFrom(view: BotView, hands: Card[][], targets: number[], next: number): SimState {
  return { hands, tricksWon: view.tricksWon.slice(), targets, trick: view.trick.slice(), next };
}
