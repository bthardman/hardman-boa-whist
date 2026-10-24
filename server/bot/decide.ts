// Computer player decisions, by Monte Carlo search: guess the hidden hands many times,
// play each option out to the end of the round, and pick the option that most often
// lands exactly on the bid (the only thing that scores).
import type { Card } from '../../shared/types.ts';
import { type BotView, sampleHands, simStateFrom } from './botView.ts';
import { heuristicPolicy } from './heuristic.ts';
import { applyCard, legalCards, playOut, type Policy, type Rng } from './simulate.ts';

export type SearchOptions = {
  rng: Rng;
  /** Upper bound on guessed deals. */
  maxSamples?: number;
  /** Stop sampling after this long (always at least `minSamples`). */
  timeBudgetMs?: number;
  minSamples?: number;
  /** How everyone plays in the simulated futures (default: the rule-of-thumb player). */
  policy?: Policy;
  /** Once its own bid is out of reach, play to make other players miss theirs instead. */
  spoil?: boolean;
  /**
   * How strongly bids are pulled towards what the hand is worth (smaller = stronger pull).
   * The simulated players are better at ducking than at winning exactly the right number of
   * tricks, so without this, low bids look safer than they really are against people.
   */
  bidSpread?: number;
};

const DEFAULTS = { maxSamples: 400, timeBudgetMs: 150, minSamples: 40 };
const TRICKS_PER_ROUND = 7;

/** Hitting the bid scores; otherwise being closer is slightly better (a tie-breaker only). */
function outcome(won: number, target: number): number {
  return won === target ? 1 : -0.01 * Math.abs(won - target);
}

function runSamples(opts: SearchOptions, onSample: () => void): void {
  const { maxSamples, timeBudgetMs, minSamples } = { ...DEFAULTS, ...opts };
  const start = Date.now();
  for (let i = 0; i < maxSamples; i++) {
    if (i >= Math.min(minSamples, maxSamples) && Date.now() - start > timeBudgetMs) break;
    onSample();
  }
}

const cloneHands = (hands: Card[][]) => hands.map((h) => h.slice());

/** Nudges a bid off the forbidden number (towards the hand's value where possible). */
export function allowedBid(bid: number, forbidden: number | null, maxBid = TRICKS_PER_ROUND): number {
  const b = Math.max(0, Math.min(maxBid, Math.round(bid)));
  if (b !== forbidden) return b;
  return b === 0 ? 1 : b - 1;
}

/**
 * Each seat's "natural" tricks for one guessed deal: what they take when everyone simply plays
 * to win every trick. They always add up to the tricks being played, so a guess of what
 * everyone will bid built from them respects the table total of 7.
 */
function naturalTricks(view: BotView, hands: Card[][]): number[] {
  const s = simStateFrom(view, cloneHands(hands), view.bids.map(() => TRICKS_PER_ROUND), view.firstPlayer);
  playOut(s, heuristicPolicy);
  return s.tricksWon;
}

/** Roughly how many tricks the bot's own hand is worth, averaged over `samples` guessed deals. */
export function handWorth(view: BotView, rng: Rng, samples: number): number {
  let total = 0;
  for (let i = 0; i < samples; i++) total += naturalTricks(view, sampleHands(view, rng))[view.seat];
  return total / samples;
}

/** Chooses which card to play. Always returns a legal card. */
export function decidePlay(view: BotView, opts: SearchOptions): Card {
  const legal = legalCards(view.hand, view.trick);
  if (legal.length === 1) return legal[0];

  const policy = opts.policy ?? heuristicPolicy;
  const targets = view.bids.map((b) => b ?? 0);
  const need = targets[view.seat] - view.tricksWon[view.seat];
  const spoiling = !!opts.spoil && (need < 0 || need > view.hand.length);
  const others = targets.map((_, s) => s).filter((s) => s !== view.seat);

  const scores = legal.map(() => 0);
  runSamples(opts, () => {
    const hands = sampleHands(view, opts.rng);
    legal.forEach((card, i) => {
      const s = simStateFrom(view, cloneHands(hands), targets, view.seat);
      applyCard(s, card);
      playOut(s, policy);
      scores[i] += spoiling
        ? -others.filter((o) => s.tricksWon[o] === targets[o]).length // fewer others hitting = better
        : outcome(s.tricksWon[view.seat], targets[view.seat]);
    });
  });

  // Among equally good cards, prefer what the rule-of-thumb player would do. It sees the bot's
  // whole hand (so it judges correctly whether the bid is still makeable); if it would pick a
  // card outside the tied set, just take the first tied card.
  const best = Math.max(...scores);
  const top = legal.filter((_, i) => scores[i] >= best - 1e-9);
  if (top.length === 1) return top[0];
  const hands: Card[][] = Array.from({ length: view.numPlayers }, () => []);
  hands[view.seat] = view.hand;
  const preferred = policy({ hands, tricksWon: view.tricksWon, targets, trick: view.trick, next: view.seat }, view.seat);
  return top.find((c) => c.id === preferred.id) ?? top[0];
}

/** Chooses a bid. `forbidden` is the one number the last bidder may not pick (or null). */
export function decideBid(view: BotView, forbidden: number | null, opts: SearchOptions): number {
  const policy = opts.policy ?? heuristicPolicy;
  const n = view.numPlayers;
  const lastBidder = (view.firstPlayer + n - 1) % n;
  const candidates = Array.from({ length: view.hand.length + 1 }, (_, b) => b).filter((b) => b !== forbidden);
  const hits = candidates.map(() => 0);
  let ownWorth = 0;
  let samples = 0;

  runSamples(opts, () => {
    const hands = sampleHands(view, opts.rng);
    const natural = naturalTricks(view, hands);
    ownWorth += natural[view.seat];
    samples++;
    // Bids already made are taken at face value; players yet to bid will bid what their hand is worth.
    const targets = view.bids.map((b, s) => b ?? natural[s]);
    candidates.forEach((bid, i) => {
      const t = targets.slice();
      t[view.seat] = bid;
      // Whoever bids last can't make the total exactly 7 either.
      if (lastBidder !== view.seat && view.bids[lastBidder] === undefined) {
        const othersTotal = t.reduce((sum, v, s) => (s === lastBidder ? sum : sum + v), 0);
        t[lastBidder] = allowedBid(t[lastBidder], TRICKS_PER_ROUND - othersTotal);
      }
      const s = simStateFrom(view, cloneHands(hands), t, view.firstPlayer);
      playOut(s, policy);
      if (s.tricksWon[view.seat] === bid) hits[i]++;
    });
  });

  // How often each bid came off, weighted towards what the hand is worth (which also breaks ties).
  const worth = samples ? ownWorth / samples : 0;
  const spread = opts.bidSpread ?? Infinity;
  const score = (bid: number, i: number) =>
    (hits[i] + 1e-6) * Math.exp(-((bid - worth) ** 2) / (2 * spread * spread)) - 1e-9 * Math.abs(bid - worth);
  let bestIdx = 0;
  candidates.forEach((bid, i) => {
    if (score(bid, i) > score(candidates[bestIdx], bestIdx)) bestIdx = i;
  });
  return candidates[bestIdx];
}
