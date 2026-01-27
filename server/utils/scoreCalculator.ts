// Score calculation and round management
import type { GameState, Player } from '../../shared/types.ts';

export function calculateRoundScores(room: GameState): Record<number, number> {
  const roundScores: Record<number, number> = {};
  
  room.players.forEach((player, index) => {
    const bid = player.bid ?? 0;
    const tricksWon = player.tricksWon;
    
    // Score calculation: 1 point if tricks won equals bid, 0 otherwise
    if (bid === tricksWon) {
      roundScores[index] = 1;
    } else {
      roundScores[index] = 0;
    }
  });
  
  return roundScores;
}

export function updateTotalScores(room: GameState, roundScores: Record<number, number>): void {
  // Initialize scoreboard if needed
  if (!room.scoreboard) {
    room.scoreboard = {};
  }
  
  // Add round scores to total scores
  Object.entries(roundScores).forEach(([playerIndex, score]) => {
    const index = parseInt(playerIndex);
    room.scoreboard[index] = (room.scoreboard[index] || 0) + score;
  });
}

export function checkGameEnd(room: GameState): boolean {
  // Game ends when a player reaches 5 points
  const hasPlayerAt5 = Object.values(room.scoreboard).some(score => score >= 5);
  if (!hasPlayerAt5) {
    return false;
  }
  
  // If multiple players at 5+, check if we're in overtime
  const playersAt5Plus = Object.values(room.scoreboard).filter(score => score >= 5);
  
  // If only one player at 5+, game ends
  if (playersAt5Plus.length === 1) {
    return true;
  }
  
  // Multiple players at 5+ means overtime - game continues until one player has more points
  // Check if there's a clear winner (one player has strictly more points than others at 5+)
  const scoresAt5Plus: number[] = [];
  Object.values(room.scoreboard).forEach(score => {
    if (score >= 5) scoresAt5Plus.push(score);
  });
  
  const maxScore = Math.max(...scoresAt5Plus);
  const playersWithMaxScore = scoresAt5Plus.filter(s => s === maxScore).length;
  
  // Game ends if one player has strictly more points than all others at 5+
  return playersWithMaxScore === 1;
}

export function findGameWinner(room: GameState): Player | undefined {
  if (!checkGameEnd(room)) {
    return undefined;
  }
  
  // Find player with highest score (must be >= 5)
  let maxScore = -1;
  let winnerIndex = -1;
  
  Object.entries(room.scoreboard).forEach(([index, score]) => {
    const playerIndex = parseInt(index);
    if (score >= 5 && score > maxScore) {
      maxScore = score;
      winnerIndex = playerIndex;
    }
  });
  
  return winnerIndex !== -1 ? room.players[winnerIndex] : undefined;
}

export function checkRoundEnd(room: GameState): boolean {
  // Round ends when all players have no cards left
  return room.players.every(player => player.hand.length === 0);
}
