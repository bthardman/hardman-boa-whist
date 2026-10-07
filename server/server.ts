import express from 'express';
import http from 'http';
import { Server, type Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import type { BotDifficulty, EmoteId, GameState, OwnedCard, Player } from '../shared/types.ts';
import { AvatarChoice, EMOTES, MAX_PLAYERS } from '../shared/types.ts';
import { RoomManager } from './utils/roomManager.ts';
import { createDeck, cardValue } from './utils/cardUtils.ts';
import { calculateTrickWinner, canPlayCard, dealCards } from './utils/gameLogic.ts';
import { GameStateMachine } from './utils/gameStateMachine.ts';
import { calculateRoundScores, updateTotalScores, checkGameEnd, findGameWinner, checkRoundEnd } from './utils/scoreCalculator.ts';
import { isValidBid } from './utils/biddingRules.ts';
import { FAMILY_ROOM_ID, displayName, isPracticeRoomId, isSeated, nextBotName, practiceRoomId } from '../shared/players.ts';
import { chooseMove, type RoundLogEntry } from './bot/index.ts';

const app = express();
const server = http.createServer(app);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
];

/**
 * Exact matches from the allow-list, plus "https://*.example.com" entries matching any
 * subdomain (e.g. Cloudflare Pages preview builds at <hash>.hardman-boa-whist.pages.dev).
 */
function isAllowedOrigin(origin: string): boolean {
  return allowedOrigins.some((allowed) => {
    if (allowed === origin) return true;
    const wildcard = allowed.match(/^(https?:\/\/)\*\.(.+)$/);
    if (!wildcard) return false;
    const [, scheme, domain] = wildcard;
    return origin.startsWith(scheme) && origin.slice(scheme.length).endsWith(`.${domain}`);
  });
}

/** How long a player who drops out of the lobby keeps their seat before it is released. */
const LOBBY_SEAT_GRACE_MS = 30_000;
/** Countdown shown to everyone between pressing Start and the first deal. */
const START_COUNTDOWN_MS = 3_000;
/** How long the table waits for an offline player before playing their turn for them. */
const ABSENT_AUTOPLAY_MS = 20_000;
/** A computer player's "thinking" pause before it moves (scaled by game pace, plus a little randomness). */
const BOT_THINK_MS = 1_100;
/** A practice table with nobody connected is thrown away after this long. */
const PRACTICE_IDLE_MS = 10 * 60_000;

const io = new Server(server, {
  // Cross-origin access (e.g. the Vite dev server on :5173) is limited to the allow-list.
  cors: { origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)), methods: ['GET', 'POST'] },
  // Same-origin connections (the built app served by this server) are always allowed,
  // so the deploy no longer depends on CORS_ORIGIN being set to the site's own URL.
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (!origin) return callback(null, true);
    try {
      if (new URL(origin).host === req.headers.host) return callback(null, true);
    } catch {
      /* malformed origin header: fall through to the allow-list */
    }
    callback(null, isAllowedOrigin(origin));
  }
});

// A tiny "are you awake?" check. The front end (hosted separately) calls /awake to wake a sleeping
// free-tier server (ad blockers sometimes block "/health"); Render uses /health as its health check.
app.get(['/health', '/awake'], (req, res) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});

