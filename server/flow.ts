// The game itself: starting, dealing, bidding, playing tricks and scoring.
import type { GameState } from '../shared/types.ts';
import { MAX_PLAYERS } from '../shared/types.ts';
import { isSeated } from '../shared/players.ts';
import type { Ctx, GameSocket } from './context.ts';
import { createDeck } from './utils/cardUtils.ts';
import { calculateTrickWinner, canPlayCard, dealCards } from './utils/gameLogic.ts';
import { GameStateMachine } from './utils/gameStateMachine.ts';
import { calculateRoundScores, checkGameEnd, checkRoundEnd, findGameWinner, updateTotalScores } from './utils/scoreCalculator.ts';
import { isValidBid } from './utils/biddingRules.ts';
import { broadcastState, notifyRoom } from './view.ts';
import { moveSoloGameToPrivateTable } from './tables.ts';
import { emptyTally, reportFinishedGame, tallyRound, tallyTrick } from './stats.ts';

/** A game is under way (cards dealt and not yet won). */
export function isActive(room: GameState): boolean {
  return room.state === 'bidding' || room.state === 'tricks' || room.state === 'round_end';
}

function speedMultiplier(speed: string | undefined): number {
  if (speed === 'slow') return 1.35;
  if (speed === 'fast') return 0.7;
  return 1;
}

export function scaleRoomMs(room: { gameSpeed?: string }, ms: number): number {
  return Math.max(120, Math.round(ms * speedMultiplier(room.gameSpeed)));
}

/**
 * Runs `fn` after a delay, but only if the room still exists and is on the same game.
 * Prevents a timer from an abandoned game (cancel / rematch) acting on the next one.
 */
export function afterDelay(ctx: Ctx, room: GameState, ms: number, fn: (latest: GameState) => void, scale = true): void {
  const gameId = room.gameId;
  ctx.setTimer(
    () => {
      const latest = ctx.rooms.getRoom(room.roomId);
      if (!latest || latest.gameId !== gameId) return;
      fn(latest);
    },
    scale ? scaleRoomMs(room, ms) : ms
  );
}

