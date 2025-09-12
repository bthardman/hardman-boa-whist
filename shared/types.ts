// shared/types.ts

export type Card = {
  suit: string;
  value: string;
  id: string;
};

export type OwnedCard = { card: Card; player: Player };

export type Player = {
  name: string;
  avatar1: string;
  avatar2: string;
  selectedAvatar?: string;
  inGameAvatar?: string;
  hand: OwnedCard[];
  socketId?: string;
  tricksWon: number;
  bid?: number;
  disconnected?: boolean;
  isLocal?: boolean;
};

export type State = 'lobby' | 'bidding' | 'tricks' | 'round_end' | 'winner';

export type GameState = {
  roomId: string;
  players: Player[];
  currentPlayer: string;
  firstPlayer: string;
  currentTrick: OwnedCard[];
  state: State;
  winner?: Player;
  scoreboard: Record<string, number>;
};
