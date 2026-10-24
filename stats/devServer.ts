// `npm run stats-server`: the stats API on http://localhost:8788, saved to stats-local.db, so stats
// work when running the game locally. Start the game server with the matching STATS_URL and
// STATS_SECRET (see the README).
import { startLocalStatsServer } from './localServer.ts';

const secret = process.env.STATS_SECRET || 'local-stats-secret';
const server = await startLocalStatsServer({
  secret,
  port: Number(process.env.STATS_PORT) || 8788,
  file: process.env.STATS_DB || 'stats-local.db'
});
console.log(`Stats API on ${server.url} (secret: ${secret})`);
