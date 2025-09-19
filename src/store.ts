import { writable, derived } from 'svelte/store';
import type { Player, GameState } from '../shared/types';
import { AvatarChoice } from '../shared/types';

import { socket } from './socket';

export const mySocketId = writable<string>('');
if (typeof window !== 'undefined') {
  mySocketId.set(socket.id || '');
  socket.on('connect', () => {
    mySocketId.set(socket.id || '');
  });
}

// Create initial players with avatar choices
const initialPlayers: Player[] = Object.values(AvatarChoice)
  .filter(choice => choice !== AvatarChoice.UNDEFINED)
  .map(choice => ({
    selectedAvatar: AvatarChoice.UNDEFINED,
    hand: [],
    tricksWon: 0
  }));

export const players = writable<Player[]>(initialPlayers);

export const gameState = writable<GameState | undefined>(undefined);

export const localPlayerIndex = derived([
  gameState,
  mySocketId
], ([$gameState, $mySocketId]) => {
  if (!$gameState || !$gameState.players) return undefined;
  return $gameState.players.findIndex(p => p.socketId === $mySocketId);
});
export const roomId = writable<string>("familyroom");
