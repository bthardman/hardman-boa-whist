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

/** Taking part in the game: a family member who picked a face, a guest, or a computer player. */
export function isSeated(player: Player): boolean {
  return !!player.isBot || !!player.guestName || player.selectedAvatar !== AvatarChoice.UNDEFINED;
}

/** A family member's name, from their face (e.g. 'afroditi' -> 'Afroditi'). */
export function familyName(avatar: AvatarChoice): string {
  return avatar.charAt(0).toUpperCase() + avatar.slice(1);
}

/** "Player 3" for a computer player, the typed name for a guest, otherwise the family member's name. */
export function displayName(player: Player | undefined): string {
  if (!player) return 'Player';
  if (player.isBot) return player.botName ?? 'Player';
  if (player.guestName) return player.guestName;
  if (player.selectedAvatar === AvatarChoice.UNDEFINED) return 'A player';
  return familyName(player.selectedAvatar);
}

export const MAX_GUEST_NAME_LENGTH = 16;

/**
 * Tidies a name a guest typed: trims and squashes spaces. Returns null unless it's 1–16 letters,
 * numbers, spaces, apostrophes, dots or hyphens, starting with a letter or number, and isn't a
 * family member's name or a computer player's "Player N" (so nobody is mistaken for them).
 */
export function cleanGuestName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name || name.length > MAX_GUEST_NAME_LENGTH) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '’.-]*$/u.test(name)) return null;
  if (/^player ?\d+$/i.test(name)) return null;
  const familyNames = Object.values(AvatarChoice).filter((a) => a !== AvatarChoice.UNDEFINED);
  if (familyNames.some((a) => a === name.toLowerCase())) return null;
  return name;
}

/** The lowest free "Player N" (N >= 2; the human you're playing as is Player 1). */
export function nextBotName(players: Player[]): string {
  const used = new Set(players.filter((p) => p.isBot).map((p) => p.botName));
  let n = 2;
  while (used.has(`Player ${n}`)) n++;
  return `Player ${n}`;
}
