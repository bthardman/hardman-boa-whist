// Avatar management utilities
import type { Player } from '../../shared/types';
import { getAvatarData } from '../avatarData';
import { gameState } from '../store';

let swapIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

function updatePlayerAvatar(playerId: string, nextAvatar: string): void {
  gameState.update((state) => {
    if (!state) return state;
    const idx = state.players.findIndex((p) => p.playerId === playerId);
    if (idx === -1) return state;

    const nextPlayers = [...state.players];
    nextPlayers[idx] = { ...nextPlayers[idx], inGameAvatar: nextAvatar };
    return { ...state, players: nextPlayers };
  });
}

export function startAvatarSwap(player: Player): void {
  // Stop any existing swap for this player
  stopAvatarSwap(player.playerId);
  
  const avatarData = getAvatarData(player.selectedAvatar);
  updatePlayerAvatar(player.playerId, player.inGameAvatar || avatarData.avatar1);
  
  const interval = setInterval(() => {
    gameState.update((state) => {
      if (!state) return state;
      const idx = state.players.findIndex((p) => p.playerId === player.playerId);
      if (idx === -1) return state;

      const current = state.players[idx].inGameAvatar || avatarData.avatar1;
      const next = current === avatarData.avatar1 ? avatarData.avatar2 : avatarData.avatar1;

      const nextPlayers = [...state.players];
      nextPlayers[idx] = { ...nextPlayers[idx], inGameAvatar: next };
      return { ...state, players: nextPlayers };
    });
  }, 2400);
  
  swapIntervals.set(player.playerId, interval);
}

export function stopAvatarSwap(playerId: string): void {
  const interval = swapIntervals.get(playerId);
  if (interval) {
    clearInterval(interval);
    swapIntervals.delete(playerId);
  }
}

export function stopAllAvatarSwaps(): void {
  swapIntervals.forEach((interval) => clearInterval(interval));
  swapIntervals.clear();
}
