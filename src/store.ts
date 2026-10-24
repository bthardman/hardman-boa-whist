import { writable, derived } from 'svelte/store';
import type { GameState } from '../shared/types';
import { v4 as uuidv4 } from 'uuid';
import { FAMILY_ROOM_ID, isPracticeRoomId } from '../shared/players';

/**
 * This device's secret token: it proves to the server who we are, so a refresh or reconnect
 * returns you to your seat. It's never shown to other devices (they see a public id derived
 * from it). Stored under the old 'playerId' key so existing devices keep their identity.
 */
function loadPlayerToken(): string {
  try {
    const existing = localStorage.getItem('playerId');
    if (existing) return existing;
    const created = uuidv4();
    localStorage.setItem('playerId', created);
    return created;
  } catch {
    // Storage blocked (e.g. some private modes): fall back to a token for this tab only.
    return uuidv4();
  }
}

export const playerToken = loadPlayerToken();

// Server game state (as this device is allowed to see it)
export const gameState = writable<GameState | undefined>(undefined);

// Local socket id (just for connection tracking)
export const localSocketId = writable<string | undefined>(undefined);

/**
 * The logo intro has been seen (or skipped because you went straight to the table): it plays
 * once per visit, not every time you come back to the lobby.
 */
export const introDone = writable(false);

/** True while this device is watching a game it isn't playing in (it joins when the game ends). */
export const watching = writable(false);

/** Server clock minus device clock (ms), so countdowns are right even if the device's clock is off. */
export const serverClockOffset = writable(0);

// Derived: the local player (undefined while watching)
export const localPlayer = derived(gameState, ($gameState) =>
  $gameState?.players.find((p) => p.playerId === $gameState.viewerId)
);

// Derived: local player's seat index (-1 while watching)
export const localPlayerIndex = derived(gameState, ($gameState) =>
  $gameState ? $gameState.players.findIndex((p) => p.playerId === $gameState.viewerId) : -1
);

/** Remembered per tab, so refreshing a practice game keeps you on your practice table. */
const ROOM_KEY = 'roomId';
function loadRoomId(): string {
  try {
    // The server checks the practice table really is ours.
    const saved = sessionStorage.getItem(ROOM_KEY);
    if (saved && (saved === FAMILY_ROOM_ID || isPracticeRoomId(saved))) return saved;
  } catch {
    /* storage blocked: start at the family table */
  }
  return FAMILY_ROOM_ID;
}

export const roomId = writable<string>(loadRoomId());
roomId.subscribe((id) => {
  try {
    sessionStorage.setItem(ROOM_KEY, id);
  } catch {
    /* storage blocked: the table just won't survive a refresh */
  }
});
