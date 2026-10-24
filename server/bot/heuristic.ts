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

/**
 * Where a player stands on their bid:
 * chase = still needs tricks and can get them, hold = has exactly enough (must lose the rest),
 * free = can no longer make it (over, or too few tricks left), so nothing to protect.
 */
export function bidMode(s: SimState, seat: number): 'chase' | 'hold' | 'free' {
  const need = s.targets[seat] - s.tricksWon[seat];
  if (need < 0 || need > s.hands[seat].length) return 'free';
  return need === 0 ? 'hold' : 'chase';
}

/**
 * A sharp player (used by Hard): plays for its own bid exactly like `heuristicPolicy`, but once
 * that bid is out of reach it spoils: it lets a player who must not win any more take the trick
 * (the "slide"), and takes tricks away from players still chasing theirs.
 */
export function sharpPolicy(s: SimState, seat: number): Card {
  if (bidMode(s, seat) !== 'free') return heuristicPolicy(s, seat);
  const legal = legalCards(s.hands[seat], s.trick);
  if (legal.length === 1) return legal[0];
  if (!s.trick.length) return lowest(legal);

  const current = s.trick[winningIndex(s.trick)];
  const winners = legal.filter((c) => beats(c, current.card));
  const losers = legal.filter((c) => !beats(c, current.card));
  const need = s.targets[current.seat] - s.tricksWon[current.seat];
  // Winning player must not take another: leave it with them.
  if (need === 0) return losers.length ? highest(losers) : lowest(winners);
  // Winning player still needs tricks: take it off them if we can.
  if (need > 0) return winners.length ? lowest(winners) : lowest(legal);
  return lowest(legal);
}
