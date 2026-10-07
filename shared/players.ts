// Player helpers shared by the server and the client.
import type { Player } from './types.ts';
import { AvatarChoice } from './types.ts';

/** The shared family table. */
export const FAMILY_ROOM_ID = 'familyroom';
const PRACTICE_PREFIX = 'practice-';

/** Each device gets its own private practice table, keyed by its player id. */
export function practiceRoomId(playerId: string): string {
  return `${PRACTICE_PREFIX}${playerId}`;
}

export function isPracticeRoomId(roomId: string): boolean {
  return roomId.startsWith(PRACTICE_PREFIX);
}

/** Taking part in the game: a human who picked a face, or a computer player. */
export function isSeated(player: Player): boolean {
  return !!player.isBot || player.selectedAvatar !== AvatarChoice.UNDEFINED;
}

/** "Player 3" for a computer player, otherwise the family member's name. */
export function displayName(player: Player | undefined): string {
  if (!player) return 'Player';
  if (player.isBot) return player.botName ?? 'Player';
  if (player.selectedAvatar === AvatarChoice.UNDEFINED) return 'A player';
  return player.selectedAvatar.charAt(0).toUpperCase() + player.selectedAvatar.slice(1);
}

/** The lowest free "Player N" (N >= 2; the human you're playing as is Player 1). */
export function nextBotName(players: Player[]): string {
  const used = new Set(players.filter((p) => p.isBot).map((p) => p.botName));
  let n = 2;
  while (used.has(`Player ${n}`)) n++;
  return `Player ${n}`;
}
