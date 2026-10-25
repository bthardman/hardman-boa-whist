// Everything the game server shares between its parts: the rooms, timers and timing settings.
// One context per server, so tests can run several isolated servers with tiny timings.
import type { Server, Socket } from 'socket.io';
import type { RoundLogEntry } from './bot/index.ts';
import type { GameRecord } from '../shared/stats.ts';
import type { SeatTally } from './stats.ts';
import type { SettingsStore } from './settings.ts';
import { RoomManager } from './utils/roomManager.ts';

export type Timings = {
  /** How long a player who drops out of the lobby keeps their seat before it is released. */
  lobbySeatGraceMs: number;
  /** Countdown shown to everyone between pressing Start and the first deal. */
  startCountdownMs: number;
  /** How long the table waits for an offline player before playing their turn for them. */
  absentAutoplayMs: number;
  /** A computer player's "thinking" pause before it moves (scaled by game pace, plus a little randomness). */
  botThinkMs: number;
  /** How long a finished trick stays on the table (scaled by game pace). */
  trickPauseMs: number;
  /** How long the round scores show before the next deal (scaled by game pace). */
  roundSummaryMs: number;
  /** A practice table with nobody connected is thrown away after this long. */
  practiceIdleMs: number;
  /** A family game with nobody connected is ended after this long, so it can't lock the table. */
  abandonedGameMs: number;
};

export const DEFAULT_TIMINGS: Timings = {
  lobbySeatGraceMs: 30_000,
  startCountdownMs: 3_000,
  absentAutoplayMs: 20_000,
  botThinkMs: 1_100,
  trickPauseMs: 5_000,
  roundSummaryMs: 15_000,
  practiceIdleMs: 10 * 60_000,
  abandonedGameMs: 3 * 60_000
};

/** What a connection is: the table it's at, who it is, and whether it's only watching. */
export type SocketData = { roomId?: string; playerId?: string; watching?: boolean };
export type GameSocket = Socket & { data: SocketData };

type Timer = ReturnType<typeof setTimeout>;

export type Ctx = {
  io: Server;
  rooms: RoomManager;
  timings: Timings;
  /** Every card played this round, per room: public, used by computer players to remember the play. */
  roundLogs: Map<string, RoundLogEntry[]>;
  /** The pending "3, 2, 1" countdown timer per room. */
  startTimers: Map<string, Timer>;
  /** The turn an offline player's autoplay is scheduled for, per room. */
  absentTurns: Map<string, string>;
  /** The turn a computer player's move is scheduled for, per room. */
  botTurns: Map<string, string>;
  practiceCleanupTimers: Map<string, Timer>;
  abandonTimers: Map<string, Timer>;
  /** Each seat's running totals for the game in progress, per room (for stats). */
  tallies: Map<string, SeatTally[]>;
  /** Where finished games are sent for stats (unset: stats are off, e.g. local play). */
  reportGame?: (record: GameRecord) => void;
  /** Where the family table's settings are saved (unset: they last until the server restarts). */
  settingsStore?: SettingsStore;
  settingsSaveTimer?: Timer;
  /** setTimeout that the server can cancel all at once when it shuts down. */
  setTimer(fn: () => void, ms: number): Timer;
  clearTimer(timer: Timer | undefined): void;
  clearAllTimers(): void;
};

export function createContext(io: Server, timings: Partial<Timings> = {}): Ctx {
  const live = new Set<Timer>();
  // Ignore missing or invalid overrides so a bad env var can't turn a timer into NaN.
  const overrides = Object.fromEntries(
    Object.entries(timings).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
  );
  return {
    io,
    rooms: new RoomManager(),
    timings: { ...DEFAULT_TIMINGS, ...overrides },
    roundLogs: new Map(),
    startTimers: new Map(),
    absentTurns: new Map(),
    botTurns: new Map(),
    practiceCleanupTimers: new Map(),
    abandonTimers: new Map(),
    tallies: new Map(),
    setTimer(fn, ms) {
      const timer = setTimeout(() => {
        live.delete(timer);
        fn();
      }, ms);
      live.add(timer);
      return timer;
    },
    clearTimer(timer) {
      if (!timer) return;
      clearTimeout(timer);
      live.delete(timer);
    },
    clearAllTimers() {
      live.forEach((timer) => clearTimeout(timer));
      live.clear();
    }
  };
}
