// Keeps the screen on during a game, so a phone or tablet doesn't lock mid-round (and drop out).
// Browsers release the lock whenever the page is hidden, so it's asked for again on return.

let wanted = false;
let requesting = false;
let lock: WakeLockSentinel | null = null;

async function acquire(): Promise<void> {
  if (!wanted || lock || requesting || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  requesting = true;
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    if (!wanted) {
      // Switched off while the browser was deciding.
      void sentinel.release().catch(() => {});
      return;
    }
    lock = sentinel;
    sentinel.addEventListener('release', () => {
      if (lock === sentinel) lock = null;
    });
  } catch {
    /* not allowed right now (e.g. battery saver): the game carries on */
  } finally {
    requesting = false;
  }
}

/** Turns the keep-awake on (during a game) or off. Safe to call repeatedly. */
export function setKeepAwake(on: boolean): void {
  wanted = on;
  if (on) {
    void acquire();
  } else if (lock) {
    void lock.release().catch(() => {});
    lock = null;
  }
}

/** Asks again after a tap: some browsers only grant the lock in response to one. */
export function retryKeepAwake(): void {
  void acquire();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire();
  });
}
