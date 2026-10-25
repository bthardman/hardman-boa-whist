import { writable } from 'svelte/store';

/** 'info': news and gentle explanations ("Carol joined"). 'error': something you tried was refused. */
export type ToastKind = 'info' | 'error';
export type Toast = { id: number; message: string; kind: ToastKind };

export const toasts = writable<Toast[]>([]);
let nextId = 1;

/** Shows a short message at the top of the screen. Errors stay up a little longer. */
export function showToast(message: string, kind: ToastKind = 'info', ms = kind === 'error' ? 4000 : 3200): void {
  if (!message) return;
  const id = nextId++;
  toasts.update((list) => [...list.filter((t) => t.message !== message), { id, message, kind }]);
  setTimeout(() => toasts.update((list) => list.filter((t) => t.id !== id)), ms);
}
