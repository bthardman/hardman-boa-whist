import { describe, expect, it } from 'vitest';
import type { Card, GameState, Player } from '../../shared/types.ts';
import { AvatarChoice } from '../../shared/types.ts';
import { canPlayCard } from '../utils/gameLogic.ts';
import { buildBotView, sampleHands, type BotView } from './botView.ts';
import { lowestLegal, playRound } from './selfplay.ts';
import { easy, hard, medium, ruleOfThumb } from './strategies.ts';
import { cardKey, makeRng } from './simulate.ts';

const owned = (cards: Card[], playerId: string) => cards.map((card) => ({ card, playerId }));

describe('computer player decisions', () => {
  it('only ever bids allowed numbers and plays legal cards', () => {
    const rng = makeRng(7);
    let decisions = 0;
    for (let round = 0; round < 60; round++) {
      const players = 2 + (round % 6);
      const strategies = Array.from({ length: players }, (_, i) => [hard(25), medium, easy, lowestLegal][(round + i) % 4]);
      playRound(strategies, rng, round % players, (view, kind, choice, forbidden) => {
        decisions++;
        if (kind === 'bid') {
          expect(choice).toBeGreaterThanOrEqual(0);
          expect(choice).toBeLessThanOrEqual(7);
          expect(choice).not.toBe(forbidden);
          return;
        }
        const card = choice as Card;
        const hand = owned(view.hand, 'me');
        expect(view.hand.some((c) => c.id === card.id)).toBe(true);
        expect(canPlayCard({ card, playerId: 'me' }, hand, owned(view.trick.map((t) => t.card), 'x'))).toBe(true);
      });
    }
    expect(decisions).toBeGreaterThan(1000);
  });

  it('beats the old lowest-legal autoplay at hitting its bid', async () => {
    const { hitRate } = await import('./selfplay.ts');
    const strong = hitRate(hard(40), ruleOfThumb, 4, 80, 3);
    const weak = hitRate(lowestLegal, ruleOfThumb, 4, 80, 3);
    expect(strong).toBeGreaterThan(weak + 0.2);
  });

  it('gets stronger from easy to medium to hard', async () => {
    const { hitRate } = await import('./selfplay.ts');
    const rate = (s: Parameters<typeof hitRate>[0]) => hitRate(s, ruleOfThumb, 4, 150, 5);
    const [e, m, h] = [rate(easy), rate(medium), rate(hard(60))];
    expect(m).toBeGreaterThan(e);
    expect(h).toBeGreaterThan(m);
  });
});

describe('guessing hidden hands', () => {
  const view = (overrides: Partial<BotView>): BotView => ({
    seat: 0,
    numPlayers: 3,
    hand: [],
    bids: [1, 1, 1],
    tricksWon: [0, 0, 0],
    handSizes: [0, 5, 5],
    trick: [],
    firstPlayer: 0,
    played: [],
    voids: [new Set(), new Set(), new Set()],
    ...overrides
  });

  it('matches hand sizes, never re-deals seen cards, and respects known voids', () => {
    const rng = makeRng(11);
    const played: Card[] = [{ suit: 'spades', value: 'A', id: 'p1' }];
    const v = view({ played, voids: [new Set(), new Set(['hearts', 'spades']), new Set()] });
    for (let i = 0; i < 200; i++) {
      const hands = sampleHands(v, rng);
      expect(hands[1]).toHaveLength(5);
      expect(hands[2]).toHaveLength(5);
      expect(hands[1].some((c) => c.suit === 'hearts' || c.suit === 'spades')).toBe(false);
      const keys = hands.flat().map(cardKey);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).not.toContain(cardKey(played[0]));
    }
  });
});

describe('bot view', () => {
  it("never includes another player's cards", () => {
    const card = (value: string, suit: string, id: string): Card => ({ value, suit, id });
    const player = (id: string, cards: Card[]): Player => ({
      playerId: id,
      selectedAvatar: AvatarChoice.UNDEFINED,
      hand: owned(cards, id),
      tricksWon: 0,
      isBot: id !== 'human'
    });
    const secret = card('A', 'hearts', 's1');
    const room: GameState = {
      roomId: 'r',
      players: [player('bot', [card('2', 'clubs', 'b1')]), player('human', [secret])],
      currentPlayer: 0,
      firstPlayer: 0,
      currentTrick: [],
      state: 'tricks',
      scoreboard: {},
      roundNumber: 1
    };
    const v = buildBotView(room, 0, []);
    expect(JSON.stringify({ ...v, voids: [] })).not.toContain('s1');
    expect(v.handSizes).toEqual([1, 1]);
  });
});
