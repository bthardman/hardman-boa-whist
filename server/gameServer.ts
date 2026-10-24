// Builds the game server: the web server (health check and the built front end) plus the
// Socket.IO game. A factory, so tests can start isolated servers with tiny timings.
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { createContext, type Ctx, type Timings } from './context.ts';
import { registerSocketHandlers } from './handlers.ts';
import { allowedOriginsFrom, originChecker } from './origins.ts';

export type GameServerOptions = Partial<Timings> & {
  /** Extra origins allowed to connect (comma-separated), e.g. the Cloudflare Pages site. */
  corsOrigins?: string;
  /** Where the built front end lives (default: ../dist). */
  distPath?: string;
};

export type GameServer = {
  ctx: Ctx;
  httpServer: http.Server;
  io: Server;
  /** Starts listening; resolves with the port (useful with port 0 in tests). */
  listen(port: number): Promise<number>;
  close(): Promise<void>;
};

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const { corsOrigins, distPath: distOption, ...timings } = options;
  const isAllowedOrigin = originChecker(allowedOriginsFrom(corsOrigins));
  const distPath = distOption ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    // Cross-origin access (the Vite dev server, the Cloudflare Pages site) is limited to the allow-list.
    cors: { origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)), methods: ['GET', 'POST'] },
    // Same-origin connections (the built app served by this server) are always allowed.
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
  const ctx = createContext(io, timings);

  // A tiny "are you awake?" check. The front end calls /awake to wake a sleeping free-tier server
  // (ad blockers sometimes block "/health"); Render uses /health as its health check.
  app.get(['/health', '/awake'], (req, res) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  });

  // Serve the built front end when available (the Render address still works as a fallback).
  app.use(express.static(distPath));
  app.get(/^(?!\/socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  io.on('connection', (socket) => registerSocketHandlers(ctx, socket));

  return {
    ctx,
    httpServer,
    io,
    listen(port) {
      return new Promise((resolve) => {
        httpServer.listen(port, () => resolve((httpServer.address() as AddressInfo).port));
      });
    },
    async close() {
      ctx.clearAllTimers();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  };
}
