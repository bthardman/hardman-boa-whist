// Installing the game as an app. Chrome and Edge offer an install prompt we can show from
// Settings; everywhere else (Safari, Firefox) Settings explains how to do it from the browser.
import { get, writable } from 'svelte/store';

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** The browser's install offer, once it has made one (it's used up after being shown). */
export const installPrompt = writable<InstallPromptEvent | null>(null);

export type InstallPlatform = 'installed' | 'ios' | 'android' | 'desktop';

/** Already running as an installed app, or which instructions to show. */
export function installPlatform(): InstallPlatform {
  const standalone =
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return 'installed';
  const ua = navigator.userAgent;
  // iPads report themselves as Macs; the touch screen gives them away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return /Android/.test(ua) ? 'android' : 'desktop';
}

export async function promptInstall(): Promise<void> {
  const event = get(installPrompt);
  if (!event) return;
  installPrompt.set(null); // each offer can only be shown once
  await event.prompt();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Offered from Settings instead of a banner that could pop up over someone's cards mid-game.
    e.preventDefault();
    installPrompt.set(e as InstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => installPrompt.set(null));
}
