import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import type { GameState,  OwnedCard } from '../shared/types';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms: Record<string, GameState> = {};

function cardValue(v: string): number {
  const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  return order.indexOf(v);
}

function calculateTrickWinner(trick: OwnedCard[]): string {
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

  return winning.player.name;
}

io.on('connection', (socket) => {
  console.log('client connected', socket.id);

  socket.on('joinRoom', ({ roomId, playerName }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        roomId,
        players: [],
        currentPlayer: '',
        firstPlayer: '',
        currentTrick: [],
        state: 'lobby',
        scoreboard: {}
      };
    }
    const room = rooms[roomId];

    let player = room.players.find((p) => p.name === playerName);
    if (player) {
      player.socketId = socket.id;
      player.disconnected = false;
    } else {
      room.players.push({
        name: playerName,
        avatar1: `/avatars/${playerName.toLowerCase()}_1.png`,
        avatar2: `/avatars/${playerName.toLowerCase()}_2.png`,
        hand: [],
        tricksWon: 0,
        socketId: socket.id,
        isLocal: true
      });
    }

    socket.join(roomId);
    io.to(roomId).emit('stateUpdate', room);
  });

  socket.on('playCard', ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find((p) => p.name === card.player);
    if (!player || room.currentPlayer !== player.name) return;

    // remove from hand
    player.hand = player.hand.filter((c) => c.card.id !== card.card.id);

    // add to trick
    room.currentTrick.push(card);

    // next player
    const idx = room.players.findIndex((p) => p.name === player.name);
    const nextIdx = (idx + 1) % room.players.length;
    room.currentPlayer = room.players[nextIdx].name;

    io.to(roomId).emit('stateUpdate', room);
  });

  socket.on('endTrick', ({ roomId, winner }) => {
    const room = rooms[roomId];
    if (!room) return;

    const winningPlayer = room.players.find((p) => p.name === winner);
    if (!winningPlayer) return;

    winningPlayer.tricksWon++;
    room.currentTrick = [];
    room.currentPlayer = winner;

    io.to(roomId).emit('stateUpdate', room);
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const player = room.players.find((p) => p.socketId === socket.id);
      if (player) {
        player.disconnected = true;
        io.to(roomId).emit('stateUpdate', room);
      }
    }
    console.log('client disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`server running on port ${PORT}`));
