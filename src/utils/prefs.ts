// Per-device preferences, shared by every screen. Persisted via cookies (see playerPrefsCookies).
import { writable } from 'svelte/store';
import {
  persistCardsVolumePct,
  persistJinglesVolumePct,
  persistScreenTurnFlash,
  readScreenTurnFlashEnabled,
  readVolumePrefs,
  readTextSize,
  persistTextSize,
  type TextSize
} from './playerPrefsCookies';
import { soundEffects } from './soundEffects';

const initialVolumes = typeof document !== 'undefined' ? readVolumePrefs() : { cardsVolume: 100, jinglesVolume: 100 };

/** Sound effects volume, 0–100. */
export const fxVolume = writable(initialVolumes.cardsVolume);
/** Music / jingle volume, 0–100. */
export const musicVolume = writable(initialVolumes.jinglesVolume);
/** Gold edge flash when it becomes your turn. */
export const turnFlash = writable(typeof document !== 'undefined' ? readScreenTurnFlashEnabled() : true);

fxVolume.subscribe((v) => {
  soundEffects.setCardsVolume(v / 100);
  if (typeof document !== 'undefined') persistCardsVolumePct(v);
});
musicVolume.subscribe((v) => {
  soundEffects.setJinglesVolume(v / 100);
  if (typeof document !== 'undefined') persistJinglesVolumePct(v);
});
turnFlash.subscribe((on) => {
  if (typeof document !== 'undefined') persistScreenTurnFlash(on);
});

const TEXT_SCALE: Record<TextSize, number> = { standard: 1, large: 1.15, largest: 1.3 };

/** Text size for this device. Scales everything sized in rem via the root font size. */
export const textSize = writable<TextSize>(typeof document !== 'undefined' ? readTextSize() : 'standard');

textSize.subscribe((size) => {
  if (typeof document === 'undefined') return;
  persistTextSize(size);
  document.documentElement.style.setProperty('--ui-scale', String(TEXT_SCALE[size]));
  document.documentElement.dataset.textSize = size;
});
