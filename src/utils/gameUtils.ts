// Client-side game utilities (for display only, server is authoritative)
import type { OwnedCard } from '../../shared/types';

export function cardValue(v: string): number {
  const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  return order.indexOf(v);
}

export function calculateTrickWinner(trick: OwnedCard[]): number {
  if (!trick.length) return -1;
  
  const suitLed = trick[0].card.suit;
  let winningIndex = 0;
  let winningCard = trick[0];

  trick.forEach((played, index) => {
    if (
      // hearts trump anything not hearts
      (played.card.suit === 'hearts' && winningCard.card.suit !== 'hearts') ||
      // higher trump beats lower trump
      (played.card.suit === 'hearts' && winningCard.card.suit === 'hearts' &&
        cardValue(played.card.value) > cardValue(winningCard.card.value)) ||
      // higher card of led suit
      (played.card.suit === suitLed && winningCard.card.suit === suitLed &&
        cardValue(played.card.value) > cardValue(winningCard.card.value))
    ) {
      winningCard = played;
      winningIndex = index;
    }
  });

  return winningIndex;
}
