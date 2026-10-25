// Socket events from devices. Every action is attributed to the seat this connection joined as,
// never to ids sent by the device, and anything malformed is ignored rather than crashing the server.
import type { Socket } from 'socket.io';
import type { BotDifficulty, EmoteId, GameState, OwnedCard, Player } from '../shared/types.ts';
import { AvatarChoice, EMOTES, MAX_PLAYERS } from '../shared/types.ts';
import { FAMILY_ROOM_ID, MAX_GUEST_NAME_LENGTH, cleanGuestName, isPracticeRoomId, isSeated } from '../shared/players.ts';
import type { Ctx, GameSocket } from './context.ts';
import { isValidRoomId, isValidToken, publicIdFor } from './identity.ts';
import { applyBid, applyPlay, beginGame, beginStartCountdown, cancelStartCountdown, isActive, resetGame, startNextRound, startProblem } from './flow.ts';
import { autoMove, isAwaitingAbsentPlayer } from './automation.ts';
import {
  addBot,
  canJoinRoom,
  practisingAvatars,
  returnToFamilyTable,
  schedulePracticeCleanup,
  startWatching,
  takeOverSeat
} from './tables.ts';
import { broadcastState, nameOf, notifyRoom, sendState } from './view.ts';
import { saveTableSettingsSoon } from './settings.ts';

/** Sent with most events: which table the device thinks it's at. */
type RoomPayload = { roomId?: unknown };