// Serve the built frontend when available (useful for single-service Render deploys).
app.use(express.static(distPath));
app.get(/^(?!\/socket\.io).*/, (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const roomManager = new RoomManager();

type SocketData = { roomId?: string; playerId?: string };
type GameSocket = Socket & { data: SocketData };

// ---------------------------------------------------------------------------
// State broadcasting
// ---------------------------------------------------------------------------

/**
 * Builds the view of the room that a given player is allowed to see:
 * their own hand in full, everyone else's hand as face-down placeholders
 * (so card counts still work), and no socket ids.
 */
function viewFor(room: GameState, viewerId: string | undefined): GameState {
  const hide = (player: Player): Player => {
    const { socketId: _socketId, ...rest } = player;
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
    practising: room.roomId === FAMILY_ROOM_ID ? practisingAvatars() : undefined
  };
}

function sendState(socket: GameSocket, room: GameState): void {
  socket.emit('state_updated', viewFor(room, socket.data.playerId));
}

function broadcastState(room: GameState): void {
  // Every state change is a chance that it's now an offline player's (or a computer player's) turn.
  scheduleAbsentAutoplay(room);
  scheduleBotTurn(room);
  const members = io.sockets.adapter.rooms.get(room.roomId);
  if (members) {
    for (const socketId of members) {
      const s = io.sockets.sockets.get(socketId) as GameSocket | undefined;
      if (s) sendState(s, room);
    }
  }
}

/** A short message shown to everyone in the room (e.g. "Start cancelled"). */
function notifyRoom(room: GameState, message: string): void {
  io.to(room.roomId).emit('notice', { message });
}

function nameOf(player: Player | undefined): string {
  return player ? displayName(player) : 'A player';
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function speedMultiplier(speed: string | undefined): number {
  if (speed === 'slow') return 1.35;
  if (speed === 'fast') return 0.7;
  return 1;
}

function scaleRoomMs(room: { gameSpeed?: string }, ms: number): number {
  return Math.max(120, Math.round(ms * speedMultiplier(room.gameSpeed)));
}

/**
 * Runs `fn` after a delay, but only if the room is still on the same game.
 * Prevents a timer from an abandoned game (cancel / rematch) acting on the next one.
 */
function afterDelay(room: GameState, ms: number, fn: (latest: GameState) => void, scale = true): void {
  const gameId = room.gameId;
  setTimeout(
    () => {
      const latest = roomManager.getRoom(room.roomId);
      if (!latest || latest.gameId !== gameId) return;
      fn(latest);
    },
    scale ? scaleRoomMs(room, ms) : ms
  );
}

/**
 * Every card played this round, in order. Public information (everyone saw them played),
 * kept on the server only so computer players can remember what's gone and who is out of a suit.
 */
const roundLogs = new Map<string, RoundLogEntry[]>();

function startNextRound(room: GameState, isInitialStart = false): void {
  room.roundNumber++;
  roundLogs.set(room.roomId, []);
  room.completedTricks = [];
  dealCards(createDeck(), room.players, 7);

  // Rotate the first player clockwise after each completed round (not before the very first round).
  if (!isInitialStart) {
    room.firstPlayer = (room.firstPlayer + 1) % room.players.length;
  }

  room.currentTrick = [];
  room.roundEndsAt = undefined;
  GameStateMachine.transition(room, 'bidding');
  room.currentPlayer = room.firstPlayer;
}

function finishRoundAndAdvanceOrEnd(room: GameState): void {
  updateTotalScores(room, calculateRoundScores(room));

  if (checkGameEnd(room)) {
    const winner = findGameWinner(room);
    if (winner) {
      room.winner = winner;
      GameStateMachine.transition(room, 'winner');
    }
    broadcastState(room);
    return;
  }

  GameStateMachine.transition(room, 'round_end');
  room.roundEndsAt = Date.now() + scaleRoomMs(room, 15000);
  broadcastState(room);

  // Auto-advance after showing round scores briefly.
  const roundToAdvance = room.roundNumber;
  afterDelay(room, 15000, (latest) => {
    if (latest.state !== 'round_end' || latest.roundNumber !== roundToAdvance) return;
    startNextRound(latest, false);
    broadcastState(latest);
  });
}

/** Clears all per-game state and bumps gameId so stale timers are ignored. */
function resetGame(room: GameState): void {
  cancelStartCountdown(room);
  room.gameId = (room.gameId ?? 0) + 1;
  room.state = 'lobby';
  room.roundNumber = 0;
  room.currentPlayer = 0;
  room.firstPlayer = 0;
  room.currentTrick = [];
  room.completedTricks = [];
  room.winner = undefined;
  room.roundEndsAt = undefined;
  room.scoreboard = {};
  room.players.forEach((p) => {
    p.hand = [];
    p.tricksWon = 0;
    p.bid = undefined;
  });
}

/**
 * Removes players without an avatar (spectators) before a game begins and tells them why.
 * Scores are keyed by seat index, so this must only happen before the first deal.
 */
function removeSpectators(room: GameState): void {
  const spectators = room.players.filter((p) => !isSeated(p));
  if (spectators.length === 0) return;
  const ids = new Set(spectators.map((p) => p.playerId));
  room.players = room.players.filter((p) => !ids.has(p.playerId));
  spectators.forEach((p) => {
    const s = p.socketId ? io.sockets.sockets.get(p.socketId) : undefined;
    if (s) {
      s.emit('join_error', { message: 'The game started before you picked a player. You can join the next one.' });
      s.leave(room.roomId);
    }
  });
}

function startProblem(room: GameState): string | null {
  if (!room.players.some((p) => !p.isBot && isSeated(p))) return 'Pick your picture to join the game first.';
  if (!roomManager.canStartGame(room)) return 'At least 2 players need to pick an avatar to start.';
  const seated = room.players.filter(isSeated).length;
  if (seated > MAX_PLAYERS) return `A game can have at most ${MAX_PLAYERS} players.`;
  return null;
}

/** Shared by start and rematch: returns an error message, or null once the first round is dealt. */
function beginGame(room: GameState): string | null {
  resetGame(room);
  const problem = startProblem(room);
  if (problem) return problem;
  removeSpectators(room);
  startNextRound(room, true);
  return null;
}

// ---------------------------------------------------------------------------
// Start countdown (lobby -> 3, 2, 1 -> deal)
// ---------------------------------------------------------------------------

const startTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelStartCountdown(room: GameState, reason?: string): boolean {
  const timer = startTimers.get(room.roomId);
  if (timer) clearTimeout(timer);
  startTimers.delete(room.roomId);
  if (!room.startCountdown) return false;
  room.startCountdown = undefined;
  if (reason) notifyRoom(room, reason);
  return true;
}

function beginStartCountdown(room: GameState): void {
  const id = Date.now();
  room.startCountdown = {
    id,
    durationMs: START_COUNTDOWN_MS,
    playerIds: room.players.filter(isSeated).map((p) => p.playerId)
  };
  startTimers.set(
    room.roomId,
    setTimeout(() => {
      startTimers.delete(room.roomId);
      const latest = roomManager.getRoom(room.roomId);
      if (!latest || latest.state !== 'lobby' || latest.startCountdown?.id !== id) return;
      latest.startCountdown = undefined;
      // One person against computer players plays on a private table, so the family table stays free.
      const game = moveSoloGameToPrivateTable(latest);
      const error = beginGame(game);
      if (error) notifyRoom(game, error);
      broadcastState(game);
      if (game !== latest) broadcastState(latest);
    }, START_COUNTDOWN_MS)
  );
}

// ---------------------------------------------------------------------------
// Moves (shared by players and the offline auto-player)
// ---------------------------------------------------------------------------

/** Places a bid for the player at `playerIndex`. Returns an error message, or null on success. */
function applyBid(room: GameState, playerIndex: number, bid: number): string | null {
  const player = room.players[playerIndex];
  if (!player || room.state !== 'bidding' || room.currentPlayer !== playerIndex || typeof player.bid === 'number') {
    return "It isn't your turn to bid.";
  }
  if (!Number.isInteger(bid)) return 'Bid must be a whole number.';
  const validation = isValidBid(room, playerIndex, bid);
  if (!validation.valid) return validation.message || 'Invalid bid.';

  player.bid = bid;

  // Next player (clockwise) who hasn't bid yet.
  let nextIdx = -1;
  for (let i = 1; i <= room.players.length; i++) {
    const checkIdx = (playerIndex + i) % room.players.length;
    if (typeof room.players[checkIdx].bid !== 'number') {
      nextIdx = checkIdx;
      break;
    }
  }
  if (nextIdx === -1) {
    GameStateMachine.transition(room, 'tricks');
    room.currentPlayer = room.firstPlayer;
  } else {
    room.currentPlayer = nextIdx;
  }
  broadcastState(room);
  return null;
}

/** Plays a card (by id) for the player at `playerIndex`. Returns an error message, or null on success. */
function applyPlay(room: GameState, playerIndex: number, cardId: string | undefined): string | null {
  const player = room.players[playerIndex];
  if (!player || room.state !== 'tricks' || room.currentPlayer !== playerIndex) return "It isn't your turn yet.";
  if (room.currentTrick.length >= room.players.length) return 'Wait for the trick to finish.';

  // Use the server's copy of the card: only the id is trusted from the client.
  const cardInHand = player.hand.find((c) => c.card.id === cardId);
  if (!cardInHand) return "That card isn't in your hand.";
  if (!canPlayCard(cardInHand, player.hand, room.currentTrick)) return 'You must follow suit if you can.';

  player.hand = player.hand.filter((c) => c.card.id !== cardInHand.card.id);
  const ledSuit = room.currentTrick[0]?.card.suit ?? cardInHand.card.suit;
  roundLogs.get(room.roomId)?.push({ seat: playerIndex, card: cardInHand.card, ledSuit });
  room.currentTrick.push(cardInHand);

  if (room.currentTrick.length < room.players.length) {
    room.currentPlayer = (playerIndex + 1) % room.players.length;
    broadcastState(room);
    return null;
  }

  // Trick complete: award it, then let clients see the cards briefly before clearing.
  const winnerIndex = calculateTrickWinner(room.currentTrick, room.players);
  if (winnerIndex !== -1) {
    (room.completedTricks ??= []).push({ winnerId: room.players[winnerIndex].playerId, cards: room.currentTrick.slice() });
    room.players[winnerIndex].tricksWon++;
    room.currentPlayer = winnerIndex;
  }
  broadcastState(room);

  const trickRound = room.roundNumber;
  afterDelay(room, 5000, (latest) => {
    if (latest.roundNumber !== trickRound) return;
    if (latest.currentTrick.length !== latest.players.length) return;
    latest.currentTrick = [];
    if (checkRoundEnd(latest)) {
      finishRoundAndAdvanceOrEnd(latest);
      return;
    }
    broadcastState(latest);
  });
  return null;
}

// ---------------------------------------------------------------------------
// Offline players: play their turn for them so the table never stalls
// ---------------------------------------------------------------------------

/** Identifies "this exact turn", so a scheduled auto-play is dropped if anything has moved on. */
function turnKey(room: GameState): string {
  return [room.gameId, room.state, room.roundNumber, room.currentPlayer, room.currentTrick.length, room.players[room.currentPlayer]?.hand.length].join(':');
}

function isAwaitingAbsentPlayer(room: GameState): boolean {
  if (room.state !== 'bidding' && room.state !== 'tricks') return false;
  if (room.state === 'tricks' && room.currentTrick.length >= room.players.length) return false;
  return !!room.players[room.currentPlayer]?.disconnected;
}

/**
 * Plays the current player's turn for them (offline players and computer players) using the
 * computer player's judgement. The move goes through applyBid / applyPlay, so it is checked
 * like any other. If that ever fails, falls back to a simple safe move.
 */
function autoMove(room: GameState): void {
  const idx = room.currentPlayer;
  // Computer players play at the table's difficulty; an offline person gets sensible, mistake-free moves.
  const difficulty = room.players[idx]?.isBot ? (room.botDifficulty ?? 'medium') : 'medium';
  let move: ReturnType<typeof chooseMove> = null;
  try {
    move = chooseMove(room, idx, roundLogs.get(room.roomId) ?? [], difficulty);
  } catch (err) {
    console.error('Computer player failed to choose a move', err);
  }
  const error = !move ? 'no move' : move.kind === 'bid' ? applyBid(room, idx, move.bid) : applyPlay(room, idx, move.cardId);
  if (error) {
    console.error(`Computer move rejected (${error}); playing a safe move instead.`);
    safeMove(room);
  }
}

/** A simple, safe move: the lowest legal bid, or the lowest legal card. */
function safeMove(room: GameState): void {
  const idx = room.currentPlayer;
  const player = room.players[idx];
  if (!player) return;
  if (room.state === 'bidding') {
    for (let bid = 0; bid <= 7; bid++) if (isValidBid(room, idx, bid).valid) {
      applyBid(room, idx, bid);
      break;
    }
  } else if (room.state === 'tricks') {
    const legal = player.hand
      .filter((c) => canPlayCard(c, player.hand, room.currentTrick))
      .sort((a, b) => cardValue(a.card.value) - cardValue(b.card.value) || (a.card.suit === 'hearts' ? 1 : -1));
    if (legal[0]) applyPlay(room, idx, legal[0].card.id);
  }
}

const absentTimers = new Map<string, string>();

function scheduleAbsentAutoplay(room: GameState): void {
  if (!isAwaitingAbsentPlayer(room)) {
    room.absentTurnDeadline = undefined;
    absentTimers.delete(room.roomId);
    return;
  }
  const key = turnKey(room);
  if (absentTimers.get(room.roomId) === key) return; // already scheduled for this turn
  absentTimers.set(room.roomId, key);
  room.absentTurnDeadline = Date.now() + ABSENT_AUTOPLAY_MS;
  afterDelay(
    room,
    ABSENT_AUTOPLAY_MS,
    (latest) => {
      if (turnKey(latest) !== key || !isAwaitingAbsentPlayer(latest)) return;
      absentTimers.delete(latest.roomId);
      autoMove(latest);
    },
    false
  );
}

// ---------------------------------------------------------------------------
// Computer players: take their turn after a short pause
// ---------------------------------------------------------------------------

const botTimers = new Map<string, string>();

function hasConnectedHuman(room: GameState): boolean {
  return room.players.some((p) => !p.isBot && !p.disconnected);
}

function isAwaitingBot(room: GameState): boolean {
  if (room.state !== 'bidding' && room.state !== 'tricks') return false;
  if (room.state === 'tricks' && room.currentTrick.length >= room.players.length) return false;
  // Nobody watching: pause rather than let the bots play the whole game alone.
  return !!room.players[room.currentPlayer]?.isBot && hasConnectedHuman(room);
}

function scheduleBotTurn(room: GameState): void {
  if (!isAwaitingBot(room)) {
    botTimers.delete(room.roomId);
    return;
  }
  const key = turnKey(room);
  if (botTimers.get(room.roomId) === key) return; // already scheduled for this turn
  botTimers.set(room.roomId, key);
  const thinkMs = BOT_THINK_MS * (0.8 + Math.random() * 0.5);
  afterDelay(room, thinkMs, (latest) => {
    if (turnKey(latest) !== key || !isAwaitingBot(latest)) return;
    botTimers.delete(latest.roomId);
    autoMove(latest);
  });
}

// ---------------------------------------------------------------------------
// Rooms: the family table, plus a private practice table per device
// ---------------------------------------------------------------------------

/** You may join the family table, or your own practice table, and nothing else. */
function canJoinRoom(roomId: string, playerId: string): boolean {
  return roomId === FAMILY_ROOM_ID || roomId === practiceRoomId(playerId);
}

function addBot(room: GameState): string | null {
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
function moveSocket(player: Player, from: string, to: string): void {
  const s = player.socketId ? (io.sockets.sockets.get(player.socketId) as GameSocket | undefined) : undefined;
  if (!s) return;
  s.leave(from);
  s.join(to);
  s.data.roomId = to;
  s.emit('room_changed', { roomId: to });
}

/**
 * If the only person seated is playing against computer players, moves them and their
 * computer players to a private table (so the family table stays free) and returns it.
 * Otherwise returns the same room.
 */
function moveSoloGameToPrivateTable(room: GameState): GameState {
  if (room.isPractice) return room;
  const seated = room.players.filter(isSeated);
  const people = seated.filter((p) => !p.isBot);
  if (people.length !== 1 || seated.length < 2) return room;
  const [person] = people;

  const id = practiceRoomId(person.playerId);
  discardPracticeRoom(id); // any stale private table from before
  const practice = roomManager.createRoom(id);
  practice.isPractice = true;
  practice.winningScore = room.winningScore;
  practice.gameSpeed = room.gameSpeed;
  practice.botDifficulty = room.botDifficulty;
  practice.players = seated;
  room.players = room.players.filter((p) => !seated.includes(p));
  moveSocket(person, room.roomId, id);
  return practice;
}

/**
 * Ends a private game and puts the person back at the family table, keeping their face
 * (if nobody has taken it) and, when the family lobby is otherwise empty, their computer players.
 */
function returnToFamilyTable(practice: GameState): void {
  const family = roomManager.createRoom(FAMILY_ROOM_ID);
  const familyFree = family.state === 'lobby' || family.state === 'winner';
  const bots = practice.players.filter((p) => p.isBot);
  const people = practice.players.filter((p) => !p.isBot);
  discardPracticeRoom(practice.roomId);

  for (const person of people) {
    moveSocket(person, practice.roomId, FAMILY_ROOM_ID);
    // A game is under way at the family table: the device rejoins and is told to wait.
    if (!familyFree || person.disconnected) continue;
    family.players = family.players.filter((p) => p.playerId !== person.playerId);
    const faceTaken = roomManager.isAvatarTaken(family, person.selectedAvatar, person.playerId);
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
  }
  if (familyFree) cancelStartCountdown(family);
  broadcastState(family);
}

function discardPracticeRoom(roomId: string): void {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  cancelStartCountdown(room);
  room.gameId = (room.gameId ?? 0) + 1; // stop any pending timers acting on it
  roomManager.deleteRoom(roomId);
  roundLogs.delete(roomId);
  botTimers.delete(roomId);
  absentTimers.delete(roomId);
  clearTimeout(practiceCleanupTimers.get(roomId));
  practiceCleanupTimers.delete(roomId);
}

/** Faces currently busy in a private game, shown as "Practising" in the family lobby. */
function practisingAvatars(): AvatarChoice[] {
  return roomManager
    .allRooms()
    .filter((r) => r.isPractice && r.state !== 'lobby')
    .flatMap((r) => r.players.filter((p) => !p.isBot && !p.disconnected).map((p) => p.selectedAvatar))
    .filter((a) => a !== AvatarChoice.UNDEFINED);
}

const practiceCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Throws a practice table away once nobody has been connected to it for a while. */
function schedulePracticeCleanup(room: GameState): void {
  if (!room.isPractice) return;
  clearTimeout(practiceCleanupTimers.get(room.roomId));
  if (hasConnectedHuman(room)) {
    practiceCleanupTimers.delete(room.roomId);
    return;
  }
  practiceCleanupTimers.set(
    room.roomId,
    setTimeout(() => {
      practiceCleanupTimers.delete(room.roomId);
      const latest = roomManager.getRoom(room.roomId);
      if (!latest || hasConnectedHuman(latest)) return;
      discardPracticeRoom(latest.roomId);
    }, PRACTICE_IDLE_MS)
  );
}

// ---------------------------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------------------------

io.on('connection', (rawSocket) => {
  const socket = rawSocket as GameSocket;
  console.log('Client connected', socket.id);

  /** The player this socket joined as. Actions are always attributed to this, never to client-supplied ids. */
  function currentSeat(roomId: string): { room: GameState; player: Player; index: number } | null {
    const room = roomManager.getRoom(roomId);
    if (!room || socket.data.roomId !== roomId || !socket.data.playerId) return null;
    const index = room.players.findIndex((p) => p.playerId === socket.data.playerId);
    if (index === -1) return null;
    return { room, player: room.players[index], index };
  }

  socket.on('get_state', ({ roomId }: { roomId: string }) => {
    const room = roomManager.getRoom(roomId);
    if (room) sendState(socket, room);
  });

  // --- Player joins lobby (also re-sent on every reconnect / tab focus) ---
  socket.on('join_lobby', ({ roomId, playerId }: { roomId: string; playerId: string }) => {
    if (typeof roomId !== 'string' || typeof playerId !== 'string' || !roomId || !playerId) return;
    if (!canJoinRoom(roomId, playerId)) {
      socket.emit('join_error', { message: "That table isn't available." });
      return;
    }
    // A private game that has since finished or been tidied away: back to the family table.
    if (isPracticeRoomId(roomId) && !roomManager.getRoom(roomId)) {
      roomId = FAMILY_ROOM_ID;
      socket.emit('room_changed', { roomId });
      socket.emit('notice', { message: 'Your game against the computer has ended (the server restarted). You can start a new one.' });
    }
    // Switching tables (family <-> practice): leave the old one first.
    if (socket.data.roomId && socket.data.roomId !== roomId) leaveRoom();
    const existingRoom = roomManager.getRoom(roomId);
    const existingPlayer = existingRoom?.players.find((p) => p.playerId === playerId);
    const isActiveGame = existingRoom && existingRoom.state !== 'lobby' && existingRoom.state !== 'winner';
    if (isActiveGame && !existingPlayer) {
      socket.emit('join_error', {
        message: 'A game is already in progress. You can join when it finishes.'
      });
      return;
    }

    const changed = !existingPlayer || existingPlayer.disconnected || existingPlayer.socketId !== socket.id;
    roomManager.joinPlayer(roomId, playerId, socket.id);
    const room = roomManager.getRoom(roomId)!;

    schedulePracticeCleanup(room);
    socket.data.roomId = roomId;
    socket.data.playerId = playerId;
    socket.join(roomId);

    // Someone new arriving while the game is about to start: hold off so they can join in.
    if (!existingPlayer && room.state === 'lobby') {
      cancelStartCountdown(room, 'Start cancelled: someone new joined the lobby.');
    }

    // Only tell everyone when something they can see changed; periodic re-joins just refresh this client.
    if (changed) broadcastState(room);
    else sendState(socket, room);
  });

  // --- Player selects avatar ---
  socket.on('select_avatar', ({ roomId, avatarChoice }: { roomId: string; avatarChoice: AvatarChoice }) => {
    const seat = currentSeat(roomId);
    if (!seat) {
      socket.emit('avatar_selection_error', { message: 'You are not in this room. Refresh the page to rejoin.' });
      return;
    }
    const { room, player } = seat;
    if (room.state !== 'lobby' && room.state !== 'winner') return;

    const clearingAvatar = !avatarChoice || avatarChoice === AvatarChoice.UNDEFINED;
    if (clearingAvatar) {
      if (player.selectedAvatar === AvatarChoice.UNDEFINED) return;
      cancelStartCountdown(room, `Start cancelled: ${nameOf(player)} left their seat.`);
      player.selectedAvatar = AvatarChoice.UNDEFINED;
      broadcastState(room);
      return;
    }

    if (!Object.values(AvatarChoice).includes(avatarChoice)) return;

    if (room.roomId === FAMILY_ROOM_ID && practisingAvatars().includes(avatarChoice)) {
      socket.emit('avatar_selection_error', { message: 'They are practising against the computer right now.' });
      return;
    }
    if (roomManager.isAvatarTaken(room, avatarChoice, player.playerId)) {
      socket.emit('avatar_selection_error', { message: 'Someone else is already playing as that person.' });
      return;
    }

    const seated = room.players.filter((p) => p.playerId !== player.playerId && isSeated(p)).length;
    if (seated >= MAX_PLAYERS) {
      socket.emit('avatar_selection_error', { message: `The table is full — ${MAX_PLAYERS} players max.` });
      return;
    }

    if (player.selectedAvatar === avatarChoice) return;
    player.selectedAvatar = avatarChoice;
    cancelStartCountdown(room, `Start cancelled: ${nameOf(player)} joined the table.`);
    broadcastState(room);
  });

  socket.on('set_winning_score', ({ roomId, winningScore }: { roomId: string; winningScore: number }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.state !== 'lobby') return;
    const nextScore = Number(winningScore);
    if (!Number.isFinite(nextScore)) return;
    room.winningScore = Math.max(1, Math.min(5, Math.floor(nextScore)));
    broadcastState(room);
  });

  socket.on('reset_lobby', ({ roomId }: { roomId: string }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.state !== 'lobby') return;
    resetGame(room);
    room.players.forEach((player) => {
      player.selectedAvatar = AvatarChoice.UNDEFINED;
    });
    // Clearing the family table clears its computer players too; a practice table keeps them.
    if (!room.isPractice) room.players = room.players.filter((p) => !p.isBot);
    broadcastState(room);
  });

  // --- Computer players: anyone at the table can add or remove them before a game ---
  socket.on('add_bot', ({ roomId }: { roomId: string }) => {
    const seat = currentSeat(roomId);
    if (!seat || (seat.room.state !== 'lobby' && seat.room.state !== 'winner')) return;
    const error = addBot(seat.room);
    if (error) {
      socket.emit('avatar_selection_error', { message: error });
      return;
    }
    cancelStartCountdown(seat.room, 'Start cancelled: a computer player joined the table.');
    broadcastState(seat.room);
  });

  socket.on('remove_bot', ({ roomId, playerId }: { roomId: string; playerId: string }) => {
    const seat = currentSeat(roomId);
    if (!seat || (seat.room.state !== 'lobby' && seat.room.state !== 'winner')) return;
    const bot = seat.room.players.find((p) => p.playerId === playerId && p.isBot);
    if (!bot) return;
    seat.room.players = seat.room.players.filter((p) => p !== bot);
    cancelStartCountdown(seat.room, `Start cancelled: ${nameOf(bot)} left the table.`);
    broadcastState(seat.room);
  });

  /**
   * Leaves the table this socket is on (when switching between the family and practice tables).
   * Before a game your seat is freed; mid-game you're treated as offline so your turns get played.
   */
  function leaveRoom(): void {
    const seat = socket.data.roomId ? currentSeat(socket.data.roomId) : null;
    if (socket.data.roomId) socket.leave(socket.data.roomId);
    socket.data.roomId = undefined;
    if (!seat) return;
    const { room, player } = seat;
    const midGame = room.state !== 'lobby' && room.state !== 'winner';
    if (midGame) {
      player.disconnected = true;
      player.socketId = undefined;
    } else {
      room.players = room.players.filter((p) => p !== player);
      if (isSeated(player)) cancelStartCountdown(room, `Start cancelled: ${nameOf(player)} left the table.`);
    }
    schedulePracticeCleanup(room);
    broadcastState(room);
  }

  socket.on('set_bot_difficulty', ({ roomId, difficulty }: { roomId: string; difficulty: BotDifficulty }) => {
    const seat = currentSeat(roomId);
    if (!seat || seat.room.state !== 'lobby') return;
    if (difficulty !== 'easy' && difficulty !== 'medium' && difficulty !== 'hard') return;
    seat.room.botDifficulty = difficulty;
    broadcastState(seat.room);
  });

  socket.on('set_game_speed',({ roomId, gameSpeed }: { roomId: string; gameSpeed: 'slow' | 'normal' | 'fast' }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    room.gameSpeed = gameSpeed === 'slow' || gameSpeed === 'fast' ? gameSpeed : 'normal';
    broadcastState(room);
  });

  // --- Handle disconnects ---
  socket.on('disconnect', () => {
    const result = roomManager.findPlayerBySocketId(socket.id);
    console.log('Client disconnected', socket.id);
    if (!result) return;
    const { room, player } = result;
    player.disconnected = true;
    if (isSeated(player)) {
      cancelStartCountdown(room, `Start cancelled: ${nameOf(player)} lost connection.`);
    }
    schedulePracticeCleanup(room);
    broadcastState(room);

    // A player who leaves the lobby and doesn't come back gives their seat up,
    // so a closed tab can't be dealt into the next game and stall it.
    if (room.state === 'lobby') {
      setTimeout(() => {
        const latest = roomManager.getRoom(room.roomId);
        if (!latest || latest.state !== 'lobby') return;
        const stillGone = latest.players.find((p) => p.playerId === player.playerId && p.disconnected);
        if (!stillGone) return;
        latest.players = latest.players.filter((p) => p.playerId !== player.playerId);
        broadcastState(latest);
      }, LOBBY_SEAT_GRACE_MS);
    }
  });

  // --- Start: shows everyone a 3 second countdown, then deals ---
  socket.on('start_game', ({ roomId }: { roomId: string }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('start_game_error', { message: 'Room not found. Refresh the page to rejoin.' });
      return;
    }
    // Ignore double-taps and stale clients: only an idle lobby can start a countdown.
    if (room.state !== 'lobby' || room.startCountdown) return;

    const problem = startProblem(room);
    if (problem) {
      socket.emit('start_game_error', { message: problem });
      return;
    }
    beginStartCountdown(room);
    broadcastState(room);
  });

  socket.on('cancel_start', ({ roomId }: { roomId: string }) => {
    const seat = currentSeat(roomId);
    if (!seat || seat.room.state !== 'lobby') return;
    if (cancelStartCountdown(seat.room, `${nameOf(seat.player)} cancelled the start.`)) broadcastState(seat.room);
  });

  // --- Emotes: a fixed set of quick reactions, shown to the table as a speech bubble ---
  let lastEmoteAt = 0;
  socket.on('emote', ({ roomId, emote }: { roomId: string; emote: EmoteId }) => {
    const seat = currentSeat(roomId);
    if (!seat || typeof emote !== 'string' || !Object.prototype.hasOwnProperty.call(EMOTES, emote)) return;
    const now = Date.now();
    if (now - lastEmoteAt < 1500) return; // no spamming
    lastEmoteAt = now;
    io.to(roomId).emit('emote', { playerId: seat.player.playerId, emote });
  });

  socket.on('playCard', ({ roomId, card }: { roomId: string; card: OwnedCard }) => {
    const seat = currentSeat(roomId);
    if (!seat) return;
    const error = applyPlay(seat.room, seat.index, card?.card?.id);
    if (error) socket.emit('play_card_error', { message: error });
  });

  socket.on('submit_bid', ({ roomId, bid }: { roomId: string; bid: number }) => {
    const seat = currentSeat(roomId);
    if (!seat) return;
    const error = applyBid(seat.room, seat.index, bid);
    if (error) socket.emit('bid_error', { message: error });
  });

  // Anyone at the table can make an offline player's move straight away instead of waiting.
  socket.on('play_for_absent', ({ roomId }: { roomId: string }) => {
    const seat = currentSeat(roomId);
    if (!seat || !isAwaitingAbsentPlayer(seat.room)) return;
    absentTimers.delete(seat.room.roomId);
    autoMove(seat.room);
  });

  // Skip the round summary early (the server also advances automatically).
  socket.on('next_round', ({ roomId }: { roomId: string }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.state !== 'round_end') return;
    startNextRound(room, false);
    broadcastState(room);
  });

  socket.on('cancel_game', ({ roomId }: { roomId: string }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (room.isPractice) {
      returnToFamilyTable(room);
      return;
    }
    resetGame(room);
    broadcastState(room);
  });

  socket.on('rematch_game', ({ roomId }: { roomId: string }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.state !== 'winner') return;
    const error = beginGame(room);
    if (error) socket.emit('start_game_error', { message: error });
    broadcastState(room);
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
