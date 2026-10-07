// Fast whole-round simulation used by the computer players.
// Cards here are plain `Card`s; seats are player indexes.
import type { Card } from '../../shared/types.ts';
import { cardValue } from '../utils/cardUtils.ts';

export const TRUMP = 'hearts';
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export type Rng = () => number;

/** Small seeded PRNG (mulberry32) so tests and self-play are repeatable. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleInPlace<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  let id = 1;
  for (const suit of SUITS) for (const value of VALUES) deck.push({ suit, value, id: String(id++) });
  return deck;
}

export const cardKey = (c: Card): string => `${c.value}${c.suit}`;

export type PlayedCard = { seat: number; card: Card };

/** Everything needed to play out the rest of a round with every hand known (one guess of the hidden cards). */
export type SimState = {
  hands: Card[][];
  tricksWon: number[];
  /** What each seat is trying to win (its bid). */
  targets: number[];
  trick: PlayedCard[];
  /** Seat to play next. */
  next: number;
};

export type Policy = (state: SimState, seat: number) => Card;

/** Index within the trick of the card currently winning. Hearts are always trumps. */
export function winningIndex(trick: PlayedCard[]): number {
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, trick[best].card)) best = i;
  }
  return best;
}

/**
 * Does `card` beat the card currently winning the trick? The winner is always either
 * the led suit or a trump, so a different non-trump suit can never beat it.
 */
export function beats(card: Card, current: Card): boolean {
  if (card.suit === current.suit) return cardValue(card.value) > cardValue(current.value);
  return card.suit === TRUMP;
}

/** Cards that may legally be played: follow suit if you can. */
export function legalCards(hand: Card[], trick: PlayedCard[]): Card[] {
  if (!trick.length) return hand;
  const led = trick[0].card.suit;
  const following = hand.filter((c) => c.suit === led);
  return following.length ? following : hand;
}

export function cloneState(s: SimState): SimState {
  return {
    hands: s.hands.map((h) => h.slice()),
    tricksWon: s.tricksWon.slice(),
    targets: s.targets.slice(),
    trick: s.trick.slice(),
    next: s.next
  };
}

/** Plays `card` for the seat whose turn it is, resolving the trick when it completes. Mutates `s`. */
export function applyCard(s: SimState, card: Card): void {
  const seat = s.next;
  const hand = s.hands[seat];
  const at = hand.findIndex((c) => c.id === card.id);
  hand.splice(at, 1);
  s.trick.push({ seat, card });
  if (s.trick.length < s.hands.length) {
    s.next = (seat + 1) % s.hands.length;
    return;
  }
  const winner = s.trick[winningIndex(s.trick)].seat;
  s.tricksWon[winner]++;
  s.trick = [];
  s.next = winner;
}

/** Plays the round to the end with `policy` choosing every card. Mutates `s`. */
export function playOut(s: SimState, policy: Policy): void {
  while (s.hands[s.next].length > 0) applyCard(s, policy(s, s.next));
}
