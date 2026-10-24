// Starts the game server. CORS_ORIGIN allows the separately hosted front end to connect;
// ABANDONED_GAME_MS can shorten the abandoned-game timeout (handy when testing).
import { createGameServer } from './gameServer.ts';

const game = createGameServer({
  corsOrigins: process.env.CORS_ORIGIN,
  statsUrl: process.env.STATS_URL,
  statsSecret: process.env.STATS_SECRET,
  abandonedGameMs: process.env.ABANDONED_GAME_MS ? Number(process.env.ABANDONED_GAME_MS) : undefined
});

const port = await game.listen(Number(process.env.PORT) || 3000);
console.log(`Server listening on port ${port}`);
