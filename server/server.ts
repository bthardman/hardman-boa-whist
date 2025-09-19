import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import type { GameState, OwnedCard, Player } from '../shared/types.ts';
import { AvatarChoice } from '../shared/types.ts';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const rooms: Record<string, GameState> = {};

function cardValue(v: string): number {
  const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  return order.indexOf(v);
}

function calculateTrickWinner(trick: OwnedCard[], players: Player[]): number {
  const suitLed = trick[0].card.suit;
  let winning = trick[0];

  trick.forEach((played) => {
    if (
      // hearts trump anything not hearts
      (played.card.suit === 'hearts' && winning.card.suit !== 'hearts') ||
      // higher trump beats lower trump
      (played.card.suit === 'hearts' && winning.card.suit === 'hearts' &&
        cardValue(played.card.value) > cardValue(winning.card.value)) ||
      // higher card of led suit
      (played.card.suit === suitLed && winning.card.suit === suitLed &&
        cardValue(played.card.value) > cardValue(winning.card.value))
    ) {
      winning = played;
    }
  });

  return players.findIndex(p => p === winning.player);
}

io.on('connection', (socket) => {
  // Allow client to request current state
  socket.on('get_state', ({ roomId }) => {
    const room = rooms[roomId];
    if (room) {
      socket.emit('state_updated', room);
    }
  });
  // Handle join_lobby from client - initial join without avatar
  socket.on('join_lobby', ({ roomId }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        roomId,
        players: [],
        currentPlayer: 0,
        firstPlayer: 0,
        currentTrick: [],
        state: 'lobby',
        scoreboard: {}
      };
    }
    const room = rooms[roomId];
    
    // Add new player with UNDEFINED avatar
    room.players.push({ 
      selectedAvatar: AvatarChoice.UNDEFINED,
      socketId: socket.id, 
      hand: [],
      tricksWon: 0
    });
    
    socket.join(roomId);
    io.to(roomId).emit('state_updated', room);
  });

  // Handle avatar selection
  socket.on('select_avatar', ({ roomId, playerIndex, avatarChoice }) => {
    const room = rooms[roomId];
    if (!room) return;
    
    const player = room.players[playerIndex];
    if (!player) return;
    
    // Check if avatar is already selected by another player
    const isAvatarTaken = room.players.some((p, index) => index !== playerIndex && p.selectedAvatar === avatarChoice);
    if (isAvatarTaken) {
      socket.emit('avatar_selection_error', { message: 'Avatar already selected by another player' });
      return;
    }
    
    // Set the new selection
    player.selectedAvatar = avatarChoice;
    io.to(roomId).emit('state_updated', room);
  });

  // Handle start_game from client
  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    
    // Check if at least 2 players have selected avatars
    const playersWithAvatars = room.players.filter(p => p.selectedAvatar).length;
    if (playersWithAvatars < 2) {
      socket.emit('start_game_error', { message: 'Need at least 2 players with selected avatars to start' });
      return;
    }
    
    // You may want to add logic to deal cards, set state, etc. For now, just update state.
    room.state = 'bidding';
    room.currentPlayer = 0;
    io.to(roomId).emit('state_updated', room);
  });
  console.log('client connected', socket.id);

  socket.on('joinRoom', ({ roomId, playerName }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        roomId,
        players: [],
        currentPlayer: 0,
        firstPlayer: 0,
        currentTrick: [],
        state: 'lobby',
        scoreboard: {}
      };
    }
    const room = rooms[roomId];

    // For now, just add a new player with UNDEFINED avatar
    room.players.push({
      selectedAvatar: AvatarChoice.UNDEFINED,
      hand: [],
      tricksWon: 0,
      socketId: socket.id
    });

    socket.join(roomId);
    io.to(roomId).emit('state_updated', room);
  });

  socket.on('playCard', ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[card.playerIndex];
    if (!player || room.currentPlayer !== card.playerIndex) return;

    // remove from hand
    player.hand = player.hand.filter((c) => c.card.id !== card.card.id);

    // add to trick
    room.currentTrick.push(card);

    // next player
    const nextIdx = (card.playerIndex + 1) % room.players.length;
    room.currentPlayer = nextIdx;

  io.to(roomId).emit('state_updated', room);
  });

  socket.on('endTrick', ({ roomId, winner }) => {
    const room = rooms[roomId];
    if (!room) return;

    const winningPlayer = room.players[winner];
    if (!winningPlayer) return;

    winningPlayer.tricksWon++;
    room.currentTrick = [];
    room.currentPlayer = winner;

  io.to(roomId).emit('state_updated', room);
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const player = room.players.find((p) => p.socketId === socket.id);
      if (player) {
        player.disconnected = true;
  io.to(roomId).emit('state_updated', room);
      }
    }
    console.log('client disconnected', socket.id);
  });
});

server.listen(3000, () => {
  console.log("Server listening on port 3000");
});