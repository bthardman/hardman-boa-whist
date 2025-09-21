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

  // --- Player joins lobby ---
  socket.on('join_lobby', ({ roomId, playerId }: { roomId: string, playerId: string }) => {
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

    // Check if this player already exists (reconnect)
    let player = room.players.find(p => p.playerId === playerId);
    if (player) {
      player.socketId = socket.id;
      player.disconnected = false;
    } else {
      room.players.push({
        playerId,
        socketId: socket.id,
        selectedAvatar: AvatarChoice.UNDEFINED,
        hand: [],
        tricksWon: 0
      });
    }

    socket.join(roomId);

    console.log('Lobby joined:', roomId, 'PlayerId:', playerId);

    io.to(roomId).emit('state_updated', room);
  });

  // --- Player selects avatar ---
  socket.on('select_avatar', ({ roomId, playerId, avatarChoice }: { roomId: string, playerId: string, avatarChoice: AvatarChoice }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find(p => p.playerId === playerId);
    if (!player) return;

    // Check if avatar is already taken
    const isTaken = room.players.some(p => p.playerId !== playerId && p.selectedAvatar === avatarChoice);
    if (isTaken) {
      socket.emit('avatar_selection_error', { message: 'Avatar already selected by another player' });
      return;
    }

    player.selectedAvatar = avatarChoice;

    io.to(roomId).emit('state_updated', room);
  });

  // --- Handle disconnects ---
  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        player.disconnected = true;
        io.to(roomId).emit('state_updated', room);
      }
    }
    console.log('Client disconnected', socket.id);
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

    // --- Deal cards ---
    // Standard 52-card deck
    const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
    const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    let deck: { suit: string; value: string; id: string }[] = [];
    let cardId = 1;
    for (const suit of suits) {
      for (const value of values) {
        deck.push({ suit, value, id: String(cardId++) });
      }
    }
    // Shuffle deck
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    // Deal cards evenly to all players
    const numPlayers = room.players.length;
    const handSize = Math.floor(deck.length / numPlayers);
    for (let i = 0; i < numPlayers; i++) {
      room.players[i].hand = [];
      for (let j = 0; j < handSize; j++) {
        const card = deck[i * handSize + j];
        const ownedCard = { card, player: room.players[i] };
        room.players[i].hand.push(ownedCard);
      }
      room.players[i].tricksWon = 0;
      room.players[i].bid = undefined;
    }

    room.currentTrick = [];
    room.state = 'bidding';
    room.currentPlayer = 0;
    io.to(roomId).emit('state_updated', room);
  });

  console.log('client connected', socket.id);

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

  socket.on('submit_bid', ({ roomId, playerIndex, bid }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[playerIndex];
    if (!player) return;

    // Only allow if it's this player's turn and they haven't bid yet
    if (room.currentPlayer !== playerIndex || typeof player.bid === 'number') return;

    player.bid = bid;

    // Find next player who hasn't bid
    let nextIdx = (playerIndex + 1) % room.players.length;
    let allBidded = true;
    for (let i = 0; i < room.players.length; i++) {
      if (typeof room.players[i].bid !== 'number') {
        allBidded = false;
        nextIdx = i;
        break;
      }
    }

    if (allBidded) {
      room.state = 'tricks';
    } else {
      room.currentPlayer = nextIdx;
    }

    io.to(roomId).emit('state_updated', room);
  });
});

server.listen(3000, () => {
  console.log("Server listening on port 3000");
});