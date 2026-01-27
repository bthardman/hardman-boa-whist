// Game logic and rules
import type { OwnedCard, Player, Card } from '../../shared/types';
import { cardValue } from './cardUtils';

export function calculateTrickWinner(trick: OwnedCard[], players: Player[]): number {
  if (!trick.length) return -1;
  
  const suitLed = trick[0].card.suit;
  let winning = trick[0];

  trick.forEach((played) => {
    if (
      // hearts trump anything not hearts
      (played.card.suit === 'hearts' && winning.card.suit !== 'hearts') ||
      // higher trump beats lower trump
      (played.card.suit === 'hearts' && winning.card.suit === 'hearts' &&
        cardValue(played.card.value) > cardValue(winning.card.value)) ||
      // higher card of led suit
      (played.card.suit === suitLed && winning.card.suit === suitLed &&
        cardValue(played.card.value) > cardValue(winning.card.value))
    ) {
      winning = played;
    }
  });

  return players.findIndex(p => p.playerId === winning.playerId);
}

export function canPlayCard(
  card: OwnedCard,
  playerHand: OwnedCard[],
  currentTrick: OwnedCard[]
): boolean {
  // First card of trick - can play anything
  if (!currentTrick.length) return true;
  
  // Must follow suit if possible
  const suitLed = currentTrick[0].card.suit;
  const hasSuit = playerHand.some(c => c.card.suit === suitLed);
  
  if (hasSuit) {
    return card.card.suit === suitLed;
  }
  
  // Can play any card if don't have led suit
  return true;
}

export function dealCards(deck: Card[], players: Player[], handSize: number): void {
  const numPlayers = players.length;
  for (let i = 0; i < numPlayers; i++) {
    players[i].hand = [];
    for (let j = 0; j < handSize; j++) {
      const card = deck[i * handSize + j];
      const ownedCard = { card, playerId: players[i].playerId };
      players[i].hand.push(ownedCard);
    }
    players[i].tricksWon = 0;
    players[i].bid = undefined;
  }
}
