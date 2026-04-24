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
  const targetScore = room.winningScore ?? 5;

  // Game ends when a player reaches target score
  const hasPlayerAtTarget = Object.values(room.scoreboard).some(score => score >= targetScore);
  if (!hasPlayerAtTarget) {
    return false;
  }
  
  // If multiple players at target+, check if we're in overtime
  const playersAtTargetPlus = Object.values(room.scoreboard).filter(score => score >= targetScore);
  
  // If only one player at target+, game ends
  if (playersAtTargetPlus.length === 1) {
    return true;
  }
  
  // Multiple players at target+ means overtime - game continues until one player has more points.
  const scoresAtTargetPlus: number[] = [];
  Object.values(room.scoreboard).forEach(score => {
    if (score >= targetScore) scoresAtTargetPlus.push(score);
  });
  
  const maxScore = Math.max(...scoresAtTargetPlus);
  const playersWithMaxScore = scoresAtTargetPlus.filter(s => s === maxScore).length;
  
  // Game ends if one player has strictly more points than all others at target+
  return playersWithMaxScore === 1;
}

export function findGameWinner(room: GameState): Player | undefined {
  if (!checkGameEnd(room)) {
    return undefined;
  }
  const targetScore = room.winningScore ?? 5;
  
  // Find player with highest score (must be >= targetScore)
  let maxScore = -1;
  let winnerIndex = -1;
  
  Object.entries(room.scoreboard).forEach(([index, score]) => {
    const playerIndex = parseInt(index);
    if (score >= targetScore && score > maxScore) {
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
