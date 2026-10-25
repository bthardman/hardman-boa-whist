import { describe, expect, it } from 'vitest';
import type { GameState, OwnedCard, Player } from '../shared/types.ts';
import { AvatarChoice } from '../shared/types.ts';
import { badgesFor, BID_SLOTS, usualBid, type PersonStats } from '../shared/stats.ts';
import type { Ctx } from './context.ts';
import { emptyTally, tallyRound, tallyTrick, type SeatTally } from './stats.ts';

const seat = (playerId: string, bid: number, tricksWon = 0, cardsLeft = 3): Player => ({
  playerId,
  selectedAvatar: AvatarChoice.UNDEFINED,
  hand: Array.from({ length: cardsLeft }, (_, i) => ({ playerId, card: { suit: 'clubs', value: '2', id: `${playerId}-${i}` } })),
  tricksWon,
  bid
});
const play = (playerId: string, value: string, suit = 'spades'): OwnedCard => ({ playerId, card: { suit, value, id: `${suit}-${value}` } });

function table(players: Player[], completedTricks = 0) {
  const tallies: SeatTally[] = players.map(emptyTally);
  const room = {
    roomId: 'r',
    players,
    completedTricks: Array.from({ length: completedTricks }, () => ({ winnerId: 'x', cards: [] }))
  } as unknown as GameState;
  const ctx = { tallies: new Map([['r', tallies]]) } as unknown as Ctx;
  return { ctx, room, tallies };
}

describe('stats tallies', () => {
  it('gives a slider to everyone who went under or threw away after a low winning card', () => {
    const { ctx, room, tallies } = table([seat('a', 1), seat('b', 1), seat('c', 1), seat('d', 1)]);
    // a leads the 4, b plays the 6 (now winning), c ducks with the 3, d throws away a diamond.
    tallyTrick(ctx, room, [play('a', '4'), play('b', '6'), play('c', '3'), play('d', 'K', 'diamonds')], 1);
    expect(tallies.map((t) => t.sliders)).toEqual([0, 0, 1, 1]);
  });

  it("doesn't count a high winner, a low trump ruffing in, or a winner played last", () => {
    const high = table([seat('a', 1), seat('b', 1), seat('c', 1)]);
    tallyTrick(high.ctx, high.room, [play('a', '8'), play('b', '2'), play('c', '3')], 0);
    const ruff = table([seat('a', 1), seat('b', 1), seat('c', 1)]);
    tallyTrick(ruff.ctx, ruff.room, [play('a', '9'), play('b', '2', 'hearts'), play('c', '3')], 1);
    const last = table([seat('a', 1), seat('b', 1), seat('c', 1)]);
    tallyTrick(last.ctx, last.room, [play('a', '2'), play('b', '3'), play('c', '5')], 2);
    for (const t of [high, ruff, last]) expect(t.tallies.every((x) => x.sliders === 0)).toBe(true);
  });

  it('counts early tricks: reaching the bid within the first bid + 1 tricks', () => {
    // Bid 2, already won 1, this is trick 3: early. The same at trick 4 isn't.
    const early = table([seat('a', 2, 1), seat('b', 0)], 2);
    tallyTrick(early.ctx, early.room, [play('a', 'A'), play('b', '2')], 0);
    expect(early.tallies[0].earlyRounds).toBe(1);
    const late = table([seat('a', 2, 1), seat('b', 0)], 3);
    tallyTrick(late.ctx, late.room, [play('a', 'A'), play('b', '2')], 0);
    expect(late.tallies[0].earlyRounds).toBe(0);
  });

  it('counts a heart on the last trick that makes the bid exactly', () => {
    const made = table([seat('a', 3, 2, 0), seat('b', 1, 1, 0)], 6);
    tallyTrick(made.ctx, made.room, [play('b', 'K'), play('a', '2', 'hearts')], 0);
    expect(made.tallies[0].lastHearts).toBe(1);
    const over = table([seat('a', 2, 2, 0), seat('b', 1, 1, 0)], 6);
    tallyTrick(over.ctx, over.room, [play('b', 'K'), play('a', '2', 'hearts')], 0);
    expect(over.tallies[0].lastHearts).toBe(0);
  });

  it('counts each bid, and high bids for the table size', () => {
    const two = table([seat('a', 5, 5), seat('b', 1, 2)]);
    tallyRound(two.ctx, two.room);
    expect(two.tallies[0]).toMatchObject({ highBids: 1, roundsMade: 1 });
    expect(two.tallies[0].bidCounts[5]).toBe(1);
    expect(two.tallies[1].highBids).toBe(0);
    const five = table([seat('a', 3), seat('b', 1), seat('c', 1), seat('d', 1), seat('e', 0)]);
    tallyRound(five.ctx, five.room);
    expect(five.tallies[0].highBids).toBe(1); // 3 is high with five players
  });
});

describe('badges', () => {
  const stats = (extra: Partial<PersonStats>): PersonStats => ({
    games: 3,
    wins: 1,
    rounds: 20,
    roundsMade: 8,
    bidTotal: 30,
    zeroBids: 2,
    zeroBidsMade: 1,
    points: 8,
    bestStreak: 1,
    currentStreak: 0,
    sliders: 0,
    earlyRounds: 0,
    lastHearts: 0,
    highBids: 0,
    bidCounts: [2, 9, 6, 3, 0, 0, 0, 0],
    expected: { sliders: 4, earlyRounds: 4, lastHearts: 1, highBids: 3, zeroBids: 4 },
    ...extra
  });

  it('only shows the badges someone has earned, compared with their fair share', () => {
    expect(badgesFor(stats({}))).toEqual([]);
    const ids = badgesFor(stats({ sliders: 9, lastHearts: 3, highBids: 3 })).map((b) => b.id);
    expect(ids).toEqual(['slider', 'lastHeart']); // high bids are only at their fair share
  });

  it('needs a few rounds and more than a one-off', () => {
    expect(badgesFor(stats({ rounds: 6, sliders: 9 }))).toEqual([]);
    expect(badgesFor(stats({ sliders: 2, expected: { ...stats({}).expected, sliders: 0.5 } }))).toEqual([]);
  });

  it('finds the usual bid', () => {
    expect(usualBid(stats({}))).toBe(1);
    expect(usualBid(stats({ bidCounts: new Array(BID_SLOTS).fill(0) }))).toBeNull();
  });
});
