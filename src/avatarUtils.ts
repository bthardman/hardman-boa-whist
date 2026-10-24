import type { Player } from '../shared/types';
import { getAvatarData } from './avatarData';
import type { AvatarFrame } from './utils/avatarFrame';

/** One background colour per computer player (Player 2, 3, …), so they're easy to tell apart. */
const BOT_COLOURS = ['#c2571a', '#2f855a', '#6b46c1', '#b83280', '#2c7a7b', '#9c6b13', '#c53030'];

/** Computer players get a robot picture in their own colour, never a family member's face. */
export function botAvatarUrl(botName: string | undefined): string {
  const n = Number(botName?.match(/\d+/)?.[0] ?? 2);
  const bg = BOT_COLOURS[(n - 2 + BOT_COLOURS.length) % BOT_COLOURS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${bg}"/><g fill="#f4f8fb"><rect x="57" y="18" width="6" height="14" rx="3"/><circle cx="60" cy="17" r="6"/><rect x="28" y="32" width="64" height="50" rx="16"/><rect x="18" y="48" width="8" height="18" rx="4"/><rect x="94" y="48" width="8" height="18" rx="4"/><path d="M30 120c0-20 13-32 30-32s30 12 30 32z"/></g><g fill="${bg}"><circle cx="47" cy="54" r="7"/><circle cx="73" cy="54" r="7"/><rect x="46" y="68" width="28" height="5" rx="2.5"/></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** One background colour per guest, picked from their name, so the same name looks the same each time. */
const GUEST_COLOURS = ['#3b5bdb', '#0b7285', '#862e9c', '#d6336c', '#2b8a3e', '#e8590c', '#1971c2'];

const escapeXml = (text: string) => text.replace(/[<>&'"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A visitor's picture: their initials (up to two) on a colour picked from their name. */
export function guestAvatarUrl(name: string): string {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join('');
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  const bg = GUEST_COLOURS[hash % GUEST_COLOURS.length];
  const size = initials.length > 1 ? 50 : 62;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${bg}"/><text x="60" y="61" text-anchor="middle" dominant-baseline="central" font-family="'Arial Narrow', Arial, sans-serif" font-weight="700" font-size="${size}" fill="#f4f8fb">${escapeXml(initials)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * A player's picture: a robot for computer players, initials for guests, otherwise the family member's photo.
 * `frame` picks between each person's two photos (seats alternate them; see avatarFrame).
 */
export function getPlayerAvatarUrl(player: Player, frame: AvatarFrame = 1): string {
  if (player.isBot) return botAvatarUrl(player.botName);
  if (player.guestName) return guestAvatarUrl(player.guestName);
  const data = getAvatarData(player.selectedAvatar);
  return frame === 2 ? data.avatar2 : data.avatar1;
}
