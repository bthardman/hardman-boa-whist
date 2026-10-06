// shared/types.ts

export const AvatarChoice = {
  ANGELA: 'angela',
  AFRODITI: 'afroditi',
  BRAD: 'brad',
  CAROL: 'carol',
  DEREK: 'derek',
  ROWAN: 'rowan',
  TONY: 'tony',
  VANESSA: 'vanessa',
  UNDEFINED: 'undefined'
} as const;

export type AvatarChoice = typeof AvatarChoice[keyof typeof AvatarChoice];

/** 7 cards each from a 52-card deck: more than 7 players would run out of cards. */
export const MAX_PLAYERS = 7;

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
export type GameSpeed = 'slow' | 'normal' | 'fast';

export type GameState = {
  roomId: string;
  players: Player[];
  currentPlayer: number; // player index
  firstPlayer: number; // player index
  currentTrick: OwnedCard[];
  state: State;
  winner?: Player;
  scoreboard: Record<number, number>; // player index -> score
  roundNumber: number; // current round number
  maxRounds?: number; // optional: max rounds before game ends
  winningScore?: number; // optional: score threshold to win
  gameSpeed?: GameSpeed; // optional: timing speed preference for round flow
  gameId?: number; // bumped on every new game/reset so stale server timers can be ignored
  roundEndsAt?: number; // epoch ms when the round summary auto-advances
  /** Set while the lobby is counting down to the first deal. */
  startCountdown?: { id: number; durationMs: number; playerIds: string[] };
  /** Epoch ms when an offline player's turn will be played for them. */
  absentTurnDeadline?: number;
};
