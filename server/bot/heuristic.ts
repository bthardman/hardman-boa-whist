// A quick rule-of-thumb player. Used to play out the simulated futures inside the
// search (it must be fast), and as a fallback if the search can't run.
import type { Card } from '../../shared/types.ts';
import { cardValue } from '../utils/cardUtils.ts';
import { TRUMP, beats, legalCards, winningIndex, type SimState } from './simulate.ts';

/** How strong a card is to hold: trumps outrank every plain card. */
export function strength(card: Card): number {
  return cardValue(card.value) + (card.suit === TRUMP ? 13 : 0);
}

const lowest = (cards: Card[]) => cards.reduce((a, b) => (strength(b) < strength(a) ? b : a));
const highest = (cards: Card[]) => cards.reduce((a, b) => (strength(b) > strength(a) ? b : a));

/**
 * Wants more tricks: win as cheaply as possible (or lead winners).
 * Has enough: play under the winning card, dumping high cards while it's safe.
 */
export function heuristicPolicy(s: SimState, seat: number): Card {
  const hand = s.hands[seat];
  const legal = legalCards(hand, s.trick);
  if (legal.length === 1) return legal[0];
  const wantMore = s.tricksWon[seat] < s.targets[seat];

  // Leading.
  if (!s.trick.length) {
    if (wantMore) {
      const aces = legal.filter((c) => c.value === 'A' && c.suit !== TRUMP);
      if (aces.length) return aces[0];
      const trumps = legal.filter((c) => c.suit === TRUMP);
      const need = s.targets[seat] - s.tricksWon[seat];
      if (trumps.length && trumps.length >= need) return highest(trumps);
      return highest(legal);
    }
    // Lead low from the longest plain suit, so we're less likely to be left holding it.
    const plain = legal.filter((c) => c.suit !== TRUMP);
    return lowest(plain.length ? plain : legal);
  }

  const current = s.trick[winningIndex(s.trick)].card;
  const isLast = s.trick.length === s.hands.length - 1;
  const winners = legal.filter((c) => beats(c, current));
  const losers = legal.filter((c) => !beats(c, current));

  if (wantMore) {
    if (!winners.length) return lowest(legal);
    // Last to play: the cheapest winner is enough. Otherwise go high to hold the trick.
    if (isLast) return lowest(winners);
    const ledWinners = winners.filter((c) => c.suit === s.trick[0].card.suit);
    return ledWinners.length ? highest(ledWinners) : lowest(winners);
  }

  if (losers.length) return highest(losers);
  // Forced to go over: if nobody can overtake, win with the biggest card to get rid of it.
  return isLast ? highest(winners) : lowest(winners);
}

/** Rough number of tricks a hand should take, used to guess bids not yet made. */
export function estimateTricks(hand: Card[], numPlayers: number): number {
  const bySuit = new Map<string, Card[]>();
  for (const c of hand) bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c]);
  const trumps = bySuit.get(TRUMP) ?? [];
  let tricks = 0;
  for (const c of trumps) {
    const v = cardValue(c.value); // 12 = A
    tricks += v >= 12 ? 1 : v >= 11 ? 0.85 : v >= 10 ? 0.65 : v >= 9 ? 0.45 : 0.25;
  }
  for (const [suit, cards] of bySuit) {
    if (suit === TRUMP) continue;
    for (const c of cards) {
      const v = cardValue(c.value);
      if (v === 12) tricks += cards.length <= 4 ? 0.8 : 0.6;
      else if (v === 11 && cards.length >= 2 && cards.length <= 3) tricks += 0.4;
    }
  }
  // Short plain suits let spare trumps ruff.
  const plainSuitsHeld = [...bySuit.keys()].filter((s) => s !== TRUMP).length;
  tricks += Math.min(trumps.length, 3 - plainSuitsHeld) * 0.3;
  // More players means more competition for each trick.
  tricks *= numPlayers <= 2 ? 1.25 : numPlayers >= 5 ? 0.8 : 1;
  return Math.max(0, Math.min(7, Math.round(tricks)));
}
