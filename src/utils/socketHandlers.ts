// Centralized socket event handlers
import { gameState, localSocketId, localPlayerId, roomId } from '../store';
import { get } from 'svelte/store';
import type { GameState } from '../../shared/types';
import { socket } from '../socket';

let errorHandlers: Map<string, (message: string) => void> = new Map();

export function registerErrorHandler(event: string, handler: (message: string) => void) {
  errorHandlers.set(event, handler);
}

export function unregisterErrorHandler(event: string) {
  errorHandlers.delete(event);
}

export function setupSocketHandlers() {
  // State updates
  socket.on("state_updated", (state: GameState) => {
    // Always assign a new array reference for Svelte reactivity
    const newPlayers = [...state.players];
    const updatedState = { ...state, players: newPlayers };
    gameState.set(updatedState);
  });

  // Connection handling
  socket.on("connect", () => {
    localSocketId.set(socket.id);
    
    // Request current state and join lobby
    const currentRoomId = get(roomId);
    socket.emit("get_state", { roomId: currentRoomId });
    
    setTimeout(() => {
      const currentState = get(gameState);
      const currentPlayerId = get(localPlayerId);
      
      if (!currentState || 
          currentState.players.findIndex((p) => p.playerId === currentPlayerId) === -1) {
        socket.emit("join_lobby", { roomId: currentRoomId, playerId: currentPlayerId });
      }
    }, 500);
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
}

export function cleanupSocketHandlers() {
  socket.off("state_updated");
  socket.off("connect");
  socket.off("avatar_selection_error");
  socket.off("start_game_error");
  socket.off("play_card_error");
  socket.off("bid_error");
}
