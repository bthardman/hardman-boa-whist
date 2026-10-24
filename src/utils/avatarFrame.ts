// Seat photos alternate between each person's two pictures. One shared timer drives every seat
// (and only runs while a seat is showing), instead of rewriting the game state for each player.
import { readable } from 'svelte/store';

export type AvatarFrame = 1 | 2;

export const avatarFrame = readable<AvatarFrame>(1, (set) => {
  let frame: AvatarFrame = 1;
  const timer = setInterval(() => {
    frame = frame === 1 ? 2 : 1;
    set(frame);
  }, 2400);
  return () => clearInterval(timer);
});
