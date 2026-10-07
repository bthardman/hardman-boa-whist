// Plays whole rounds between different computer-player strategies, to check the bots stay
// legal and to measure how often each one hits its bid. Run: npx tsx server/bot/selfplay.ts
import type { Card } from '../../shared/types.ts';
import { cardValue } from '../utils/cardUtils.ts';
import type { BotView, RoundLogEntry } from './botView.ts';
import { applyCard, fullDeck, legalCards, makeRng, shuffleInPlace, type Rng, type SimState } from './simulate.ts';
import { allowedBid, easy, hard, medium, ruleOfThumb, type Strategy } from './strategies.ts';

/** What the server did for offline players before bots existed: lowest legal bid and card. */
export const lowestLegal: Strategy = {
  name: 'lowest-legal',
  bid: (_view, forbidden) => allowedBid(0, forbidden),
  play: (view) =>
    legalCards(view.hand, view.trick)
      .slice()
      .sort((a, b) => cardValue(a.value) - cardValue(b.value) || (a.suit === 'hearts' ? 1 : -1))[0]
};
export type RoundResult = { bids: number[]; tricksWon: number[]; hit: boolean[] };

/**
 * Plays one round. `check` is called with every decision so tests can assert legality.
 * Each seat only ever gets its own BotView, never the other hands.
 */
export function playRound(
  strategies: Strategy[],
  rng: Rng,
  firstPlayer = 0,
  check?: (view: BotView, kind: 'bid' | 'play', choice: number | Card, forbidden: number | null) => void
): RoundResult {
  const n = strategies.length;
  const deck = shuffleInPlace(fullDeck(), rng);
  const hands = Array.from({ length: n }, (_, s) => deck.slice(s * 7, s * 7 + 7));
  const bids: (number | undefined)[] = Array(n).fill(undefined);
  const log: RoundLogEntry[] = [];
  const s: SimState = { hands, tricksWon: Array(n).fill(0), targets: Array(n).fill(0), trick: [], next: firstPlayer };

  const viewFor = (seat: number): BotView => {
    const voids = Array.from({ length: n }, () => new Set<string>());
    for (const e of log) if (e.card.suit !== e.ledSuit) voids[e.seat].add(e.ledSuit);
    return {
      seat,
      numPlayers: n,
      hand: s.hands[seat].slice(),
      bids: bids.slice(),
      tricksWon: s.tricksWon.slice(),
      handSizes: s.hands.map((h) => h.length),
      trick: s.trick.slice(),
      firstPlayer,
      played: log.map((e) => e.card),
      voids
    };
  };

  for (let i = 0; i < n; i++) {
    const seat = (firstPlayer + i) % n;
    const total = bids.reduce<number>((sum, b) => sum + (b ?? 0), 0);
    const forbidden = i === n - 1 && 7 - total >= 0 ? 7 - total : null;
    const view = viewFor(seat);
    const bid = strategies[seat].bid(view, forbidden, rng);
    check?.(view, 'bid', bid, forbidden);
    bids[seat] = bid;
  }
  s.targets = bids.map((b) => b ?? 0);

  while (s.hands[s.next].length > 0) {
    const seat = s.next;
    const view = viewFor(seat);
    const card = strategies[seat].play(view, rng);
    check?.(view, 'play', card, null);
    const ledSuit = s.trick.length ? s.trick[0].card.suit : card.suit;
    log.push({ seat, card, ledSuit });
    applyCard(s, card);
  }

  const finalBids = s.targets;
  return { bids: finalBids, tricksWon: s.tricksWon, hit: finalBids.map((b, i) => b === s.tricksWon[i]) };
}

/** Hit rate of `test` sitting at seat 0 against `field` opponents, rotating the first player. */
export function hitRate(test: Strategy, field: Strategy, players: number, rounds: number, seed = 1): number {
  const rng = makeRng(seed);
  let hits = 0;
  for (let r = 0; r < rounds; r++) {
    const strategies = [test, ...Array(players - 1).fill(field)];
    if (playRound(strategies, rng, r % players).hit[0]) hits++;
  }
  return hits / rounds;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('server/bot/selfplay.ts')) {
  const rounds = Number(process.argv[2] ?? 400);
  const contenders = [lowestLegal, easy, medium, hard(120)];
  for (const players of [2, 4, 6]) {
    console.log(`\n${players} players, ${rounds} rounds, opponents = rule-of-thumb`);
    for (const c of contenders) {
      const started = Date.now();
      const rate = hitRate(c, ruleOfThumb, players, rounds);
      console.log(`  ${c.name.padEnd(16)} hits bid ${(rate * 100).toFixed(1)}%  (${Date.now() - started}ms)`);
    }
  }
}
