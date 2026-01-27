// Bidding rules and validation
import type { GameState, Player } from '../../shared/types.ts';

export function calculateBidTotal(players: Player[]): number {
  return players.reduce((sum, player) => {
    const bid = typeof player.bid === 'number' ? player.bid : 0;
    return sum + bid;
  }, 0);
}

export function getForbiddenBid(players: Player[]): number | null {
  const currentTotal = calculateBidTotal(players);
  const forbiddenBid = 7 - currentTotal;
  
  // Only forbid if it's a valid bid (0-7)
  if (forbiddenBid >= 0 && forbiddenBid <= 7) {
    return forbiddenBid;
  }
  
  return null;
}

export function isValidBid(room: GameState, playerIndex: number, bid: number): { valid: boolean; message?: string } {
  const player = room.players[playerIndex];
  if (!player) {
    return { valid: false, message: 'Player not found' };
  }
  
  // Check if bid is in valid range
  if (bid < 0 || bid > 7) {
    return { valid: false, message: 'Bid must be between 0 and 7' };
  }
  
  // Check if this is the last player to bid
  const playersWhoBidded = room.players.filter(p => typeof p.bid === 'number').length;
  const isLastBidder = playersWhoBidded === room.players.length - 1;
  
  if (isLastBidder) {
    // Last bidder cannot make total = 7
    const currentTotal = calculateBidTotal(room.players);
    const newTotal = currentTotal + bid;
    
    if (newTotal === 7) {
      return { valid: false, message: `Cannot bid ${bid}: total would equal 7. You must bid a different number.` };
    }
  }
  
  return { valid: true };
}
