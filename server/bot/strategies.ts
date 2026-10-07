// The three computer-player difficulty levels. They all see exactly the same thing
// (their own hand plus what's been played in public); only the thinking differs.
import type { BotDifficulty, Card } from '../../shared/types.ts';
import type { BotView } from './botView.ts';
import { decideBid, decidePlay } from './decide.ts';
import { estimateTricks, heuristicPolicy } from './heuristic.ts';
import { legalCards, type Rng } from './simulate.ts';

export type Strategy = {
  name: string;
  bid: (view: BotView, forbidden: number | null, rng: Rng) => number;
  play: (view: BotView, rng: Rng) => Card;
};

/** Nudges a bid off the forbidden number (towards the hand's value where possible). */
export function allowedBid(bid: number, forbidden: number | null, maxBid = 7): number {
  const b = Math.max(0, Math.min(maxBid, bid));
  if (b !== forbidden) return b;
  return b === 0 ? 1 : b - 1;
}

function heuristicCard(view: BotView): Card {
  const hands: Card[][] = Array.from({ length: view.numPlayers }, () => []);
  hands[view.seat] = view.hand;
  const targets = view.bids.map((b) => b ?? 0);
  return heuristicPolicy({ hands, tricksWon: view.tricksWon, targets, trick: view.trick, next: view.seat }, view.seat);
}

/** Rule-of-thumb bidding and play, with no look-ahead. (Used inside the searches and as a baseline.) */
export const ruleOfThumb: Strategy = {
  name: 'rule-of-thumb',
  bid: (view, forbidden) => allowedBid(estimateTricks(view.hand, view.numPlayers), forbidden, view.hand.length),
  play: (view) => heuristicCard(view)
};

/** Easy: rules of thumb, but it misjudges bids and plays a loose card now and then. */
export const easy: Strategy = {
  name: 'easy',
  bid: (view, forbidden, rng) => {
    const guess = estimateTricks(view.hand, view.numPlayers);
    const slip = rng() < 0.6 ? (rng() < 0.5 ? -1 : 1) : 0;
    return allowedBid(guess + slip, forbidden, view.hand.length);
  },
  play: (view, rng) => {
    const legal = legalCards(view.hand, view.trick);
    return rng() < 0.4 ? legal[Math.floor(rng() * legal.length)] : heuristicCard(view);
  }
};

/**
 * Monte Carlo search over guesses of the hidden hands. Without `samples` it keeps guessing
 * until the time budget runs out; with `samples` the amount of work is fixed (for tests).
 */
export function search(name: string, samples?: number, timeBudgetMs = 150): Strategy {
  const opts = (rng: Rng) =>
    samples ? { rng, maxSamples: samples, minSamples: samples, timeBudgetMs: 1e9 } : { rng, timeBudgetMs };
  return {
    name,
    bid: (view, forbidden, rng) => decideBid(view, forbidden, opts(rng)),
    play: (view, rng) => decidePlay(view, opts(rng))
  };
}

/** Medium: a quick look ahead over a couple of guesses (enough to bid sensibly, not to plan precisely). */
export const medium = search('medium', 2);

/** Hard: a thorough look ahead (up to ~400 guesses per decision). `samples` fixes the work for tests. */
export const hard = (samples?: number) => search(samples ? `hard(${samples})` : 'hard', samples);

export function strategyFor(difficulty: BotDifficulty | undefined): Strategy {
  if (difficulty === 'easy') return easy;
  if (difficulty === 'hard') return hard();
  return medium;
}
