import { writable, derived } from 'svelte/store';
import type { GameState, Player } from '../shared/types';
import { v4 as uuidv4 } from 'uuid';
import { FAMILY_ROOM_ID, practiceRoomId } from '../shared/players';

/** A stable id for this browser, so a refresh or reconnect returns you to your seat. */
function loadPlayerId(): string {
  try {
    const existing = localStorage.getItem('playerId');
    if (existing) return existing;
    const created = uuidv4();
    localStorage.setItem('playerId', created);
    return created;
  } catch {
    // Storage blocked (e.g. some private modes): fall back to an id for this tab only.
    return uuidv4();
  }
}

export const persistentId = loadPlayerId();

// Server game state
export const gameState = writable<GameState | undefined>(undefined);

// Local socket id (just for connection tracking)
export const localSocketId = writable<string | undefined>(undefined);

// Persistent playerId store
export const localPlayerId = writable<string | null>(persistentId);

// Derived: local player object
export const localPlayer = derived([gameState, localPlayerId], ([$gameState, $localPlayerId]) => {
  if (!$gameState || !$localPlayerId) return undefined;
  return $gameState.players.find((p: Player) => p.playerId === $localPlayerId);
});

// Derived: local player's seat index (-1 when spectating)
export const localPlayerIndex = derived([gameState, localPlayerId], ([$gameState, $localPlayerId]) => {
  if (!$gameState || !$localPlayerId) return -1;
  return $gameState.players.findIndex((p: Player) => p.playerId === $localPlayerId);
});

export const isLocalPlayer = (player: Player) => player.playerId === persistentId;

/** Remembered per tab, so refreshing a practice game keeps you on your practice table. */
const ROOM_KEY = 'roomId';
function loadRoomId(): string {
  try {
    const saved = sessionStorage.getItem(ROOM_KEY);
    if (saved === FAMILY_ROOM_ID || saved === practiceRoomId(persistentId)) return saved;
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