export function registerSocketHandlers(ctx: Ctx, rawSocket: Socket): void {
  const socket = rawSocket as GameSocket;

  /** Registers a handler that tolerates a missing payload and logs (rather than throws) errors. */
  function on<T extends object>(event: string, handler: (payload: Partial<T>) => void): void {
    socket.on(event, (payload: unknown) => {
      try {
        handler(payload && typeof payload === 'object' ? (payload as Partial<T>) : {});
      } catch (err) {
        console.error(`Error handling "${event}"`, err);
      }
    });
  }

  /** The player this connection joined as, if it has a seat record at `roomId`. Watchers don't. */
  function currentSeat(roomId: unknown): { room: GameState; player: Player; index: number } | null {
    if (typeof roomId !== 'string' || socket.data.roomId !== roomId || !socket.data.playerId) return null;
    const room = ctx.rooms.getRoom(roomId);
    if (!room) return null;
    const index = room.players.findIndex((p) => p.playerId === socket.data.playerId);
    if (index === -1) return null;
    return { room, player: room.players[index], index };
  }

  /**
   * Leaves the table this connection is on (when the device switches tables).
   * Before a game your seat is freed; mid-game you're treated as offline so your turns get played.
   */
  function leaveRoom(): void {
    const seat = currentSeat(socket.data.roomId);
    if (socket.data.roomId) socket.leave(socket.data.roomId);
    socket.data.roomId = undefined;
    socket.data.watching = false;
    if (!seat) return;
    const { room, player } = seat;
    if (isActive(room)) {
      player.disconnected = true;
      player.disconnectedAt = Date.now();
      player.socketId = undefined;
    } else {
      room.players = room.players.filter((p) => p !== player);
      if (isSeated(player)) cancelStartCountdown(ctx, room, `Start cancelled: ${nameOf(player)} left the table.`);
    }
    schedulePracticeCleanup(ctx, room);
    broadcastState(ctx, room);
  }

  on<RoomPayload>('get_state', ({ roomId }) => {
    // Only for the table this connection is at (as a player or a watcher).
    if (typeof roomId !== 'string' || socket.data.roomId !== roomId) return;
    const room = ctx.rooms.getRoom(roomId);
    if (room) sendState(ctx, socket, room);
  });

  // --- Joining a table (also re-sent on every reconnect / tab focus) ---
  on<{ roomId: unknown; token: unknown }>('join_lobby', ({ roomId: requestedRoom, token }) => {
    if (!isValidRoomId(requestedRoom) || !isValidToken(token)) return;
    let roomId = requestedRoom;
    const playerId = publicIdFor(token);
    // A practice table that isn't ours (e.g. a tab still holding an old table name), or one that has
    // finished or been tidied away: back to the family table instead.
    if (isPracticeRoomId(roomId) && (!canJoinRoom(roomId, playerId) || !ctx.rooms.getRoom(roomId))) {
      const gameLost = canJoinRoom(roomId, playerId);
      roomId = FAMILY_ROOM_ID;
      socket.emit('room_changed', { roomId });
      if (gameLost) {
        socket.emit('notice', { message: 'Your game against the computer has ended (the server restarted). You can start a new one.' });
      }
    }
    if (!canJoinRoom(roomId, playerId)) {
      socket.emit('join_error', { message: "That table isn't available." });
      return;
    }
    // Switching tables (family <-> practice): leave the old one first.
    if (socket.data.roomId && socket.data.roomId !== roomId) leaveRoom();

    const existingRoom = ctx.rooms.getRoom(roomId);
    const existingPlayer = existingRoom?.players.find((p) => p.playerId === playerId);
    // A game is under way and you're not in it: watch until it finishes.
    if (existingRoom && isActive(existingRoom) && !existingPlayer) {
      startWatching(ctx, socket, existingRoom, playerId);
      return;
    }

    const changed = !existingPlayer || existingPlayer.disconnected || existingPlayer.socketId !== socket.id;
    ctx.rooms.joinPlayer(roomId, playerId, socket.id);
    const room = ctx.rooms.getRoom(roomId)!;
    socket.data.roomId = roomId;
    socket.data.playerId = playerId;
    socket.data.watching = false;
    socket.join(roomId);
    schedulePracticeCleanup(ctx, room);

    // Someone new arriving while the game is about to start: hold off so they can join in.
    if (!existingPlayer && room.state === 'lobby') {
      cancelStartCountdown(ctx, room, 'Start cancelled: someone new joined the lobby.');
    }

    // Only tell everyone when something they can see changed; periodic re-joins just refresh this device.
    if (changed) broadcastState(ctx, room);
    else sendState(ctx, socket, room);
  });

  // --- Picking (or giving up) a face in the lobby ---
  on<RoomPayload & { avatarChoice: unknown }>('select_avatar', ({ roomId, avatarChoice }) => {
    const seat = currentSeat(roomId);
    if (!seat) {
      socket.emit('avatar_selection_error', { message: 'You are not in this room. Refresh the page to rejoin.' });
      return;
    }
    const { room, player } = seat;
    if (room.state !== 'lobby' && room.state !== 'winner') return;

    // Giving up your seat (a face, or a guest seat).
    if (!avatarChoice || avatarChoice === AvatarChoice.UNDEFINED) {
      if (!isSeated(player)) return;
      cancelStartCountdown(ctx, room, `Start cancelled: ${nameOf(player)} left their seat.`);
      player.selectedAvatar = AvatarChoice.UNDEFINED;
      player.guestName = undefined;
      broadcastState(ctx, room);
      return;
    }
    const choice = avatarChoice as AvatarChoice;
    if (!Object.values(AvatarChoice).includes(choice)) return;
    if (room.roomId === FAMILY_ROOM_ID && practisingAvatars(ctx).includes(choice)) {
      socket.emit('avatar_selection_error', { message: 'They are practising against the computer right now.' });
      return;
    }
    if (ctx.rooms.isAvatarTaken(room, choice, player.playerId)) {
      socket.emit('avatar_selection_error', { message: 'Someone else is already playing as that person.' });
      return;
    }
    const seatedOthers = room.players.filter((p) => p.playerId !== player.playerId && isSeated(p)).length;
    if (seatedOthers >= MAX_PLAYERS) {
      socket.emit('avatar_selection_error', { message: `The table is full — ${MAX_PLAYERS} players max.` });
      return;
    }
    if (player.selectedAvatar === choice) return;
    player.selectedAvatar = choice;
    player.guestName = undefined;
    cancelStartCountdown(ctx, room, `Start cancelled: ${nameOf(player)} joined the table.`);
    broadcastState(ctx, room);
  });

  // --- Visitors: join under a name instead of a family face ---
  on<RoomPayload & { name: unknown }>('join_as_guest', ({ roomId, name }) => {
    const seat = currentSeat(roomId);
    if (!seat) return;
    const { room, player } = seat;
    if (room.state !== 'lobby' && room.state !== 'winner') return;
    const guestName = cleanGuestName(name);
    if (!guestName) {
      socket.emit('avatar_selection_error', {
        message: `Pick a name of up to ${MAX_GUEST_NAME_LENGTH} letters (family members: tap your picture instead).`
      });
      return;
    }
    if (room.players.some((p) => p !== player && p.guestName?.toLowerCase() === guestName.toLowerCase())) {
      socket.emit('avatar_selection_error', { message: `Someone is already playing as ${guestName}.` });
      return;
    }
    if (!isSeated(player) && room.players.filter(isSeated).length >= MAX_PLAYERS) {
      socket.emit('avatar_selection_error', { message: `The table is full — ${MAX_PLAYERS} players max.` });
      return;
    }
    if (player.guestName === guestName && player.selectedAvatar === AvatarChoice.UNDEFINED) return;
    player.guestName = guestName;
    player.selectedAvatar = AvatarChoice.UNDEFINED;
    cancelStartCountdown(ctx, room, `Start cancelled: ${guestName} joined the table.`);
    broadcastState(ctx, room);
  });

  // --- Table settings: anyone at the table can change them ---
  on<RoomPayload & { winningScore: unknown }>('set_winning_score', ({ roomId, winningScore }) => {
    const seat = currentSeat(roomId);
    if (!seat || seat.room.state !== 'lobby') return;
    const nextScore = Number(winningScore);
    if (!Number.isFinite(nextScore)) return;
    seat.room.winningScore = Math.max(1, Math.min(5, Math.floor(nextScore)));
    saveTableSettingsSoon(ctx, seat.room);
    broadcastState(ctx, seat.room);
  });

  on<RoomPayload & { gameSpeed: unknown }>('set_game_speed', ({ roomId, gameSpeed }) => {
    const seat = currentSeat(roomId);
    if (!seat) return;
    seat.room.gameSpeed = gameSpeed === 'slow' || gameSpeed === 'fast' ? gameSpeed : 'normal';
    saveTableSettingsSoon(ctx, seat.room);
    broadcastState(ctx, seat.room);
  });

  on<RoomPayload & { difficulty: unknown }>('set_bot_difficulty', ({ roomId, difficulty }) => {
    const seat = currentSeat(roomId);
    if (!seat || seat.room.state !== 'lobby') return;
    if (difficulty !== 'easy' && difficulty !== 'medium' && difficulty !== 'hard') return;
    seat.room.botDifficulty = difficulty as BotDifficulty;
    saveTableSettingsSoon(ctx, seat.room);
    broadcastState(ctx, seat.room);
  });

  on<RoomPayload>('reset_lobby', ({ roomId }) => {
    const seat = currentSeat(roomId);
    if (!seat || seat.room.state !== 'lobby') return;
    const { room } = seat;
    resetGame(ctx, room);
    room.players.forEach((player) => {
      player.selectedAvatar = AvatarChoice.UNDEFINED;
    });
    // Clearing the family table clears its computer players too; a practice table keeps them.
    if (!room.isPractice) room.players = room.players.filter((p) => !p.isBot);
    broadcastState(ctx, room);
  });

  // --- Computer players: anyone at the table can add or remove them before a game ---
  on<RoomPayload>('add_bot', ({ roomId }) => {
    const seat = currentSeat(roomId);
    if (!seat || (seat.room.state !== 'lobby' && seat.room.state !== 'winner')) return;
    const error = addBot(seat.room);
    if (error) {
      socket.emit('avatar_selection_error', { message: error });
      return;
    }
    cancelStartCountdown(ctx, seat.room, 'Start cancelled: a computer player joined the table.');
    broadcastState(ctx, seat.room);
  });

  on<RoomPayload & { playerId: unknown }>('remove_bot', ({ roomId, playerId }) => {
    const seat = currentSeat(roomId);
    if (!seat || (seat.room.state !== 'lobby' && seat.room.state !== 'winner')) return;
    const bot = seat.room.players.find((p) => p.playerId === playerId && p.isBot);
    if (!bot) return;
    seat.room.players = seat.room.players.filter((p) => p !== bot);
    cancelStartCountdown(ctx, seat.room, `Start cancelled: ${nameOf(bot)} left the table.`);
    broadcastState(ctx, seat.room);
  });

  // --- Start: shows everyone a 3 second countdown, then deals ---
  on<RoomPayload>('start_game', ({ roomId }) => {
    const seat = currentSeat(roomId);
    if (!seat) {
      socket.emit('start_game_error', { message: 'Room not found. Refresh the page to rejoin.' });
      return;
    }
    const { room, player } = seat;
    // Ignore double-taps and stale clients: only an idle lobby can start a countdown.
    if (room.state !== 'lobby' || room.startCountdown) return;
    if (!isSeated(player)) {
      socket.emit('start_game_error', { message: 'Tap your picture to join the game first.' });
      return;
    }
    const problem = startProblem(ctx, room);
    if (problem) {
      socket.emit('start_game_error', { message: problem });
      return;
    }
    beginStartCountdown(ctx, room);
    broadcastState(ctx, room);
  });

  on<RoomPayload>('cancel_start', ({ roomId }) => {
    const seat = currentSeat(roomId);
    if (!seat || seat.room.state !== 'lobby') return;
    if (cancelStartCountdown(ctx, seat.room, `${nameOf(seat.player)} cancelled the start.`)) broadcastState(ctx, seat.room);
  });

  // --- Moves ---
  on<RoomPayload & { card: unknown }>('playCard', ({ roomId, card }) => {
    const seat = currentSeat(roomId);
    if (!seat) return;
    const cardId = (card as OwnedCard | undefined)?.card?.id;
    const error = applyPlay(ctx, seat.room, seat.index, typeof cardId === 'string' ? cardId : undefined);
    if (error) socket.emit('play_card_error', { message: error });
  });

  on<RoomPayload & { bid: unknown }>('submit_bid', ({ roomId, bid }) => {
    const seat = currentSeat(roomId);
    if (!seat) return;
    const error = applyBid(ctx, seat.room, seat.index, Number(bid));
    if (error) socket.emit('bid_error', { message: error });
  });

  // Anyone at the table can make an offline player's move straight away instead of waiting.
  on<RoomPayload>('play_for_absent', ({ roomId }) => {
    const seat = currentSeat(roomId);
    if (!seat || !isAwaitingAbsentPlayer(seat.room)) return;
    ctx.absentTurns.delete(seat.room.roomId);
    autoMove(ctx, seat.room);
  });

  // --- Emotes: a fixed set of quick reactions, shown to the table as a speech bubble ---
  let lastEmoteAt = 0;
  on<RoomPayload & { emote: unknown }>('emote', ({ roomId, emote }) => {
    const seat = currentSeat(roomId);
    if (!seat || typeof emote !== 'string' || !Object.prototype.hasOwnProperty.call(EMOTES, emote)) return;
    const now = Date.now();
    if (now - lastEmoteAt < 1500) return; // no spamming
    lastEmoteAt = now;
    ctx.io.to(seat.room.roomId).emit('emote', { playerId: seat.player.playerId, emote: emote as EmoteId });
  });

  // --- Between rounds and after the game ---
  // Skip the round summary early (the server also advances automatically).
  on<RoomPayload>('next_round', ({ roomId }) => {
    const seat = currentSeat(roomId);
    if (!seat || seat.room.state !== 'round_end') return;
    startNextRound(ctx, seat.room, false);
    broadcastState(ctx, seat.room);
  });

  on<RoomPayload>('cancel_game', ({ roomId }) => {
    const seat = currentSeat(roomId);
    if (!seat) return;
    if (seat.room.isPractice) {
      returnToFamilyTable(ctx, seat.room);
      return;
    }
    resetGame(ctx, seat.room);
    broadcastState(ctx, seat.room);
  });

  on<RoomPayload>('rematch_game', ({ roomId }) => {
    const seat = currentSeat(roomId);
    if (!seat || seat.room.state !== 'winner') return;
    const error = beginGame(ctx, seat.room);
    if (error) socket.emit('start_game_error', { message: error });
    broadcastState(ctx, seat.room);
  });

  // --- Watching: carry on an offline person's seat from this device ---
  on<RoomPayload & { playerId: unknown }>('take_seat', ({ roomId, playerId }) => {
    if (!socket.data.watching || typeof roomId !== 'string' || socket.data.roomId !== roomId) return;
    const room = ctx.rooms.getRoom(roomId);
    if (!room || !isActive(room) || !socket.data.playerId) return;
    if (room.players.some((p) => p.playerId === socket.data.playerId)) return; // already has a seat
    const seat = room.players.find((p) => p.playerId === playerId && !p.isBot && p.disconnected);
    if (!seat) {
      socket.emit('notice', { message: "That seat isn't free to take over (they may be back)." });
      return;
    }
    takeOverSeat(ctx, socket, room, seat);
    notifyRoom(ctx, room, `${nameOf(seat)} is carrying on from another device.`);
    broadcastState(ctx, room);
  });

  // --- Disconnects ---
  socket.on('disconnect', () => {
    const result = ctx.rooms.findPlayerBySocketId(socket.id);
    if (!result) return;
    const { room, player } = result;
    player.disconnected = true;
    player.disconnectedAt = Date.now();
    if (isSeated(player)) cancelStartCountdown(ctx, room, `Start cancelled: ${nameOf(player)} lost connection.`);
    schedulePracticeCleanup(ctx, room);
    broadcastState(ctx, room);

    // A player who leaves the lobby and doesn't come back gives their seat up, so a closed tab
    // can't be dealt into the next game and stall it. Checked against the time they left, so an
    // older timer can't remove someone who has since reconnected and dropped again.
    if (room.state === 'lobby') {
      const graceMs = ctx.timings.lobbySeatGraceMs;
      ctx.setTimer(() => {
        const latest = ctx.rooms.getRoom(room.roomId);
        if (!latest || latest.state !== 'lobby') return;
        const gone = latest.players.find((p) => p.playerId === player.playerId);
        // (100ms of slack: timers can fire a touch early by Date.now()'s reckoning.)
        if (!gone?.disconnected || Date.now() - (gone.disconnectedAt ?? 0) < graceMs - 100) return;
        latest.players = latest.players.filter((p) => p !== gone);
        broadcastState(ctx, latest);
      }, graceMs);
    }
  });
}
