import { svelte } from '@sveltejs/vite-plugin-svelte';

export default {
  plugins: [svelte()],
  // In development the stats come through the game server (see server/gameServer.ts).
  server: { proxy: { '/api': 'http://localhost:3000' } },
};
