// The tables: the shared family table, a private practice table per device, computer players,
// people watching a game in progress, and moving a seat to another device.
import type { GameState, Player } from '../shared/types.ts';
import { AvatarChoice, MAX_PLAYERS } from '../shared/types.ts';
import { FAMILY_ROOM_ID, isSeated, nextBotName, practiceRoomId } from '../shared/players.ts';
import type { Ctx, GameSocket } from './context.ts';
import { cancelStartCountdown } from './flow.ts';
import { hasConnectedHuman } from './automation.ts';
import { broadcastState, sendState } from './view.ts';
import { saveTableSettingsSoon } from './settings.ts';

/** You may join the family table, or your own practice table, and nothing else. */
export function canJoinRoom(roomId: string, playerId: string): boolean {
  return roomId === FAMILY_ROOM_ID || roomId === practiceRoomId(playerId);
}

export function addBot(room: GameState): string | null {
  if (room.players.filter(isSeated).length >= MAX_PLAYERS) return `The table is full — ${MAX_PLAYERS} players max.`;
  room.players.push({
    playerId: `bot-${room.roomId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    selectedAvatar: AvatarChoice.UNDEFINED,
    isBot: true,
    botName: nextBotName(room.players),
    hand: [],
    tricksWon: 0
  });
  return null;
}

/** Moves a connected person's socket to another table and tells their device. */
function moveSocket(ctx: Ctx, player: Player, from: string, to: string): void {
  const socket = player.socketId ? (ctx.io.sockets.sockets.get(player.socketId) as GameSocket | undefined) : undefined;
  if (!socket) return;
  socket.leave(from);
  socket.join(to);
  socket.data.roomId = to;
  socket.data.watching = false;
  socket.emit('room_changed', { roomId: to });
}

/**
 * If the only person seated is playing against computer players, moves them and their
 * computer players to a private table (so the family table stays free) and returns it.
 * Otherwise returns the same room.
 */
export function moveSoloGameToPrivateTable(ctx: Ctx, room: GameState): GameState {
  if (room.isPractice) return room;
  const seated = room.players.filter(isSeated);
  const people = seated.filter((p) => !p.isBot);
  if (people.length !== 1 || seated.length < 2) return room;
  const [person] = people;

  const id = practiceRoomId(person.playerId);
  discardPracticeRoom(ctx, id); // any stale private table from before
  const practice = ctx.rooms.createRoom(id);
  practice.isPractice = true;
  practice.winningScore = room.winningScore;
  practice.gameSpeed = room.gameSpeed;
  practice.botDifficulty = room.botDifficulty;
  practice.players = seated;
  room.players = room.players.filter((p) => !seated.includes(p));
  moveSocket(ctx, person, room.roomId, id);
  return practice;
}

/**
 * Ends a private game and puts the person back at the family table, keeping their face
 * (if nobody has taken it) and, when the family lobby is otherwise empty, their computer players.
 */
export function returnToFamilyTable(ctx: Ctx, practice: GameState): void {
  const family = ctx.rooms.createRoom(FAMILY_ROOM_ID);
  const familyFree = family.state === 'lobby' || family.state === 'winner';
  const bots = practice.players.filter((p) => p.isBot);
  const people = practice.players.filter((p) => !p.isBot);
  discardPracticeRoom(ctx, practice.roomId);

  for (const person of people) {
    moveSocket(ctx, person, practice.roomId, FAMILY_ROOM_ID);
    // A game is under way at the family table: the device rejoins and watches it.
    if (!familyFree || person.disconnected) continue;
    family.players = family.players.filter((p) => p.playerId !== person.playerId);
    const faceTaken = ctx.rooms.isAvatarTaken(family, person.selectedAvatar, person.playerId);
    family.players.push({
      ...person,
      selectedAvatar: faceTaken ? AvatarChoice.UNDEFINED : person.selectedAvatar,
      hand: [],
      tricksWon: 0,
      bid: undefined
    });
  }

  const othersSeated = family.players.some((p) => isSeated(p) && !people.some((q) => q.playerId === p.playerId));
  if (familyFree && !othersSeated) {
    family.players = family.players.filter((p) => !p.isBot);
    for (const _ of bots) addBot(family);
    family.botDifficulty = practice.botDifficulty;
    saveTableSettingsSoon(ctx, family);
  }
  if (familyFree) cancelStartCountdown(ctx, family);
  broadcastState(ctx, family);
}

export function discardPracticeRoom(ctx: Ctx, roomId: string): void {
  const room = ctx.rooms.getRoom(roomId);
  if (!room) return;
  cancelStartCountdown(ctx, room);
  room.gameId = (room.gameId ?? 0) + 1; // stop any pending timers acting on it
  ctx.rooms.deleteRoom(roomId);
  ctx.roundLogs.delete(roomId);
  ctx.tallies.delete(roomId);
  ctx.botTurns.delete(roomId);
  ctx.absentTurns.delete(roomId);
  ctx.clearTimer(ctx.practiceCleanupTimers.get(roomId));
  ctx.practiceCleanupTimers.delete(roomId);
}

/** Faces currently busy in a private game, shown as "Practising" in the family lobby. */
export function practisingAvatars(ctx: Ctx): AvatarChoice[] {
  return ctx.rooms
    .allRooms()
    .filter((r) => r.isPractice && r.state !== 'lobby')
    .flatMap((r) => r.players.filter((p) => !p.isBot && !p.disconnected).map((p) => p.selectedAvatar))
    .filter((a) => a !== AvatarChoice.UNDEFINED);
}

/** Throws a practice table away once nobody has been connected to it for a while. */
export function schedulePracticeCleanup(ctx: Ctx, room: GameState): void {
  if (!room.isPractice) return;
  ctx.clearTimer(ctx.practiceCleanupTimers.get(room.roomId));
  ctx.practiceCleanupTimers.delete(room.roomId);
  if (hasConnectedHuman(room)) return;
  ctx.practiceCleanupTimers.set(
    room.roomId,
    ctx.setTimer(() => {
      ctx.practiceCleanupTimers.delete(room.roomId);
      const latest = ctx.rooms.getRoom(room.roomId);
      if (!latest || hasConnectedHuman(latest)) return;
      discardPracticeRoom(ctx, latest.roomId);
    }, ctx.timings.practiceIdleMs)
  );
}

/**
 * Someone arriving while a game is under way watches it: they get the live table (with every
 * hand hidden) but have no seat, so they can't act. Their device joins as a player when it ends.
 */
export function startWatching(ctx: Ctx, socket: GameSocket, room: GameState, playerId: string): void {
  socket.join(room.roomId);
  socket.data.roomId = room.roomId;
  socket.data.playerId = playerId;
  socket.data.watching = true;
  socket.emit('watching');
  sendState(ctx, socket, room);
}

/**
 * Moves an offline person's seat to the device that's watching (e.g. switching from a phone to a
 * tablet mid-game). The seat takes the new device's id everywhere in the room, so the old device,
 * if it comes back, simply watches.
 */
export function takeOverSeat(ctx: Ctx, socket: GameSocket, room: GameState, seat: Player): void {
  const fromId = seat.playerId;
  const toId = socket.data.playerId!;
  seat.playerId = toId;
  seat.hand.forEach((c) => (c.playerId = toId));
  room.currentTrick.forEach((c) => {
    if (c.playerId === fromId) c.playerId = toId;
  });
  room.completedTricks?.forEach((trick) => {
    if (trick.winnerId === fromId) trick.winnerId = toId;
    trick.cards.forEach((c) => {
      if (c.playerId === fromId) c.playerId = toId;
    });
  });
  seat.socketId = socket.id;
  seat.disconnected = false;
  seat.disconnectedAt = undefined;
  socket.data.watching = false;
}
