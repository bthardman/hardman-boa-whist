// Client-side game helpers (display only — the server is authoritative).
import type { GameState, OwnedCard, Player } from '../../shared/types';
export { isSeated } from '../../shared/players';

export const TRICKS_PER_ROUND = 7;
const VALUE_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export function cardValue(v: string): number {
  return VALUE_ORDER.indexOf(v);
}

/** Index (within the trick) of the card currently winning. Hearts are always trumps. */
export function calculateTrickWinner(trick: OwnedCard[]): number {
  if (!trick.length) return -1;
  const suitLed = trick[0].card.suit;
  let winningIndex = 0;
  let winningCard = trick[0];
  trick.forEach((played, index) => {
    const beats =
      (played.card.suit === 'hearts' && winningCard.card.suit !== 'hearts') ||
      (played.card.suit === 'hearts' &&
        winningCard.card.suit === 'hearts' &&
        cardValue(played.card.value) > cardValue(winningCard.card.value)) ||
      (played.card.suit === suitLed &&
        winningCard.card.suit === suitLed &&
        cardValue(played.card.value) > cardValue(winningCard.card.value));
    if (beats) {
      winningCard = played;
      winningIndex = index;
    }
  });
  return winningIndex;
}

/** The one bid the last bidder may not make (it would make the total exactly 7), if any. */
export function getForbiddenBid(state: GameState | undefined): number | null {
  if (!state) return null;
  const bidCount = state.players.filter((p) => typeof p.bid === 'number').length;
  if (bidCount !== state.players.length - 1) return null;
  const total = totalBids(state.players);
  const forbidden = TRICKS_PER_ROUND - total;
  return forbidden >= 0 && forbidden <= TRICKS_PER_ROUND ? forbidden : null;
}

export function totalBids(players: Player[]): number {
  return players.reduce((sum, p) => sum + (typeof p.bid === 'number' ? p.bid : 0), 0);
}

export const SUIT_SYMBOL: Record<string, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

export function isRedSuit(suit: string): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

/** Players in the order they bid / lead this round (starting from firstPlayer). */
export function biddingOrder(state: GameState | undefined): Player[] {
  if (!state) return [];
  const n = state.players.length;
  const start = state.firstPlayer ?? 0;
  return Array.from({ length: n }, (_, i) => state.players[(start + i) % n]);
}

/**
 * True when a player's bid can no longer be made: they've gone over,
 * or even winning every remaining trick wouldn't be enough.
 */
export function bidInTrouble(state: GameState | undefined, player: Player): boolean {
  if (!state || state.state !== 'tricks' || typeof player.bid !== 'number') return false;
  if (player.tricksWon > player.bid) return true;
  // Tricks still to be decided. During a trick, anyone who hasn't played yet still holds
  // the full count, so the largest hand includes the trick in progress. Once a trick is
  // complete its winner is already counted and every hand has shrunk. This stays correct
  // mid-trick, so the warning no longer flickers off when it becomes the player's turn.
  const remaining = Math.max(0, ...state.players.map((p) => p.hand.length));
  return player.tricksWon + remaining < player.bid;
}

/** Sort a hand by suit (alternating colours where possible, hearts — trumps — on the right), low to high. */
export function sortHand(hand: OwnedCard[]): OwnedCard[] {
  if (!hand || hand.length === 0) return [];
  const bySuit: Record<string, OwnedCard[]> = { spades: [], hearts: [], diamonds: [], clubs: [] };
  for (const c of hand) bySuit[c.card.suit]?.push(c);
  for (const s of Object.keys(bySuit)) bySuit[s].sort((a, b) => cardValue(a.card.value) - cardValue(b.card.value));

  const present = Object.keys(bySuit).filter((s) => bySuit[s].length > 0);
  const hasHearts = present.includes('hearts');
  const nonHearts = present.filter((s) => s !== 'hearts');
  const colourOf = (s: string) => (isRedSuit(s) ? 'R' : 'B');
  const permutations = <T,>(arr: T[]): T[][] =>
    arr.length <= 1 ? [arr] : arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));

  let best: string[] = hasHearts ? [...nonHearts, 'hearts'] : nonHearts;
  let bestScore = Infinity;
  for (const p of permutations(nonHearts)) {
    const full = hasHearts ? [...p, 'hearts'] : p;
    let score = 0;
    for (let i = 1; i < full.length; i++) if (colourOf(full[i]) === colourOf(full[i - 1])) score++;
    if (score < bestScore) {
      bestScore = score;
      best = full;
    }
  }
  return best.flatMap((s) => bySuit[s]);
}
