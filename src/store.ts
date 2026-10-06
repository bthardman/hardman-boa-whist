import { writable, derived } from 'svelte/store';
import type { GameState, Player } from '../shared/types';
import { v4 as uuidv4 } from 'uuid';

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

export const roomId = writable<string>('familyroom');
