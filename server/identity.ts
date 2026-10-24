// Who a device is. Each device keeps a secret token; everyone else only ever sees a public id
// derived from it, so knowing someone's public id doesn't let you take their seat or see their cards.
import { createHash } from 'crypto';

const MIN_TOKEN_LENGTH = 8;
/** Longest token or room id accepted from a device. */
export const MAX_ID_LENGTH = 100;

export function isValidToken(token: unknown): token is string {
  return typeof token === 'string' && token.length >= MIN_TOKEN_LENGTH && token.length <= MAX_ID_LENGTH;
}

export function isValidRoomId(roomId: unknown): roomId is string {
  return typeof roomId === 'string' && roomId.length > 0 && roomId.length <= MAX_ID_LENGTH;
}

/** The id other devices see for this token. Stable, so a refresh or reconnect returns you to your seat. */
export function publicIdFor(token: string): string {
  return createHash('sha256').update(token).digest('base64url').slice(0, 16);
}
