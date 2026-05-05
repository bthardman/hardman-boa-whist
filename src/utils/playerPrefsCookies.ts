const COOKIE_CARDS = 'boa_whist_cardsVolume';
const COOKIE_JINGLES = 'boa_whist_jinglesVolume';
const COOKIE_SCREEN_FLASH = 'boa_whist_screenTurnFlash';

/** Legacy keys — migrated into cookies on read. */
const LS_CARDS = 'cardsVolume';
const LS_JINGLES = 'jinglesVolume';

const MAX_AGE_YEAR_SEC = 60 * 60 * 24 * 365;

export type VolumePrefs = {
  cardsVolume: number;
  jinglesVolume: number;
};

function getClientCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const parts = document.cookie.split(';');
  for (const raw of parts) {
    const p = raw.trim();
    if (!p.startsWith(prefix)) continue;
    return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

function setClientCookie(name: string, value: string, maxAgeSec = MAX_AGE_YEAR_SEC): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax`;
}

function parsePercent(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Used by sound singleton and UI to load volumes; pulls from cookies first, then migrates legacy localStorage. */
export function readVolumePrefs(): VolumePrefs {
  let cards = parsePercent(getClientCookie(COOKIE_CARDS));
  let jingles = parsePercent(getClientCookie(COOKIE_JINGLES));

  if (cards === null && typeof localStorage !== 'undefined') {
    cards = parsePercent(localStorage.getItem(LS_CARDS));
    if (cards !== null) setClientCookie(COOKIE_CARDS, String(cards));
  }
  if (jingles === null && typeof localStorage !== 'undefined') {
    jingles = parsePercent(localStorage.getItem(LS_JINGLES));
    if (jingles !== null) setClientCookie(COOKIE_JINGLES, String(jingles));
  }

  return {
    cardsVolume: cards ?? 100,
    jinglesVolume: jingles ?? 100
  };
}

export function persistCardsVolumePct(percent: number): void {
  const v = Math.max(0, Math.min(100, Math.round(percent)));
  setClientCookie(COOKIE_CARDS, String(v));
  try {
    localStorage.setItem(LS_CARDS, String(v));
  } catch {
    /* ignore quota / private mode */
  }
}

export function persistJinglesVolumePct(percent: number): void {
  const v = Math.max(0, Math.min(100, Math.round(percent)));
  setClientCookie(COOKIE_JINGLES, String(v));
  try {
    localStorage.setItem(LS_JINGLES, String(v));
  } catch {
    /* ignore */
  }
}

/** Default on when unset (matches previous always-on behaviour). */
export function readScreenTurnFlashEnabled(): boolean {
  const raw = getClientCookie(COOKIE_SCREEN_FLASH);
  if (raw === null || raw === '') return true;
  return raw !== '0' && raw.toLowerCase() !== 'false';
}

export function persistScreenTurnFlash(enabled: boolean): void {
  setClientCookie(COOKIE_SCREEN_FLASH, enabled ? '1' : '0');
}
