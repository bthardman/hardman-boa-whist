import io from 'socket.io-client';

const configuredSocketUrl = import.meta.env.VITE_SOCKET_URL?.trim();
/** The game server: set separately when the front end is hosted elsewhere (e.g. Cloudflare Pages). */
export const serverUrl =
  configuredSocketUrl ||
  (import.meta.env.PROD ? window.location.origin : 'http://localhost:3000');

export const socket = io(serverUrl, {
  transports: ['websocket', 'polling']
});
