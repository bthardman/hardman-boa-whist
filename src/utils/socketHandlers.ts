// Centralized socket event handlers
import { gameState, localSocketId, localPlayerId, roomId } from '../store';
import { get } from 'svelte/store';
import type { GameState } from '../../shared/types';
import { socket } from '../socket';

let errorHandlers: Map<string, (message: string) => void> = new Map();
let periodicSyncTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
let focusHandler: (() => void) | null = null;
let onlineHandler: (() => void) | null = null;

function syncCurrentRoomState() {
  const currentRoomId = get(roomId);
  if (!currentRoomId) return;

  const currentPlayerId = get(localPlayerId);
  if (currentPlayerId) {
    // Re-assert membership in the room; harmless if already joined.
    socket.emit('join_lobby', { roomId: currentRoomId, playerId: currentPlayerId });
  }
  socket.emit('get_state', { roomId: currentRoomId });
}

export function registerErrorHandler(event: string, handler: (message: string) => void) {
  errorHandlers.set(event, handler);
}

export function unregisterErrorHandler(event: string) {
  errorHandlers.delete(event);
}

export function setupSocketHandlers() {
  // Avoid duplicate listeners in HMR/remount scenarios.
  cleanupSocketHandlers();

  // State updates
  socket.on("state_updated", (state: GameState) => {
    // Always assign a new array reference for Svelte reactivity
    const newPlayers = [...state.players];
    const updatedState = { ...state, players: newPlayers };
    gameState.set(updatedState);
  });

  // Connection handling.
  // We ALWAYS re-send join_lobby on (re)connect so the server re-adds this socket
  // to the room's broadcast group and refreshes the player's socketId. Without this,
  // reconnected sockets silently miss all `io.to(roomId).emit(...)` broadcasts,
  // which makes the UI appear frozen until the user refreshes.
  socket.on("connect", () => {
    localSocketId.set(socket.id);
    // Request latest state and re-join room after reconnect.
    syncCurrentRoomState();
  });

  socket.on("disconnect", () => {
    // Clear the stored socket id so UI code that branches on connectivity can react.
    localSocketId.set(undefined);
  });

  // Error handlers
  socket.on("avatar_selection_error", (data: { message: string }) => {
    const handler = errorHandlers.get("avatar_selection_error");
    if (handler) handler(data.message);
  });

  socket.on("start_game_error", (data: { message: string }) => {
    const handler = errorHandlers.get("start_game_error");
    if (handler) handler(data.message);
  });

  socket.on("play_card_error", (data: { message: string }) => {
    const handler = errorHandlers.get("play_card_error");
    if (handler) handler(data.message);
  });

  socket.on("bid_error", (data: { message: string }) => {
    const handler = errorHandlers.get("bid_error");
    if (handler) handler(data.message);
  });

  socket.on("join_error", (data: { message: string }) => {
    const handler = errorHandlers.get("join_error");
    if (handler) handler(data.message);
  });

  // Initial sync: catches cases where connect fired before handlers were attached.
  if (socket.connected) {
    localSocketId.set(socket.id);
  }
  syncCurrentRoomState();

  // Keep state fresh when app regains attention/network.
  if (typeof window !== 'undefined') {
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') syncCurrentRoomState();
    };
    focusHandler = () => syncCurrentRoomState();
    onlineHandler = () => syncCurrentRoomState();
    document.addEventListener('visibilitychange', visibilityHandler);
    window.addEventListener('focus', focusHandler);
    window.addEventListener('online', onlineHandler);
  }

  // Lightweight safety net for any missed room broadcasts.
  periodicSyncTimer = setInterval(() => {
    if (socket.connected) syncCurrentRoomState();
  }, 5000);
}

export function cleanupSocketHandlers() {
  socket.off("state_updated");
  socket.off("connect");
  socket.off("disconnect");
  socket.off("avatar_selection_error");
  socket.off("start_game_error");
  socket.off("play_card_error");
  socket.off("bid_error");
  socket.off("join_error");

  if (periodicSyncTimer) {
    clearInterval(periodicSyncTimer);
    periodicSyncTimer = null;
  }

  if (typeof window !== 'undefined') {
    if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
    if (focusHandler) window.removeEventListener('focus', focusHandler);
    if (onlineHandler) window.removeEventListener('online', onlineHandler);
  }
  visibilityHandler = null;
  focusHandler = null;
  onlineHandler = null;
}
