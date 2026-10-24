import { describe, expect, it } from 'vitest';
import type { Card, GameState, OwnedCard, Player } from '../../shared/types.ts';
import { AvatarChoice } from '../../shared/types.ts';
import { getForbiddenBid, isValidBid } from './biddingRules.ts';
import { calculateTrickWinner, canPlayCard } from './gameLogic.ts';
import { calculateRoundScores, checkGameEnd, findGameWinner, updateTotalScores } from './scoreCalculator.ts';

const card = (value: string, suit: string): Card => ({ value, suit, id: `${value}${suit}` });
const owned = (playerId: string, value: string, suit: string): OwnedCard => ({ card: card(value, suit), playerId });
const player = (playerId: string, bid?: number, tricksWon = 0): Player => ({
  playerId,
  selectedAvatar: AvatarChoice.BRAD,
  hand: [],
  tricksWon,
  bid
});
const room = (players: Player[], scoreboard: Record<number, number> = {}, winningScore = 5): GameState => ({
  roomId: 'test',
  players,
  currentPlayer: 0,
  firstPlayer: 0,
  currentTrick: [],
  state: 'bidding',
  scoreboard,
  roundNumber: 1,
  winningScore
});

describe('bidding', () => {
  it("won't let the last bidder make the total exactly 7", () => {
    const r = room([player('a', 3), player('b', 2), player('c')]);
    expect(isValidBid(r, 2, 2).valid).toBe(false);
    expect(isValidBid(r, 2, 1).valid).toBe(true);
    expect(isValidBid(r, 2, 3).valid).toBe(true);
    expect(getForbiddenBid(r.players)).toBe(2);
  });

  it('lets earlier bidders bid anything from 0 to 7', () => {
    const r = room([player('a', 5), player('b'), player('c')]);
    expect(isValidBid(r, 1, 2).valid).toBe(true); // 5 + 2 = 7 is fine before the last bidder
    expect(isValidBid(r, 1, 0).valid).toBe(true);
    expect(isValidBid(r, 1, 8).valid).toBe(false);
    expect(isValidBid(r, 1, -1).valid).toBe(false);
  });

  it('has no forbidden bid once the others already total more than 7', () => {
    expect(getForbiddenBid([player('a', 5), player('b', 4), player('c')])).toBeNull();
  });
});

describe('tricks', () => {
  const players = [player('a'), player('b'), player('c')];

  it('goes to the highest card of the suit led', () => {
    const trick = [owned('a', '9', 'clubs'), owned('b', 'K', 'clubs'), owned('c', 'A', 'spades')];
    expect(calculateTrickWinner(trick, players)).toBe(1); // the ace of spades is off-suit
  });

  it('goes to a heart (always trumps) over the suit led', () => {
    const trick = [owned('a', 'A', 'clubs'), owned('b', '2', 'hearts'), owned('c', 'K', 'clubs')];
    expect(calculateTrickWinner(trick, players)).toBe(1);
  });

  it('goes to the highest heart when several are played', () => {
    const trick = [owned('a', '5', 'diamonds'), owned('b', '9', 'hearts'), owned('c', 'J', 'hearts')];
    expect(calculateTrickWinner(trick, players)).toBe(2);
  });

  it('makes you follow suit if you can, and lets you play anything if you cannot', () => {
    const trick = [owned('a', '9', 'clubs')];
    const hand = [owned('b', '2', 'clubs'), owned('b', 'A', 'hearts')];
    expect(canPlayCard(hand[0], hand, trick)).toBe(true);
    expect(canPlayCard(hand[1], hand, trick)).toBe(false);
    const voidHand = [owned('c', 'A', 'hearts'), owned('c', '3', 'spades')];
    expect(canPlayCard(voidHand[0], voidHand, trick)).toBe(true);
    expect(canPlayCard(voidHand[1], voidHand, [])).toBe(true); // leading: anything goes
  });
});

describe('scoring', () => {
  it('gives a point only for hitting your bid exactly', () => {
    const r = room([player('a', 2, 2), player('b', 0, 1), player('c', 3, 2)]);
    expect(calculateRoundScores(r)).toEqual({ 0: 1, 1: 0, 2: 0 });
    updateTotalScores(r, calculateRoundScores(r));
    updateTotalScores(r, { 0: 1, 1: 1, 2: 0 });
    expect(r.scoreboard).toEqual({ 0: 2, 1: 1, 2: 0 });
  });

  it('ends the game when one player reaches the target', () => {
    const r = room([player('a'), player('b')], { 0: 5, 1: 3 });
    expect(checkGameEnd(r)).toBe(true);
    expect(findGameWinner(r)?.playerId).toBe('a');
  });

  it('plays on while players are tied at or above the target, until one is ahead', () => {
    const tied = room([player('a'), player('b'), player('c')], { 0: 5, 1: 5, 2: 2 });
    expect(checkGameEnd(tied)).toBe(false);
    expect(findGameWinner(tied)).toBeUndefined();
    const ahead = room([player('a'), player('b'), player('c')], { 0: 6, 1: 5, 2: 2 });
    expect(checkGameEnd(ahead)).toBe(true);
    expect(findGameWinner(ahead)?.playerId).toBe('a');
  });

  it('respects a lower points-to-win setting', () => {
    expect(checkGameEnd(room([player('a'), player('b')], { 0: 1, 1: 0 }, 1))).toBe(true);
    expect(checkGameEnd(room([player('a'), player('b')], { 0: 1, 1: 0 }, 2))).toBe(false);
  });
});
