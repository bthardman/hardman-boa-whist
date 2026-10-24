// What each device is sent: the room as that viewer is allowed to see it.
import type { GameState, Player } from '../shared/types.ts';
import { FAMILY_ROOM_ID, displayName } from '../shared/players.ts';
import type { Ctx, GameSocket } from './context.ts';
import { scheduleAbandonCheck, scheduleAbsentAutoplay, scheduleBotTurn } from './automation.ts';
import { practisingAvatars } from './tables.ts';

/**
 * The room as `viewerId` may see it: their own hand in full, everyone else's hand as face-down
 * placeholders (so card counts still work), and nothing server-only (socket ids, timestamps).
 */
export function viewFor(ctx: Ctx, room: GameState, viewerId: string | undefined): GameState {
  const hide = (player: Player): Player => {
    const { socketId: _socketId, disconnectedAt: _disconnectedAt, ...rest } = player;
    if (player.playerId === viewerId) return { ...rest };
    return {
      ...rest,
      hand: player.hand.map((_, i) => ({
        card: { suit: 'hidden', value: '', id: `hidden-${player.playerId}-${i}` },
        playerId: player.playerId
      }))
    };
  };
  return {
    ...room,
    players: room.players.map(hide),
    winner: room.winner ? hide(room.winner) : undefined,
    practising: room.roomId === FAMILY_ROOM_ID ? practisingAvatars(ctx) : undefined,
    viewerId,
    serverNow: Date.now()
  };
}

export function sendState(ctx: Ctx, socket: GameSocket, room: GameState): void {
  socket.emit('state_updated', viewFor(ctx, room, socket.data.playerId));
}

/** Sends every device at the table (players and watchers) its own view of the room. */
export function broadcastState(ctx: Ctx, room: GameState): void {
  // Every change is a chance that it's now an offline or computer player's turn, or that the
  // last person has gone.
  scheduleAbsentAutoplay(ctx, room);
  scheduleBotTurn(ctx, room);
  scheduleAbandonCheck(ctx, room);
  const members = ctx.io.sockets.adapter.rooms.get(room.roomId);
  if (!members) return;
  for (const socketId of members) {
    const socket = ctx.io.sockets.sockets.get(socketId) as GameSocket | undefined;
    if (socket) sendState(ctx, socket, room);
  }
}

/** A short message shown to everyone at the table (e.g. "Start cancelled"). */
export function notifyRoom(ctx: Ctx, room: GameState, message: string): void {
  ctx.io.to(room.roomId).emit('notice', { message });
}

export function nameOf(player: Player | undefined): string {
  return player ? displayName(player) : 'A player';
}
