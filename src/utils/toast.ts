import { writable } from 'svelte/store';

export type Toast = { id: number; message: string };

export const toasts = writable<Toast[]>([]);
let nextId = 1;

/** Shows a short message at the top of the screen (e.g. a rejected move). */
export function showToast(message: string, ms = 3200): void {
  if (!message) return;
  const id = nextId++;
  toasts.update((list) => [...list.filter((t) => t.message !== message), { id, message }]);
  setTimeout(() => toasts.update((list) => list.filter((t) => t.id !== id)), ms);
}
