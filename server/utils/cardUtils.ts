// Card utility functions
import type { Card } from '../../shared/types';

export function createDeck(): Card[] {
  const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
  const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const deck: Card[] = [];
  let cardId = 1;
  
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value, id: String(cardId++) });
    }
  }
  
  return shuffleDeck(deck);
}

export function shuffleDeck<T>(deck: T[]): T[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function cardValue(v: string): number {
  const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  return order.indexOf(v);
}