export function startNextRound(ctx: Ctx, room: GameState, isInitialStart = false): void {
  room.roundNumber++;
  ctx.roundLogs.set(room.roomId, []);
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

function finishRoundAndAdvanceOrEnd(ctx: Ctx, room: GameState): void {
  tallyRound(ctx, room);
  updateTotalScores(room, calculateRoundScores(room));

  if (checkGameEnd(room)) {
    const winner = findGameWinner(room);
    if (winner) {
      room.winner = winner;
      GameStateMachine.transition(room, 'winner');
      reportFinishedGame(ctx, room);
    }
    broadcastState(ctx, room);
    return;
  }

  GameStateMachine.transition(room, 'round_end');
  room.roundEndsAt = Date.now() + scaleRoomMs(room, ctx.timings.roundSummaryMs);
  broadcastState(ctx, room);

  // Auto-advance after showing the round scores for a while.
  const roundToAdvance = room.roundNumber;
  afterDelay(ctx, room, ctx.timings.roundSummaryMs, (latest) => {
    if (latest.state !== 'round_end' || latest.roundNumber !== roundToAdvance) return;
    startNextRound(ctx, latest, false);
    broadcastState(ctx, latest);
  });
}

/** Clears all per-game state and bumps gameId so stale timers are ignored. */
export function resetGame(ctx: Ctx, room: GameState): void {
  cancelStartCountdown(ctx, room);
  room.gameId = (room.gameId ?? 0) + 1;
  room.state = 'lobby';
  room.roundNumber = 0;
  room.currentPlayer = 0;
  room.firstPlayer = 0;
  room.currentTrick = [];
  room.completedTricks = [];
  room.winner = undefined;
  room.roundEndsAt = undefined;
  room.absentTurnDeadline = undefined;
  room.scoreboard = {};
  ctx.roundLogs.delete(room.roomId);
  ctx.tallies.delete(room.roomId);
  room.players.forEach((p) => {
    p.hand = [];
    p.tricksWon = 0;
    p.bid = undefined;
  });
}

/**
 * People in the room who haven't picked a face when the cards are dealt watch the game instead.
 * Scores are keyed by seat index, so this must only happen before the first deal.
 */
function moveSpectatorsToWatching(ctx: Ctx, room: GameState): void {
  const spectators = room.players.filter((p) => !isSeated(p));
  if (!spectators.length) return;
  room.players = room.players.filter(isSeated);
  for (const p of spectators) {
    const socket = p.socketId ? (ctx.io.sockets.sockets.get(p.socketId) as GameSocket | undefined) : undefined;
    if (!socket) continue;
    socket.data.watching = true;
    socket.emit('watching');
  }
}

/** People who left a while ago (e.g. during the winner screen) aren't dealt into the next game. */
function dropLongGone(ctx: Ctx, room: GameState): void {
  const now = Date.now();
  room.players = room.players.filter(
    (p) => p.isBot || !p.disconnected || now - (p.disconnectedAt ?? now) < ctx.timings.lobbySeatGraceMs
  );
}

export function startProblem(ctx: Ctx, room: GameState): string | null {
  if (!room.players.some((p) => !p.isBot && isSeated(p))) return 'Pick your picture to join the game first.';
  if (!ctx.rooms.canStartGame(room)) return 'At least 2 players need to pick an avatar to start.';
  if (room.players.filter(isSeated).length > MAX_PLAYERS) return `A game can have at most ${MAX_PLAYERS} players.`;
  return null;
}

/** Shared by start and rematch: returns an error message, or null once the first round is dealt. */
export function beginGame(ctx: Ctx, room: GameState): string | null {
  resetGame(ctx, room);
  dropLongGone(ctx, room);
  const problem = startProblem(ctx, room);
  if (problem) return problem;
  moveSpectatorsToWatching(ctx, room);
  ctx.tallies.set(room.roomId, room.players.map(emptyTally));
  startNextRound(ctx, room, true);
  return null;
}

// ---------------------------------------------------------------------------
// Start countdown (lobby -> 3, 2, 1 -> deal)
// ---------------------------------------------------------------------------

export function cancelStartCountdown(ctx: Ctx, room: GameState, reason?: string): boolean {
  ctx.clearTimer(ctx.startTimers.get(room.roomId));
  ctx.startTimers.delete(room.roomId);
  if (!room.startCountdown) return false;
  room.startCountdown = undefined;
  if (reason) notifyRoom(ctx, room, reason);
  return true;
}

export function beginStartCountdown(ctx: Ctx, room: GameState): void {
  const id = Date.now();
  room.startCountdown = {
    id,
    durationMs: ctx.timings.startCountdownMs,
    playerIds: room.players.filter(isSeated).map((p) => p.playerId)
  };
  ctx.startTimers.set(
    room.roomId,
    ctx.setTimer(() => {
      ctx.startTimers.delete(room.roomId);
      const latest = ctx.rooms.getRoom(room.roomId);
      if (!latest || latest.state !== 'lobby' || latest.startCountdown?.id !== id) return;
      latest.startCountdown = undefined;
      // One person against computer players plays on a private table, so the family table stays free.
      const game = moveSoloGameToPrivateTable(ctx, latest);
      const error = beginGame(ctx, game);
      if (error) notifyRoom(ctx, game, error);
      broadcastState(ctx, game);
      if (game !== latest) broadcastState(ctx, latest);
    }, ctx.timings.startCountdownMs)
  );
}

// ---------------------------------------------------------------------------
// Moves (shared by players, the offline auto-player and computer players)
// ---------------------------------------------------------------------------

/** Places a bid for the player at `playerIndex`. Returns an error message, or null on success. */
export function applyBid(ctx: Ctx, room: GameState, playerIndex: number, bid: number): string | null {
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
  broadcastState(ctx, room);
  return null;
}

/** Plays a card (by id) for the player at `playerIndex`. Returns an error message, or null on success. */
export function applyPlay(ctx: Ctx, room: GameState, playerIndex: number, cardId: string | undefined): string | null {
  const player = room.players[playerIndex];
  if (!player || room.state !== 'tricks' || room.currentPlayer !== playerIndex) return "It isn't your turn yet.";
  if (room.currentTrick.length >= room.players.length) return 'Wait for the trick to finish.';

  // Use the server's copy of the card: only the id is trusted from the client.
  const cardInHand = player.hand.find((c) => c.card.id === cardId);
  if (!cardInHand) return "That card isn't in your hand.";
  if (!canPlayCard(cardInHand, player.hand, room.currentTrick)) return 'You must follow suit if you can.';

  player.hand = player.hand.filter((c) => c.card.id !== cardInHand.card.id);
  const ledSuit = room.currentTrick[0]?.card.suit ?? cardInHand.card.suit;
  ctx.roundLogs.get(room.roomId)?.push({ seat: playerIndex, card: cardInHand.card, ledSuit });
  room.currentTrick.push(cardInHand);

  if (room.currentTrick.length < room.players.length) {
    room.currentPlayer = (playerIndex + 1) % room.players.length;
    broadcastState(ctx, room);
    return null;
  }

  // Trick complete: award it, then let everyone see the cards briefly before clearing.
  const winnerIndex = calculateTrickWinner(room.currentTrick, room.players);
  if (winnerIndex !== -1) {
    tallyTrick(ctx, room, room.currentTrick, winnerIndex);
    (room.completedTricks ??= []).push({ winnerId: room.players[winnerIndex].playerId, cards: room.currentTrick.slice() });
    room.players[winnerIndex].tricksWon++;
    room.currentPlayer = winnerIndex;
  }
  broadcastState(ctx, room);

  const trickRound = room.roundNumber;
  afterDelay(ctx, room, ctx.timings.trickPauseMs, (latest) => {
    if (latest.roundNumber !== trickRound) return;
    if (latest.currentTrick.length !== latest.players.length) return;
    latest.currentTrick = [];
    if (checkRoundEnd(latest)) {
      finishRoundAndAdvanceOrEnd(ctx, latest);
      return;
    }
    broadcastState(ctx, latest);
  });
  return null;
}
