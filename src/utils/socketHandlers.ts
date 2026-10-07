// Centralized socket event handlers
import { gameState, localSocketId, localPlayerId, roomId } from '../store';
import { get } from 'svelte/store';
import type { GameState } from '../../shared/types';
import { socket } from '../socket';
import { showToast } from './toast';

type ErrorHandler = (message: string) => void;
type ErrorEvent = 'avatar_selection_error' | 'start_game_error' | 'play_card_error' | 'bid_error' | 'join_error';
const ERROR_EVENTS: ErrorEvent[] = [
  'avatar_selection_error',
  'start_game_error',
  'play_card_error',
  'bid_error',
  'join_error'
];

// Several components can listen to the same event; each gets its own entry.
const errorHandlers = new Map<string, Set<ErrorHandler>>();
let periodicSyncTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
let onlineHandler: (() => void) | null = null;

/** Re-joins the room (refreshes this socket's membership) and asks for the latest state. */
function rejoinRoom() {
  const currentRoomId = get(roomId);
  const currentPlayerId = get(localPlayerId);
  if (!currentRoomId || !currentPlayerId) return;
  socket.emit('join_lobby', { roomId: currentRoomId, playerId: currentPlayerId });
}

/** Moves this device to another table (family <-> practice). The server frees the old seat. */
export function switchRoom(nextRoomId: string) {
  if (get(roomId) === nextRoomId) return;
  gameState.set(undefined);
  roomId.set(nextRoomId);
  rejoinRoom();
}

/**
 * Registers a handler for a server error event and returns a function that removes it.
 * Events with no registered handler fall back to a toast, so errors are never silent.
 */
export function registerErrorHandler(event: ErrorEvent, handler: ErrorHandler): () => void {
  if (!errorHandlers.has(event)) errorHandlers.set(event, new Set());
  errorHandlers.get(event)!.add(handler);
  return () => errorHandlers.get(event)?.delete(handler);
}

export function setupSocketHandlers() {
  // Avoid duplicate listeners in HMR/remount scenarios.
  cleanupSocketHandlers();

  socket.on('state_updated', (state: GameState) => {
    // Always assign a new array reference for Svelte reactivity
    gameState.set({ ...state, players: [...state.players] });
  });

  // We ALWAYS re-send join_lobby on (re)connect so the server re-adds this socket to the
  // room's broadcast group and refreshes the player's socketId. Without this, reconnected
  // sockets silently miss room broadcasts and the UI appears frozen until a refresh.
  socket.on('connect', () => {
    localSocketId.set(socket.id);
    rejoinRoom();
  });

  socket.on('disconnect', () => {
    localSocketId.set(undefined);
  });

  for (const event of ERROR_EVENTS) {
    socket.on(event, (data: { message: string }) => {
      const handlers = errorHandlers.get(event);
      if (handlers && handlers.size > 0) handlers.forEach((h) => h(data.message));
      else showToast(data.message);
    });
  }

  // Room-wide announcements, e.g. "Start cancelled: Carol joined the table."
  socket.on('notice', (data: { message: string }) => showToast(data.message));

  // Initial sync: catches cases where connect fired before handlers were attached.
  if (socket.connected) {
    localSocketId.set(socket.id);
    rejoinRoom();
  }

  // Phones suspend background tabs; resync as soon as the game is visible or back online.
  if (typeof window !== 'undefined') {
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') rejoinRoom();
    };
    onlineHandler = () => rejoinRoom();
    document.addEventListener('visibilitychange', visibilityHandler);
    window.addEventListener('online', onlineHandler);
  }

  // Lightweight safety net for any missed room broadcasts. The server only answers
  // this socket (not the whole room) when nothing has changed.
  periodicSyncTimer = setInterval(() => {
    if (socket.connected) socket.emit('get_state', { roomId: get(roomId) });
  }, 5000);
}

export function cleanupSocketHandlers() {
  socket.off('state_updated');
  socket.off('connect');
  socket.off('disconnect');
  socket.off('notice');
  for (const event of ERROR_EVENTS) socket.off(event);

  if (periodicSyncTimer) {
    clearInterval(periodicSyncTimer);
    periodicSyncTimer = null;
  }
  if (typeof window !== 'undefined') {
    if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
    if (onlineHandler) window.removeEventListener('online', onlineHandler);
  }
  visibilityHandler = null;
  onlineHandler = null;
}
