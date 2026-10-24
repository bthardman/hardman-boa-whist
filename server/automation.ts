// Turns the server takes for people: offline players (after a wait), computer players (after a
// short "thinking" pause), and tidying away a family game everybody has left.
import type { GameState } from '../shared/types.ts';
import type { Ctx } from './context.ts';
import { chooseMove } from './bot/index.ts';
import { cardValue } from './utils/cardUtils.ts';
import { canPlayCard } from './utils/gameLogic.ts';
import { isValidBid } from './utils/biddingRules.ts';
import { afterDelay, applyBid, applyPlay, isActive, resetGame } from './flow.ts';
import { broadcastState, notifyRoom } from './view.ts';

/** Identifies "this exact turn", so a scheduled move is dropped if anything has moved on. */
function turnKey(room: GameState): string {
  return [
    room.gameId,
    room.state,
    room.roundNumber,
    room.currentPlayer,
    room.currentTrick.length,
    room.players[room.currentPlayer]?.hand.length
  ].join(':');
}

export function hasConnectedHuman(room: GameState): boolean {
  return room.players.some((p) => !p.isBot && !p.disconnected);
}

/** Someone has to move, and it isn't a pause between tricks. */
function isAwaitingMove(room: GameState): boolean {
  if (room.state !== 'bidding' && room.state !== 'tricks') return false;
  return !(room.state === 'tricks' && room.currentTrick.length >= room.players.length);
}

export function isAwaitingAbsentPlayer(room: GameState): boolean {
  return isAwaitingMove(room) && !!room.players[room.currentPlayer]?.disconnected;
}

function isAwaitingBot(room: GameState): boolean {
  // Nobody watching: pause rather than let the bots play the whole game alone.
  return isAwaitingMove(room) && !!room.players[room.currentPlayer]?.isBot && hasConnectedHuman(room);
}

/**
 * Plays the current player's turn for them (offline players and computer players) using the
 * computer player's judgement. The move goes through applyBid / applyPlay, so it is checked
 * like any other. If that ever fails, falls back to a simple safe move.
 */
export function autoMove(ctx: Ctx, room: GameState): void {
  const idx = room.currentPlayer;
  // Computer players play at the table's difficulty; an offline person gets sensible, mistake-free moves.
  const difficulty = room.players[idx]?.isBot ? (room.botDifficulty ?? 'medium') : 'medium';
  let move: ReturnType<typeof chooseMove> = null;
  try {
    move = chooseMove(room, idx, ctx.roundLogs.get(room.roomId) ?? [], difficulty);
  } catch (err) {
    console.error('Computer player failed to choose a move', err);
  }
  const error = !move
    ? 'no move'
    : move.kind === 'bid'
      ? applyBid(ctx, room, idx, move.bid)
      : applyPlay(ctx, room, idx, move.cardId);
  if (error) {
    console.error(`Computer move rejected (${error}); playing a safe move instead.`);
    safeMove(ctx, room);
  }
}

/** A simple, safe move: the lowest legal bid, or the lowest legal card. */
function safeMove(ctx: Ctx, room: GameState): void {
  const idx = room.currentPlayer;
  const player = room.players[idx];
  if (!player) return;
  if (room.state === 'bidding') {
    for (let bid = 0; bid <= 7; bid++) {
      if (isValidBid(room, idx, bid).valid) {
        applyBid(ctx, room, idx, bid);
        break;
      }
    }
  } else if (room.state === 'tricks') {
    const legal = player.hand
      .filter((c) => canPlayCard(c, player.hand, room.currentTrick))
      .sort((a, b) => cardValue(a.card.value) - cardValue(b.card.value) || (a.card.suit === 'hearts' ? 1 : -1));
    if (legal[0]) applyPlay(ctx, room, idx, legal[0].card.id);
  }
}

export function scheduleAbsentAutoplay(ctx: Ctx, room: GameState): void {
  if (!isAwaitingAbsentPlayer(room)) {
    room.absentTurnDeadline = undefined;
    ctx.absentTurns.delete(room.roomId);
    return;
  }
  const key = turnKey(room);
  if (ctx.absentTurns.get(room.roomId) === key) return; // already scheduled for this turn
  ctx.absentTurns.set(room.roomId, key);
  room.absentTurnDeadline = Date.now() + ctx.timings.absentAutoplayMs;
  afterDelay(
    ctx,
    room,
    ctx.timings.absentAutoplayMs,
    (latest) => {
      if (turnKey(latest) !== key || !isAwaitingAbsentPlayer(latest)) return;
      ctx.absentTurns.delete(latest.roomId);
      autoMove(ctx, latest);
    },
    false
  );
}

export function scheduleBotTurn(ctx: Ctx, room: GameState): void {
  if (!isAwaitingBot(room)) {
    ctx.botTurns.delete(room.roomId);
    return;
  }
  const key = turnKey(room);
  if (ctx.botTurns.get(room.roomId) === key) return; // already scheduled for this turn
  ctx.botTurns.set(room.roomId, key);
  const thinkMs = ctx.timings.botThinkMs * (0.8 + Math.random() * 0.5);
  afterDelay(ctx, room, thinkMs, (latest) => {
    if (turnKey(latest) !== key || !isAwaitingBot(latest)) return;
    ctx.botTurns.delete(latest.roomId);
    autoMove(ctx, latest);
  });
}

/**
 * A family game that everyone has left would otherwise block the table: computer players wait
 * for a person to come back, and newcomers can only watch. After a while with nobody connected,
 * end it, drop the people who left, and free the table. (Practice tables tidy themselves away.)
 */
export function scheduleAbandonCheck(ctx: Ctx, room: GameState): void {
  const abandoned = !room.isPractice && isActive(room) && !hasConnectedHuman(room);
  if (!abandoned) {
    ctx.clearTimer(ctx.abandonTimers.get(room.roomId));
    ctx.abandonTimers.delete(room.roomId);
    return;
  }
  if (ctx.abandonTimers.has(room.roomId)) return; // already counting down
  ctx.abandonTimers.set(
    room.roomId,
    ctx.setTimer(() => {
      ctx.abandonTimers.delete(room.roomId);
      const latest = ctx.rooms.getRoom(room.roomId);
      if (!latest || latest.isPractice || !isActive(latest) || hasConnectedHuman(latest)) return;
      resetGame(ctx, latest);
      latest.players = latest.players.filter((p) => p.isBot || !p.disconnected);
      notifyRoom(ctx, latest, 'Everyone left the last game, so it has ended and the table is free.');
      broadcastState(ctx, latest);
    }, ctx.timings.abandonedGameMs)
  );
}
