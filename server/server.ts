import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import type { Player, Card, GameState, OwnedCard } from "../src/store";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const lobbies: Record<string, { players: Player[]; state: GameState; scoreboard: Record<string, number> }> = {};

const getOwnedCart = (card: any) => {
  return card as OwnedCard;
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join_lobby', ({ roomId, player }) => {
    if (!lobbies[roomId]) {
      lobbies[roomId] = {
        players: [],
        state: {
          roomId,
          players: [],
          currentTrick: [],
          currentPlayerId: player.name,
        },
        scoreboard: {},
      };
    }
    // Prevent duplicate names
    if (lobbies[roomId].players.some(p => p.name === player.name)) return;
    // Prevent duplicate avatar selection
    if (lobbies[roomId].players.some(p => p.selectedAvatar === player.selectedAvatar)) return;
    player.socketId = socket.id;
  lobbies[roomId].players.push(player);
  lobbies[roomId].state.players = lobbies[roomId].players;
  lobbies[roomId].scoreboard[player.name] = lobbies[roomId].scoreboard[player.name] || 0;
  io.to(roomId).emit('lobby_update', lobbies[roomId].players);
  socket.join(roomId);
  });

  socket.on('start_game', ({ roomId }) => {
    // Shuffle and deal hands
    const players = lobbies[roomId]?.players || [];
    const deck = createDeck();
    for (const player of players) {
      player.hand = deck.splice(0, 7).map(card => ({ card, player }));
      player.tricksWon = 0;
    }
    lobbies[roomId].state.players = players;
    lobbies[roomId].state.currentTrick = [];
    lobbies[roomId].state.currentPlayerId = players[0]?.name || '';
    io.to(roomId).emit('game_started', lobbies[roomId].state);
  });

  socket.on('playCard', ({ roomId, playedCard}) => {
    const lobby = lobbies[roomId];
    const state = lobby?.state;
    if (!state) return;

    const ownedCard = getOwnedCart(playedCard);

    // Validate turn
    if (state.currentPlayerId !== ownedCard.player.name) return;

    // Enforce suit-following rule
    if (state.currentTrick.length > 0) {
      const leadSuit = state.currentTrick[0].card.suit;
      const hasLeadSuit = ownedCard.player.hand.some((c: OwnedCard) => c.card.suit === leadSuit);
      if (hasLeadSuit && ownedCard.card.suit !== leadSuit) return; // Must follow suit if possible
    }

    // Remove card from player's hand
    ownedCard.player.hand = ownedCard.player.hand.filter((c: OwnedCard) => c.card.id !== ownedCard.card.id);

    // Add card to current trick
    state.currentTrick.push(ownedCard);

    // Advance turn to next player
    const playerIndex = lobby.players.findIndex(p => p.name === ownedCard.player.name);
    const nextIndex = (playerIndex + 1) % lobby.players.length;
    state.currentPlayerId = lobby.players[nextIndex].name;

    // If trick is complete (all players played)
    if (state.currentTrick.length === lobby.players.length) {
      // Determine winner (hearts are trumps)
      const rankOrder = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
      let winnerPlay;
      // Check for trumps
      const trumpCards = state.currentTrick.filter(tp => tp.card.suit === "hearts");
      if (trumpCards.length > 0) {
        trumpCards.sort((a, b) => rankOrder.indexOf(a.card.value) - rankOrder.indexOf(b.card.value));
        winnerPlay = trumpCards[trumpCards.length - 1];
      } else {
        const leadSuit = state.currentTrick[0].card.suit;
        const suitCards = state.currentTrick.filter(tp => tp.card.suit === leadSuit);
        suitCards.sort((a, b) => rankOrder.indexOf(a.card.value) - rankOrder.indexOf(b.card.value));
        winnerPlay = suitCards[suitCards.length - 1];
      }
      const winner = lobby.players.find(p => p.name === winnerPlay.player.name);
      if (winner) winner.tricksWon++;

      // Check if hand is over (all players have no cards)
      if (lobby.players.every(p => p.hand.length === 0)) {
        // Find hand winner(s)
        const maxTricks = Math.max(...lobby.players.map(p => p.tricksWon));
        const handWinners = lobby.players.filter(p => p.tricksWon === maxTricks);
        // All handWinners get a point
        handWinners.forEach(w => {
          lobby.scoreboard[w.name]++;
        });
        // Check for overall winner
        const maxScore = Math.max(...Object.values(lobby.scoreboard));
        const leaders = Object.entries(lobby.scoreboard).filter(([_, score]) => score === maxScore);
        if (maxScore >= 5 && leaders.length === 1) {
          // Game over, emit winner
          io.to(roomId).emit('game_over', lobby.players.find(p => p.name === leaders[0][0]));
        }
      }

      // Reset trick
      state.currentTrick = [];
      state.currentPlayerId = winner?.name || lobby.players[0].name;

      io.to(roomId).emit('trickComplete', {
        winner: winner?.name,
        tricksWon: winner?.tricksWon,
        state,
        scoreboard: lobby.scoreboard,
      });
    } else {
      io.to(roomId).emit('trickUpdate', state.currentTrick);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Remove player from all lobbies
    for (const roomId in lobbies) {
      const lobby = lobbies[roomId];
      // Find player by socket id (assume we store socketId in player object)
      const idx = lobby.players.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) {
        lobby.players.splice(idx, 1);
        lobby.state.players = lobby.players;
        io.to(roomId).emit('lobby_update', lobby.players);
      }
    }
  });
});

function createDeck(): Card[] {
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  const ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, value: rank, id: `${suit}-${rank}-${Math.random()}` });
    }
  }
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}