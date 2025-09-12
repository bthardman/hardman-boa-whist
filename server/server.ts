import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import type { Player, Card, GameState, TrickPlay } from "../src/types";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const lobbies: Record<string, { players: Player[]; state: GameState }> = {};

function createDeck(): Card[] {
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  const ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  const deck: Card[] = [];
  for (const suit of suits) for (const rank of ranks) deck.push({ suit, rank });
  return deck;
}

// Helper to deal 7 cards to each player
function dealHands(players: Player[]) {
  const deck = createDeck().sort
