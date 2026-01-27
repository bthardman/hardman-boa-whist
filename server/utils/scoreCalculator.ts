// Score calculation and round management
import type { GameState, Player } from '../../shared/types';

export function calculateRoundScores(room: GameState): Record<number, number> {
  const roundScores: Record<number, number> = {};
  
  room.players.forEach((player, index) => {
    const bid = player.bid ?? 0;
    const tricksWon = player.tricksWon;
    
    // Score calculation: 
    // - If tricks won equals bid: score = bid + 10 bonus points
    // - Otherwise: score = tricks won (no bonus)
    if (bid === tricksWon) {
      roundScores[index] = bid + 10;
    } else {
      roundScores[index] = tricksWon;
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
  // Check if max rounds reached
  if (room.maxRounds && room.roundNumber >= room.maxRounds) {
    return true;
  }
  
  // Check if any player reached winning score
  if (room.winningScore) {
    const hasWinner = Object.values(room.scoreboard).some(
      score => score >= room.winningScore!
    );
    if (hasWinner) {
      return true;
    }
  }
  
  return false;
}

export function findGameWinner(room: GameState): Player | undefined {
  if (!checkGameEnd(room)) {
    return undefined;
  }
  
  // Find player with highest score
  let maxScore = -1;
  let winnerIndex = -1;
  
  Object.entries(room.scoreboard).forEach(([index, score]) => {
    const playerIndex = parseInt(index);
    if (score > maxScore) {
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
