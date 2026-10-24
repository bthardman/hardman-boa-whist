// Game sounds. Played through the Web Audio API so the volume settings work everywhere: iPhones
// and iPads ignore the volume of plain <audio> elements. Falls back to <audio> if Web Audio is missing.
import winHandSfx from '../assets/sounds/win-hand.wav';
import loseHandSfx from '../assets/sounds/lose-hand.wav';
import dealingCards1Sfx from '../assets/sounds/dealing-cards-1.wav';
import dealingCards2Sfx from '../assets/sounds/dealing-cards-2.wav';
import dealingCards3Sfx from '../assets/sounds/dealing-cards-3.wav';
import dealingCards4Sfx from '../assets/sounds/dealing-cards-4.wav';
import dealingCards5Sfx from '../assets/sounds/dealing-cards-5.wav';
import winTrickSfx from '../assets/sounds/win-trick.wav';
import loseTrickSfx from '../assets/sounds/lose-trick.wav';
import gameEndSfx from '../assets/sounds/game-end.wav';
import bidDisplaySfx from '../assets/sounds/bid-display.wav';
import bidReceivedSfx from '../assets/sounds/bid-received.wav';
import yourTurnSfx from '../assets/sounds/your-turn.wav';
import buttonSfx from '../assets/sounds/button.wav';
import avatarSelectSfx from '../assets/sounds/avatar-select.wav';
import roundHandStartSfx from '../assets/sounds/round-hand-start.wav';
import gameStartSfx from '../assets/sounds/game-start.wav';
import yourGoSfx from '../assets/sounds/your-go.wav';
import { readVolumePrefs } from './playerPrefsCookies';

/** "fx" follows the Sound effects slider, "music" the Music slider. */
type Channel = 'fx' | 'music';

const CARD_SOUNDS = [dealingCards1Sfx, dealingCards2Sfx, dealingCards3Sfx, dealingCards4Sfx, dealingCards5Sfx];

/** A sound that can't start within this long (still loading, or audio not yet allowed) is skipped, not played late. */
const MAX_START_DELAY_MS = 3000;

const clampVolume = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

class SoundEffects {
  private volumes: Record<Channel, number> = { fx: 1, music: 1 };
  private context: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private fallbacks = new Map<string, HTMLAudioElement>();

  constructor() {
    if (typeof window === 'undefined') return;
    const { cardsVolume, jinglesVolume } = readVolumePrefs();
    this.volumes = { fx: clampVolume(cardsVolume / 100), music: clampVolume(jinglesVolume / 100) };
  }

  /** Browsers only allow sound after a tap, so call this from a tap handler. */
  unlock(): void {
    const ctx = this.audioContext();
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
  }

  private audioContext(): AudioContext | null {
    if (this.context || typeof window === 'undefined') return this.context;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.context = new Ctor();
    } catch {
      return null;
    }
    return this.context;
  }

  private loadBuffer(ctx: AudioContext, src: string): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(src);
    if (!pending) {
      pending = fetch(src)
        .then((res) => res.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null);
      this.buffers.set(src, pending);
    }
    return pending;
  }

  private play(src: string, channel: Channel): void {
    if (typeof window === 'undefined') return;
    const volume = this.volumes[channel];
    if (volume <= 0) return; // muted: don't play at all
    const ctx = this.audioContext();
    if (!ctx) {
      this.playFallback(src, volume);
      return;
    }
    const requestedAt = Date.now();
    const ready = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
    void Promise.all([ready, this.loadBuffer(ctx, src)])
      .then(([, buffer]) => {
        // Skip rather than play a stale sound (e.g. queued up before audio was allowed).
        if (!buffer || ctx.state !== 'running' || Date.now() - requestedAt > MAX_START_DELAY_MS) return;
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.value = volume;
        source.buffer = buffer;
        source.connect(gain).connect(ctx.destination);
        source.start();
      })
      .catch(() => {
        /* audio not allowed yet: the game carries on silently */
      });
  }

  private playFallback(src: string, volume: number): void {
    let clip = this.fallbacks.get(src);
    if (!clip) {
      clip = new Audio(src);
      clip.preload = 'auto';
      this.fallbacks.set(src, clip);
    }
    clip.volume = volume;
    clip.currentTime = 0;
    void clip.play().catch(() => {
      /* autoplay / decode errors: carry on without sound */
    });
  }

  playCard(): void {
    this.play(CARD_SOUNDS[Math.floor(Math.random() * CARD_SOUNDS.length)], 'fx');
  }
  playTrickWin(): void {
    this.play(winTrickSfx, 'music');
  }
  playTrickLose(): void {
    this.play(loseTrickSfx, 'music');
  }
  playHandWin(): void {
    this.play(winHandSfx, 'music');
  }
  playHandLose(): void {
    this.play(loseHandSfx, 'music');
  }
  playGameEnd(): void {
    this.play(gameEndSfx, 'music');
  }
  playBidDisplay(): void {
    this.play(bidDisplaySfx, 'music');
  }
  playBidReceived(): void {
    this.play(bidReceivedSfx, 'fx');
  }
  playYourTurn(): void {
    this.play(yourTurnSfx, 'music');
  }
  playButton(): void {
    this.play(buttonSfx, 'fx');
  }
  playAvatarSelect(): void {
    this.play(avatarSelectSfx, 'fx');
  }
  playRoundHandStart(): void {
    this.play(roundHandStartSfx, 'music');
  }
  playGameStart(): void {
    this.play(gameStartSfx, 'fx');
  }
  playYourGo(): void {
    this.play(yourGoSfx, 'fx');
  }

  setCardsVolume(next: number): void {
    this.volumes.fx = clampVolume(next);
  }
  setJinglesVolume(next: number): void {
    this.volumes.music = clampVolume(next);
  }
}

export const soundEffects = new SoundEffects();
