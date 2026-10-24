// The three computer-player difficulty levels. They all see exactly the same thing
// (their own hand plus what's been played in public); only the thinking differs.
import type { BotDifficulty, Card } from '../../shared/types.ts';
import type { BotView } from './botView.ts';
import { allowedBid, decideBid, decidePlay, handWorth, type SearchOptions } from './decide.ts';
import { heuristicPolicy, sharpPolicy } from './heuristic.ts';
import { legalCards, type Policy, type Rng } from './simulate.ts';

export { allowedBid } from './decide.ts';

export type Strategy = {
  name: string;
  bid: (view: BotView, forbidden: number | null, rng: Rng) => number;
  play: (view: BotView, rng: Rng) => Card;
};

/** Lets a play policy pick a card using only the bot's own hand (no peeking). */
function policyCard(view: BotView, policy: Policy): Card {
  const hands: Card[][] = Array.from({ length: view.numPlayers }, () => []);
  hands[view.seat] = view.hand;
  const targets = view.bids.map((b) => b ?? 0);
  return policy({ hands, tricksWon: view.tricksWon, targets, trick: view.trick, next: view.seat }, view.seat);
}

/** Rule-of-thumb play with a rough idea of what the hand is worth. (A baseline for testing.) */
export const ruleOfThumb: Strategy = {
  name: 'rule-of-thumb',
  bid: (view, forbidden, rng) => allowedBid(handWorth(view, rng, 4), forbidden, view.hand.length),
  play: (view) => policyCard(view, heuristicPolicy)
};

/**
 * A sensible human stand-in for testing: bids what the hand is worth and plays sharply
 * (including sliding tricks onto players who can't take any more).
 */
export const naturalBidder: Strategy = {
  name: 'natural bidder',
  bid: (view, forbidden, rng) => allowedBid(handWorth(view, rng, 30), forbidden, view.hand.length),
  play: (view) => policyCard(view, sharpPolicy)
};

/** Easy: rules of thumb, but it misjudges bids and plays a loose card now and then. */
export const easy: Strategy = {
  name: 'easy',
  bid: (view, forbidden, rng) => {
    const slip = rng() < 0.6 ? (rng() < 0.5 ? -1 : 1) : 0;
    return allowedBid(handWorth(view, rng, 4) + slip, forbidden, view.hand.length);
  },
  play: (view, rng) => {
    const legal = legalCards(view.hand, view.trick);
    return rng() < 0.4 ? legal[Math.floor(rng() * legal.length)] : policyCard(view, heuristicPolicy);
  }
};

type SearchSettings = {
  /** Fixes the number of guessed deals (for tests); otherwise it's time-boxed. */
  samples?: number;
  playBudgetMs?: number;
  bidBudgetMs?: number;
  bidMaxSamples?: number;
  policy?: Policy;
  spoil?: boolean;
  /** Pull towards bidding what the hand is worth (see SearchOptions.bidSpread). */
  bidSpread?: number;
};

/**
 * Monte Carlo search over guesses of the hidden hands. Without `samples` it keeps guessing
 * until the time budget runs out; with `samples` the amount of work is fixed (for tests).
 */
export function search(name: string, settings: SearchSettings = {}): Strategy {
  const { samples, playBudgetMs = 150, bidBudgetMs = 150, bidMaxSamples = 400, policy, spoil, bidSpread = 1.5 } = settings;
  const opts = (rng: Rng, budget: number, max: number): SearchOptions =>
    samples
      ? { rng, maxSamples: samples, minSamples: samples, timeBudgetMs: 1e9, policy, spoil, bidSpread }
      : { rng, timeBudgetMs: budget, maxSamples: max, policy, spoil, bidSpread };
  return {
    name,
    bid: (view, forbidden, rng) => decideBid(view, forbidden, opts(rng, bidBudgetMs, bidMaxSamples)),
    play: (view, rng) => decidePlay(view, opts(rng, playBudgetMs, 400))
  };
}

/** Medium: a quick look ahead over a couple of guesses (enough to bid sensibly, not to plan precisely). */
export const medium = search('medium', { samples: 2 });

/**
 * Hard: a thorough look ahead that expects sharp opponents, and spoils other players' bids
 * once its own is out of reach. `samples` fixes the work for tests.
 */
export const hard = (samples?: number) =>
  search(samples ? `hard(${samples})` : 'hard', {
    samples,
    policy: sharpPolicy,
    spoil: true,
    bidBudgetMs: 300,
    bidMaxSamples: 600
  });

export function strategyFor(difficulty: BotDifficulty | undefined): Strategy {
  if (difficulty === 'easy') return easy;
  if (difficulty === 'hard') return hard();
  return medium;
}
