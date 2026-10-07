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
  /** A computer player: played by the server, never has a socket or a family avatar. */
  isBot?: boolean;
  /** "Player 2", "Player 3"… shown instead of an avatar name for bots. */
  botName?: string;
};

export type State = 'lobby' | 'bidding' | 'tricks' | 'round_end' | 'winner';
export type GameSpeed = 'slow' | 'normal' | 'fast';
export type BotDifficulty = 'easy' | 'medium' | 'hard';

/** Quick reactions a player can show at the table (relayed by the server, never free text). */
export const EMOTES = {
  wow: { emoji: '😮', text: 'What a play' },
  slider: { emoji: '😏', text: 'Slider' },
  ouch: { emoji: '😬', text: 'Ouch' },
  haha: { emoji: '😂', text: 'Haha' },
  gotem: { emoji: '😎', text: "Got 'em" },
  incoming: { emoji: '🚀', text: 'Incoming' }
} as const;
export type EmoteId = keyof typeof EMOTES;

export type GameState = {
  roomId: string;
  /** A private solo table (one human plus computer players). */
  isPractice?: boolean;
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
  /** How well the computer players play (default medium). */
  botDifficulty?: BotDifficulty;
  /** Tricks completed this round, in order (public: everyone saw them played). */
  completedTricks?: { winnerId: string; cards: OwnedCard[] }[];
  /** Family table only: faces busy in a private game against computer players. */
  practising?: AvatarChoice[];
  gameId?: number; // bumped on every new game/reset so stale server timers can be ignored
  roundEndsAt?: number; // epoch ms when the round summary auto-advances
  /** Set while the lobby is counting down to the first deal. */
  startCountdown?: { id: number; durationMs: number; playerIds: string[] };
  /** Epoch ms when an offline player's turn will be played for them. */
  absentTurnDeadline?: number;
};
