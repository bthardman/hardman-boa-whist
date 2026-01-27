// Avatar management utilities
import type { Player } from '../../shared/types';
import { getAvatarData } from '../avatarData';

let swapIntervals: Map<string, NodeJS.Timeout> = new Map();

export function startAvatarSwap(player: Player): void {
  // Stop any existing swap for this player
  stopAvatarSwap(player.playerId);
  
  const avatarData = getAvatarData(player.selectedAvatar);
  if (!player.inGameAvatar) {
    player.inGameAvatar = avatarData.avatar1;
  }
  
  const interval = setInterval(() => {
    if (player.inGameAvatar) {
      player.inGameAvatar =
        player.inGameAvatar === avatarData.avatar1 
          ? avatarData.avatar2 
          : avatarData.avatar1;
    } else {
      player.inGameAvatar = avatarData.avatar1;
    }
  }, 1000);
  
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
