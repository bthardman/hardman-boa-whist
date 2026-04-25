import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import type { OwnedCard } from '../shared/types.ts';
import { AvatarChoice } from '../shared/types.ts';
import { RoomManager } from './utils/roomManager.ts';
import { createDeck } from './utils/cardUtils.ts';
import { calculateTrickWinner, canPlayCard, dealCards } from './utils/gameLogic.ts';
import { GameStateMachine } from './utils/gameStateMachine.ts';
import { calculateRoundScores, updateTotalScores, checkGameEnd, findGameWinner, checkRoundEnd } from './utils/scoreCalculator.ts';
import { isValidBid } from './utils/biddingRules.ts';

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
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow non-browser requests and same-origin server-to-server calls
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    methods: ["GET", "POST"]
  }
});

// Serve the built frontend when available (useful for single-service Render deploys).
app.use(express.static(distPath));
app.get(/^(?!\/socket\.io).*/, (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const roomManager = new RoomManager();

function startNextRoundInternal(roomId: string, isInitialStart = false): boolean {
  const room = roomManager.getRoom(roomId);
  if (!room) return false;

  room.roundNumber++;
  const deck = createDeck();
  const handSize = 7;
  dealCards(deck, room.players, handSize);

  // Rotate dealer clockwise after each completed round (not before the very first round)
  if (!isInitialStart) {
    room.firstPlayer = (room.firstPlayer + 1) % room.players.length;
  }

  room.currentTrick = [];
  room.players.forEach((p) => {
    p.tricksWon = 0;
    p.bid = undefined;
  });

  GameStateMachine.transition(room, 'bidding');
  room.currentPlayer = room.firstPlayer;
  return true;
}

function finishRoundAndAdvanceOrEnd(roomId: string): void {
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const roundScores = calculateRoundScores(room);
  updateTotalScores(room, roundScores);

  if (checkGameEnd(room)) {
    const winner = findGameWinner(room);
    if (winner) {
      room.winner = winner;
      GameStateMachine.transition(room, 'winner');
    }
    io.to(roomId).emit('state_updated', room);
    return;
  }

  GameStateMachine.transition(room, 'round_end');
  io.to(roomId).emit('state_updated', room);

  // Auto-advance after showing round scores briefly.
  const roundToAdvance = room.roundNumber;
  setTimeout(() => {
    const latest = roomManager.getRoom(roomId);
    if (!latest) return;
    if (latest.state !== 'round_end' || latest.roundNumber !== roundToAdvance) return;

    if (startNextRoundInternal(roomId, false)) {
      io.to(roomId).emit('state_updated', latest);
    }
  }, 15000);
}

function resetRoomToLobby(roomId: string): boolean {
  const room = roomManager.getRoom(roomId);
  if (!room) return false;

  room.state = 'lobby';
  room.roundNumber = 0;
  room.currentPlayer = 0;
  room.firstPlayer = 0;
  room.currentTrick = [];
  room.winner = undefined;
  room.scoreboard = {};
  room.players.forEach((p) => {
    p.hand = [];
    p.tricksWon = 0;
    p.bid = undefined;
  });
  return true;
}

io.on('connection', (socket) => {
  console.log('Client connected', socket.id);

  // Allow client to request current state
  socket.on('get_state', ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (room) {
      socket.emit('state_updated', room);
    }
  });

  // --- Player joins lobby ---
  socket.on('join_lobby', ({ roomId, playerId }: { roomId: string, playerId: string }) => {
    const existingRoom = roomManager.getRoom(roomId);
    const existingPlayer = existingRoom?.players.find((p) => p.playerId === playerId);
    const isActiveGame = existingRoom && existingRoom.state !== 'lobby' && existingRoom.state !== 'winner';
    if (isActiveGame && !existingPlayer) {
      socket.emit('join_error', {
        message: 'Game already in progress. Please wait for the next game.'
      });
      return;
    }

    const player = roomManager.joinPlayer(roomId, playerId, socket.id);
    const room = roomManager.getRoom(roomId)!;
    
    socket.join(roomId);
    
    // Reconnection recovery: if player is reconnecting during an active game, send them full state
    if (room.state !== 'lobby' && room.state !== 'winner') {
      console.log('Player reconnected during game:', roomId, 'PlayerId:', playerId);
      // Send full state to reconnecting player immediately
      socket.emit('state_updated', room);
    } else {
      console.log('Lobby joined:', roomId, 'PlayerId:', playerId);
    }

    // Broadcast to all players in room
    io.to(roomId).emit('state_updated', room);
  });

  // --- Player selects avatar ---
  socket.on('select_avatar', ({ roomId, playerId, avatarChoice }: { roomId: string, playerId: string, avatarChoice: AvatarChoice }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('avatar_selection_error', { message: 'Room not found' });
      return;
    }

    const player = roomManager.findPlayerByPlayerId(roomId, playerId);
    if (!player) {
      socket.emit('avatar_selection_error', { message: 'Player not found' });
      return;
    }

    // Check if avatar is already taken
    if (roomManager.isAvatarTaken(room, avatarChoice, playerId)) {
      socket.emit('avatar_selection_error', { message: 'Avatar already selected by another player' });
      return;
    }

    player.selectedAvatar = avatarChoice;
    io.to(roomId).emit('state_updated', room);
  });

  socket.on('set_winning_score', ({ roomId, winningScore }: { roomId: string; winningScore: number }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (room.state !== 'lobby') return;

    const nextScore = Number(winningScore);
    if (!Number.isFinite(nextScore)) return;

    // Keep target score in a sane range.
    room.winningScore = Math.max(1, Math.min(5, Math.floor(nextScore)));
    io.to(roomId).emit('state_updated', room);
  });

  // --- Handle disconnects ---
  socket.on('disconnect', () => {
    const result = roomManager.findPlayerBySocketId(socket.id);
    if (result) {
      result.player.disconnected = true;
      io.to(result.room.roomId).emit('state_updated', result.room);
    }
    console.log('Client disconnected', socket.id);
  });

  // Handle start_game from client
  socket.on('start_game', ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('start_game_error', { message: 'Room not found' });
      return;
    }

    const removed = room.players.filter((p) => p.selectedAvatar === AvatarChoice.UNDEFINED);
    if (removed.length > 0) {
      const removedIds = new Set(removed.map((p) => p.playerId));
      room.players = room.players.filter((p) => !removedIds.has(p.playerId));
      removed.forEach((p) => {
        if (p.socketId) {
          const s = io.sockets.sockets.get(p.socketId);
          if (s) {
            s.emit('join_error', { message: 'Please select an avatar before joining a game.' });
            s.leave(roomId);
            s.disconnect(true);
          }
        }
      });
      room.currentPlayer = 0;
      room.firstPlayer = 0;
    }

    // Check if at least 2 players have selected avatars
    if (!roomManager.canStartGame(room)) {
      socket.emit('start_game_error', { message: 'Need at least 2 players with selected avatars to start' });
      return;
    }

    // Initialize game settings if first round
    if (room.roundNumber === 0) {
      room.scoreboard = {};
    }
    if (startNextRoundInternal(roomId, true)) {
      io.to(roomId).emit('state_updated', room);
    }
  });

  socket.on('playCard', ({ roomId, card }: { roomId: string, card: OwnedCard }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    if (room.currentTrick.length === room.players.length) {
      socket.emit('play_card_error', { message: 'Please wait, trick resolving...' });
      return;
    }

    // Find player by playerId (fix bug: client sends playerId, not playerIndex)
    const playerIndex = room.players.findIndex(p => p.playerId === card.playerId);
    if (playerIndex === -1) return;

    const player = room.players[playerIndex];
    
    // Validate it's this player's turn and game is in tricks phase
    if (room.currentPlayer !== playerIndex || room.state !== 'tricks') {
      socket.emit('play_card_error', { message: 'Not your turn or invalid game state' });
      return;
    }

    // Validate card is in player's hand
    const cardInHand = player.hand.find(c => c.card.id === card.card.id);
    if (!cardInHand) {
      socket.emit('play_card_error', { message: 'Card not in hand' });
      return;
    }

    // Validate card can be played (follow suit rules)
    if (!canPlayCard(card, player.hand, room.currentTrick)) {
      socket.emit('play_card_error', { message: 'Must follow suit if possible' });
      return;
    }

    // Remove from hand
    player.hand = player.hand.filter((c) => c.card.id !== card.card.id);

    // Add to trick
    room.currentTrick.push(card);

    // Check if trick is complete
    if (room.currentTrick.length === room.players.length) {
      // All players have played - calculate winner
      const winnerIndex = calculateTrickWinner(room.currentTrick, room.players);
      if (winnerIndex !== -1) {
        room.players[winnerIndex].tricksWon++;
        room.currentPlayer = winnerIndex;
      }

      // Let clients see the final trick cards briefly before clearing + progressing.
      io.to(roomId).emit('state_updated', room);
      setTimeout(() => {
        const latest = roomManager.getRoom(roomId);
        if (!latest) return;
        if (latest.currentTrick.length !== latest.players.length) return;

        latest.currentTrick = [];
        if (checkRoundEnd(latest)) {
          finishRoundAndAdvanceOrEnd(roomId);
          return;
        }
        io.to(roomId).emit('state_updated', latest);
      }, 5000);
      return;
    } else {
      // Move to next player
      room.currentPlayer = (playerIndex + 1) % room.players.length;
    }

    io.to(roomId).emit('state_updated', room);
  });

  socket.on('endTrick', ({ roomId, winner }: { roomId: string, winner: number }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const winningPlayer = room.players[winner];
    if (!winningPlayer) return;

    winningPlayer.tricksWon++;
    room.currentTrick = [];
    room.currentPlayer = winner;

    if (checkRoundEnd(room)) {
      finishRoundAndAdvanceOrEnd(roomId);
      return;
    }

    io.to(roomId).emit('state_updated', room);
  });

  socket.on('submit_bid', ({ roomId, playerIndex, bid }: { roomId: string, playerIndex: number, bid: number }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    
    const player = room.players[playerIndex];
    if (!player) return;

    // Only allow if it's this player's turn and they haven't bid yet
    if (room.currentPlayer !== playerIndex || typeof player.bid === 'number') {
      socket.emit('bid_error', { message: 'Not your turn or already bid' });
      return;
    }

    // Validate bid (check if it would make total = 7 for last bidder)
    const validation = isValidBid(room, playerIndex, bid);
    if (!validation.valid) {
      socket.emit('bid_error', { message: validation.message || 'Invalid bid' });
      return;
    }

    player.bid = bid;

    // Find next player who hasn't bid
    let nextIdx = (playerIndex + 1) % room.players.length;
    let allBidded = true;
    for (let i = 0; i < room.players.length; i++) {
      const checkIdx = (playerIndex + 1 + i) % room.players.length;
  if (typeof room.players[checkIdx].bid !== 'number') {
    allBidded = false;
    nextIdx = checkIdx;
    break;
    }

    if (allBidded) {
      GameStateMachine.transition(room, 'tricks');
      room.currentPlayer = room.firstPlayer;
    } else {
      room.currentPlayer = nextIdx;
    }

    io.to(roomId).emit('state_updated', room);
  });

  // Handle next round request (from round_end state)
  socket.on('next_round', ({ roomId }: { roomId: string }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.state !== 'round_end') return;

    // Check if game should end
    if (checkGameEnd(room)) {
      const winner = findGameWinner(room);
      if (winner) {
        room.winner = winner;
        GameStateMachine.transition(room, 'winner');
        io.to(roomId).emit('state_updated', room);
      }
      return;
    }

    if (startNextRoundInternal(roomId, false)) {
      io.to(roomId).emit('state_updated', room);
    }
  });

  socket.on('cancel_game', ({ roomId }: { roomId: string }) => {
    if (!resetRoomToLobby(roomId)) return;
    const room = roomManager.getRoom(roomId)!;
    io.to(roomId).emit('state_updated', room);
  });

  socket.on('rematch_game', ({ roomId }: { roomId: string }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    // Reset to a fresh game while preserving connected players and avatar choices.
    room.state = 'lobby';
    room.roundNumber = 0;
    room.currentPlayer = 0;
    room.firstPlayer = 0;
    room.currentTrick = [];
    room.winner = undefined;
    room.scoreboard = {};
    room.players.forEach((p) => {
      p.hand = [];
      p.tricksWon = 0;
      p.bid = undefined;
    });

    if (!roomManager.canStartGame(room)) {
      socket.emit('start_game_error', { message: 'Need at least 2 players with selected avatars to start rematch' });
      io.to(roomId).emit('state_updated', room);
      return;
    }

    if (startNextRoundInternal(roomId, true)) {
      io.to(roomId).emit('state_updated', room);
    }
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});