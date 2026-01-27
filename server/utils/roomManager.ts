// Room management and state
import type { GameState, Player } from '../../shared/types.ts';
import { AvatarChoice } from '../../shared/types.ts';

export class RoomManager {
  private rooms: Record<string, GameState> = {};

  getRoom(roomId: string): GameState | undefined {
    return this.rooms[roomId];
  }

  createRoom(roomId: string): GameState {
    if (this.rooms[roomId]) {
      return this.rooms[roomId];
    }

    this.rooms[roomId] = {
      roomId,
      players: [],
      currentPlayer: 0,
      firstPlayer: 0,
      currentTrick: [],
      state: 'lobby',
      scoreboard: {},
      roundNumber: 0
    };

    return this.rooms[roomId];
  }

  joinPlayer(roomId: string, playerId: string, socketId: string): Player {
    const room = this.createRoom(roomId);
    
    // Check if this player already exists (reconnect)
    let player = room.players.find(p => p.playerId === playerId);
    if (player) {
      // Reconnection: update socket ID and mark as connected
      player.socketId = socketId;
      player.disconnected = false;
      // Note: player's hand and game state are preserved from room state
    } else {
      // New player joining
      player = {
        playerId,
        socketId,
        selectedAvatar: AvatarChoice.UNDEFINED,
        hand: [],
        tricksWon: 0
      };
      room.players.push(player);
    }

    return player;
  }

  findPlayerBySocketId(socketId: string): { room: GameState; player: Player } | null {
    for (const roomId in this.rooms) {
      const room = this.rooms[roomId];
      const player = room.players.find(p => p.socketId === socketId);
      if (player) {
        return { room, player };
      }
    }
    return null;
  }

  findPlayerByPlayerId(roomId: string, playerId: string): Player | undefined {
    const room = this.rooms[roomId];
    return room?.players.find(p => p.playerId === playerId);
  }

  canStartGame(room: GameState): boolean {
    const playersWithAvatars = room.players.filter(
      p => p.selectedAvatar !== AvatarChoice.UNDEFINED
    ).length;
    return playersWithAvatars >= 2;
  }

  isAvatarTaken(room: GameState, avatarChoice: AvatarChoice, excludePlayerId: string): boolean {
    return room.players.some(
      p => p.playerId !== excludePlayerId && p.selectedAvatar === avatarChoice
    );
  }
}
