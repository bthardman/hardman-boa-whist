import { writable } from 'svelte/store';
export const scoreboard = writable<Record<string, number>>({});

export type OwnedCard = {card: Card, player: Player };

export type Card = {
  suit: string;
  value: string;
  id: string;
};

export type Player = {
  name: string;
  avatar1: string;
  avatar2: string;
  selectedAvatar?: string;
  inGameAvatar?: string;
  hand: OwnedCard[];
  tricksWon: number;
  socketId?: string;
};

export const players = writable<Player[]>([
  { name: 'Angela', avatar1: '/avatars/angela_1.png', avatar2: '/avatars/angela_2.png', hand: [], tricksWon: 0 },
  { name: 'Brad', avatar1: '/avatars/brad_1.png', avatar2: '/avatars/brad_2.png', hand: [], tricksWon: 0 },
  { name: 'Carol', avatar1: '/avatars/carol_1.png', avatar2: '/avatars/carol_2.png', hand: [], tricksWon: 0 },
  { name: 'Derek', avatar1: '/avatars/derek_1.png', avatar2: '/avatars/derek_2.png', hand: [], tricksWon: 0 },
  { name: 'Rowan', avatar1: '/avatars/rowan_1.png', avatar2: '/avatars/rowan_2.png', hand: [], tricksWon: 0 },
  { name: 'Tony', avatar1: '/avatars/tony_1.png', avatar2: '/avatars/tony_2.png', hand: [], tricksWon: 0 },
]);

export const winner = writable<Player | null>(null);
export const gameStage = writable<'lobby' | 'playing' | 'winner'>('lobby');

export type TrickPlay = { playerId: string; card: Card };

export type GameState = {
  roomId: string;
  players: Player[];
  currentTrick: OwnedCard[];
  currentPlayerId: string;
};

export const gameState= writable<GameState | null>(null);

export const roomId = writable<string>("familyroom");