// shared/types.ts

export const AvatarChoice = {
  ANGELA: 'angela',
  BRAD: 'brad',
  CAROL: 'carol',
  DEREK: 'derek',
  ROWAN: 'rowan',
  TONY: 'tony',
  UNDEFINED: 'undefined'
} as const;

export type AvatarChoice = typeof AvatarChoice[keyof typeof AvatarChoice];

export type Card = {
  suit: string;
  value: string;
  id: string;
};

export type OwnedCard = { card: Card; playerId: string };

export type Player = {
  selectedAvatar: AvatarChoice; // required, initially UNDEFINED
  inGameAvatar?: string;
  hand: OwnedCard[];
  playerId: string;
  socketId?: string;
  tricksWon: number;
  bid?: number;
  disconnected?: boolean;
};

export type State = 'lobby' | 'bidding' | 'tricks' | 'round_end' | 'winner';

export type GameState = {
  roomId: string;
  players: Player[];
  currentPlayer: number; // player index
  firstPlayer: number; // player index
  currentTrick: OwnedCard[];
  state: State;
  winner?: Player;
  scoreboard: Record<number, number>; // player index -> score
};
