import type { Player } from '../shared/types';
import { getAvatarData } from './avatarData';

/** One background colour per computer player (Player 2, 3, …), so they're easy to tell apart. */
const BOT_COLOURS = ['#c2571a', '#2f855a', '#6b46c1', '#b83280', '#2c7a7b', '#9c6b13', '#c53030'];

/** Computer players get a robot picture in their own colour, never a family member's face. */
export function botAvatarUrl(botName: string | undefined): string {
  const n = Number(botName?.match(/\d+/)?.[0] ?? 2);
  const bg = BOT_COLOURS[(n - 2 + BOT_COLOURS.length) % BOT_COLOURS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${bg}"/><g fill="#f4f8fb"><rect x="57" y="18" width="6" height="14" rx="3"/><circle cx="60" cy="17" r="6"/><rect x="28" y="32" width="64" height="50" rx="16"/><rect x="18" y="48" width="8" height="18" rx="4"/><rect x="94" y="48" width="8" height="18" rx="4"/><path d="M30 120c0-20 13-32 30-32s30 12 30 32z"/></g><g fill="${bg}"><circle cx="47" cy="54" r="7"/><circle cx="73" cy="54" r="7"/><rect x="46" y="68" width="28" height="5" rx="2.5"/></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Gets the avatar URL for a player, prioritizing inGameAvatar if available,
 * otherwise falling back to the player's selected avatar
 */
export function getPlayerAvatarUrl(player: Player): string {
  if (player.isBot) return botAvatarUrl(player.botName);

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
