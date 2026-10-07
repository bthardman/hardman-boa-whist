// Computer player decisions, by Monte Carlo search: guess the hidden hands many times,
// play each option out to the end of the round, and pick the option that most often
// lands exactly on the bid (the only thing that scores).
import type { Card } from '../../shared/types.ts';
import { type BotView, sampleHands, simStateFrom } from './botView.ts';
import { estimateTricks, heuristicPolicy } from './heuristic.ts';
import { applyCard, legalCards, playOut, type Rng } from './simulate.ts';

export type SearchOptions = {
  rng: Rng;
  /** Upper bound on guessed deals. */
  maxSamples?: number;
  /** Stop sampling after this long (always at least `minSamples`). */
  timeBudgetMs?: number;
  minSamples?: number;
};

const DEFAULTS = { maxSamples: 400, timeBudgetMs: 150, minSamples: 40 };

/** Hitting the bid scores; otherwise being closer is slightly better (a tie-breaker only). */
function outcome(won: number, target: number): number {
  return won === target ? 1 : -0.01 * Math.abs(won - target);
}

function runSamples(opts: SearchOptions, onSample: () => void): void {
  const { maxSamples, timeBudgetMs, minSamples } = { ...DEFAULTS, ...opts };
  const start = Date.now();
  for (let i = 0; i < maxSamples; i++) {
    if (i >= minSamples && Date.now() - start > timeBudgetMs) break;
    onSample();
  }
}

const cloneHands = (hands: Card[][]) => hands.map((h) => h.slice());

/** Chooses which card to play. Always returns a legal card. */
export function decidePlay(view: BotView, opts: SearchOptions): Card {
  const legal = legalCards(view.hand, view.trick);
  if (legal.length === 1) return legal[0];

  const targets = view.bids.map((b) => b ?? 0);
  const scores = legal.map(() => 0);
  runSamples(opts, () => {
    const hands = sampleHands(view, opts.rng);
    legal.forEach((card, i) => {
      const s = simStateFrom(view, cloneHands(hands), targets, view.seat);
      applyCard(s, card);
      playOut(s, heuristicPolicy);
      scores[i] += outcome(s.tricksWon[view.seat], targets[view.seat]);
    });
  });

  // Among equally good cards, prefer what the rule-of-thumb player would do.
  const best = Math.max(...scores);
  const top = legal.filter((_, i) => scores[i] >= best - 1e-9);
  if (top.length === 1) return top[0];
  // The heuristic chooses among the top cards only, as if they were the bot's whole hand.
  const hands: Card[][] = Array.from({ length: view.numPlayers }, () => []);
  hands[view.seat] = top;
  return heuristicPolicy({ hands, tricksWon: view.tricksWon, targets, trick: view.trick, next: view.seat }, view.seat);
}

/** Chooses a bid. `forbidden` is the one number the last bidder may not pick (or null). */
export function decideBid(view: BotView, forbidden: number | null, opts: SearchOptions): number {
  const candidates = Array.from({ length: view.hand.length + 1 }, (_, b) => b).filter((b) => b !== forbidden);
  const hits = candidates.map(() => 0);
  runSamples(opts, () => {
    const hands = sampleHands(view, opts.rng);
    // Players yet to bid will probably bid what their (guessed) hand is worth.
    const targets = view.bids.map((b, s) => b ?? estimateTricks(hands[s], view.numPlayers));
    candidates.forEach((bid, i) => {
      const t = targets.slice();
      t[view.seat] = bid;
      const s = simStateFrom(view, cloneHands(hands), t, view.firstPlayer);
      playOut(s, heuristicPolicy);
      if (s.tricksWon[view.seat] === bid) hits[i]++;
    });
  });

  // Ties go to the bid closest to the hand's rough value.
  const guess = estimateTricks(view.hand, view.numPlayers);
  let bestIdx = 0;
  candidates.forEach((bid, i) => {
    const better = hits[i] > hits[bestIdx];
    const tie = hits[i] === hits[bestIdx] && Math.abs(bid - guess) < Math.abs(candidates[bestIdx] - guess);
    if (better || tie) bestIdx = i;
  });
  return candidates[bestIdx];
}
