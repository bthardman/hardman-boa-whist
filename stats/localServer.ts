// Runs the stats API (the same code as the Cloudflare Pages Functions) on a local port, backed
// by Node's built-in SQLite. For tests and trying stats out locally; not used in production.
import http from 'http';
import type { AddressInfo } from 'net';
import { onRequestPost } from '../functions/api/games.ts';
import { onRequestGet } from '../functions/api/stats.ts';
import * as settingsApi from '../functions/api/settings.ts';
import { sqliteD1 } from './sqliteD1.ts';

export type LocalStatsServer = { url: string; close(): Promise<void> };

export async function startLocalStatsServer(options: { secret: string; port?: number; file?: string }): Promise<LocalStatsServer> {
  const env = { DB: sqliteD1(options.file), STATS_SECRET: options.secret };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const url = `http://localhost${req.url ?? '/'}`;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === 'POST' || req.method === 'PUT' ? Buffer.concat(chunks) : undefined
    });
    const path = new URL(url).pathname;
    let response: Response;
    if (path === '/api/games' && req.method === 'POST') response = await onRequestPost({ request, env });
    else if (path === '/api/stats' && req.method === 'GET') response = await onRequestGet({ request, env });
    else if (path === '/api/settings' && req.method === 'GET') response = await settingsApi.onRequestGet({ request, env });
    else if (path === '/api/settings' && req.method === 'PUT') response = await settingsApi.onRequestPut({ request, env });
    else response = new Response('Not found', { status: 404 });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
