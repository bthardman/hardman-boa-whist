import type { Player } from '../shared/types';
import { getAvatarData } from './avatarData';

/** Computer players get a neutral picture, never a family member's face. */
export const BOT_AVATAR_URL = '/avatars/bot.svg';

/**
 * Gets the avatar URL for a player, prioritizing inGameAvatar if available,
 * otherwise falling back to the player's selected avatar
 */
export function getPlayerAvatarUrl(player: Player): string {
  if (player.isBot) return BOT_AVATAR_URL;

  // If player has an inGameAvatar (for dynamic swapping), use that
  if (player.inGameAvatar) {
    return player.inGameAvatar;
  }

  // Use the player's selected avatar
  return getAvatarData(player.selectedAvatar).avatar1;
}

/**
 * Gets the winner's avatar URL, prioritizing inGameAvatar if available,
 * otherwise falling back to the player's selected avatar
 */
export function getWinnerAvatarUrl(winner: Player): string {
  return getPlayerAvatarUrl(winner);
}
