import io from 'socket.io-client';

const configuredSocketUrl = import.meta.env.VITE_SOCKET_URL?.trim();
const socketUrl =
  configuredSocketUrl ||
  (import.meta.env.PROD ? window.location.origin : 'http://localhost:3000');

export const socket = io(socketUrl, {
  transports: ['websocket', 'polling']
});
