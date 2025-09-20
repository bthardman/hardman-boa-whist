import { writable, derived } from 'svelte/store';
import type { GameState, Player } from '../shared/types';
import { v4 as uuidv4 } from "uuid";

// Generate or retrieve persistent playerId
export let persistentId = localStorage.getItem("playerId");
if (!persistentId) {
  persistentId = uuidv4();
  localStorage.setItem("playerId", persistentId);
}

// Server game state
export const gameState = writable<GameState | undefined>(undefined);

// Local socket id (just for connection tracking)
export const localSocketId = writable<string | undefined>(undefined);

// Persistent playerId store
export const localPlayerId = writable<string | null>(persistentId);

// Derived: local player object
export const localPlayer = derived(
  [gameState, localPlayerId],
  ([$gameState, $localPlayerId]) => {
    if (!$gameState || !$localPlayerId) return undefined;
    return $gameState.players.find((p: Player) => p.playerId === $localPlayerId);
  }
);

// Optional: just the index
export const localPlayerIndex = derived(
  [gameState, localPlayerId],
  ([$gameState, $localPlayerId]) => {
    if (!$gameState || !$localPlayerId) return -1;
    return $gameState.players.findIndex((p: Player) => p.playerId === $localPlayerId);
  }
);

export const roomId = writable<string>("familyroom");