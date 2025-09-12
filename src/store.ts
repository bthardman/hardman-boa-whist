import { writable } from 'svelte/store';
import type { Player, GameState } from '../shared/types';

export const players = writable<Player[]>([
  { name: 'Angela', avatar1: '/avatars/angela_1.png', avatar2: '/avatars/angela_2.png', hand: [], tricksWon: 0 },
  { name: 'Brad', avatar1: '/avatars/brad_1.png', avatar2: '/avatars/brad_2.png', hand: [], tricksWon: 0 },
  { name: 'Carol', avatar1: '/avatars/carol_1.png', avatar2: '/avatars/carol_2.png', hand: [], tricksWon: 0 },
  { name: 'Derek', avatar1: '/avatars/derek_1.png', avatar2: '/avatars/derek_2.png', hand: [], tricksWon: 0 },
  { name: 'Rowan', avatar1: '/avatars/rowan_1.png', avatar2: '/avatars/rowan_2.png', hand: [], tricksWon: 0 },
  { name: 'Tony', avatar1: '/avatars/tony_1.png', avatar2: '/avatars/tony_2.png', hand: [], tricksWon: 0 },
]);

export const gameState = writable<GameState | undefined>(undefined);
export const roomId = writable<string>("familyroom");
