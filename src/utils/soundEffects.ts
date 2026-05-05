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

class SoundEffects {
  private enabled = true;
  private cardsVolume = 1;
  private jinglesVolume = 1;
  private handWinAudio: HTMLAudioElement | null = null;
  private handLoseAudio: HTMLAudioElement | null = null;
  private trickWinAudio: HTMLAudioElement | null = null;
  private trickLoseAudio: HTMLAudioElement | null = null;
  private gameEndAudio: HTMLAudioElement | null = null;
  private bidDisplayAudio: HTMLAudioElement | null = null;
  private bidReceivedAudio: HTMLAudioElement | null = null;
  private yourTurnAudio: HTMLAudioElement | null = null;
  private buttonAudio: HTMLAudioElement | null = null;
  private avatarSelectAudio: HTMLAudioElement | null = null;
  private roundHandStartAudio: HTMLAudioElement | null = null;
  private gameStartAudio: HTMLAudioElement | null = null;
  private yourGoAudio: HTMLAudioElement | null = null;
  private cardAudios: HTMLAudioElement[] = [];

  constructor() {
    if (typeof window === 'undefined') return;
    const storedCardsRaw = localStorage.getItem('cardsVolume');
    const storedJinglesRaw = localStorage.getItem('jinglesVolume');
    if (storedCardsRaw !== null) {
      const storedCards = Number(storedCardsRaw);
      if (Number.isFinite(storedCards)) this.cardsVolume = this.clampVolume(storedCards / 100);
    }
    if (storedJinglesRaw !== null) {
      const storedJingles = Number(storedJinglesRaw);
      if (Number.isFinite(storedJingles)) this.jinglesVolume = this.clampVolume(storedJingles / 100);
    }
  }

  private clampVolume(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  private getChannelVolume(kind: 'win' | 'lose' | 'win_trick' | 'lose_trick' | 'game_end' | 'bid_display' | 'bid_received' | 'your_turn' | 'button' | 'avatar_select' | 'round_hand_start' | 'game_start' | 'your_go'): number {
    if (
      kind === 'button' ||
      kind === 'avatar_select' ||
      kind === 'game_start' ||
      kind === 'bid_received' ||
      kind === 'your_go'
    ) {
      return this.cardsVolume;
    }
    return this.jinglesVolume;
  }

  private playClip(kind: 'win' | 'lose' | 'win_trick' | 'lose_trick' | 'game_end' | 'bid_display' | 'bid_received' | 'your_turn' | 'button' | 'avatar_select' | 'round_hand_start' | 'game_start' | 'your_go'): void {
    if (!this.enabled) return;
    if (typeof window === 'undefined') return;
    const target =
      kind === 'win'
        ? 'handWinAudio'
        : kind === 'lose'
          ? 'handLoseAudio'
          : kind === 'win_trick'
            ? 'trickWinAudio'
            : kind === 'lose_trick'
              ? 'trickLoseAudio'
              : kind === 'game_end'
                ? 'gameEndAudio'
                : kind === 'bid_display'
                  ? 'bidDisplayAudio'
                  : kind === 'bid_received'
                    ? 'bidReceivedAudio'
                    : kind === 'your_turn'
                      ? 'yourTurnAudio'
                      : kind === 'button'
                        ? 'buttonAudio'
                        : kind === 'avatar_select'
                          ? 'avatarSelectAudio'
                          : kind === 'round_hand_start'
                            ? 'roundHandStartAudio'
                            : kind === 'game_start'
                              ? 'gameStartAudio'
                              : 'yourGoAudio';
    if (!this[target]) {
      const src =
        kind === 'win'
          ? winHandSfx
          : kind === 'lose'
            ? loseHandSfx
            : kind === 'win_trick'
              ? winTrickSfx
              : kind === 'lose_trick'
                ? loseTrickSfx
                : kind === 'game_end'
                  ? gameEndSfx
                  : kind === 'bid_display'
                    ? bidDisplaySfx
                    : kind === 'bid_received'
                      ? bidReceivedSfx
                      : kind === 'your_turn'
                        ? yourTurnSfx
                        : kind === 'button'
                          ? buttonSfx
                          : kind === 'avatar_select'
                            ? avatarSelectSfx
                            : kind === 'round_hand_start'
                              ? roundHandStartSfx
                              : kind === 'game_start'
                                ? gameStartSfx
                                : yourGoSfx;
      this[target] = new Audio(src);
      this[target]!.preload = 'auto';
    }
    const clip = this[target]!;
    clip.volume = this.getChannelVolume(kind);
    clip.currentTime = 0;
    void clip.play().catch(() => {
      // Ignore autoplay/user-gesture errors; game continues without sound.
    });
  }

  private playRandomCardClip(): void {
    if (!this.enabled) return;
    if (typeof window === 'undefined') return;
    if (this.cardAudios.length === 0) {
      const cardSources = [
        dealingCards1Sfx,
        dealingCards2Sfx,
        dealingCards3Sfx,
        dealingCards4Sfx,
        dealingCards5Sfx
      ];
      this.cardAudios = cardSources.map((src) => {
        const audio = new Audio(src);
        audio.preload = 'auto';
        return audio;
      });
    }
    const clip = this.cardAudios[Math.floor(Math.random() * this.cardAudios.length)];
    clip.volume = this.cardsVolume;
    clip.currentTime = 0;
    void clip.play().catch(() => {
      // Ignore autoplay/user-gesture errors; game continues without sound.
    });
  }

  playDeal(): void {
    this.playRandomCardClip();
  }

  playCard(): void {
    this.playRandomCardClip();
  }

  playTrickWin(): void {
    this.playClip('win_trick');
  }

  playTrickLose(): void {
    this.playClip('lose_trick');
  }

  playRoundWin(): void {
    this.playClip('win');
  }

  playHandWin(): void {
    this.playClip('win');
  }

  playHandLose(): void {
    this.playClip('lose');
  }

  playGameEnd(): void {
    this.playClip('game_end');
  }

  playBidDisplay(): void {
    this.playClip('bid_display');
  }

  playBidReceived(): void {
    this.playClip('bid_received');
  }

  playYourTurn(): void {
    this.playClip('your_turn');
  }

  playButton(): void {
    this.playClip('button');
  }

  playAvatarSelect(): void {
    this.playClip('avatar_select');
  }

  playRoundHandStart(): void {
    this.playClip('round_hand_start');
  }

  playGameStart(): void {
    this.playClip('game_start');
  }

  playYourGo(): void {
    this.playClip('your_go');
  }

  setEnabled(next: boolean): void {
    this.enabled = next;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setCardsVolume(next: number): void {
    this.cardsVolume = this.clampVolume(next);
  }

  getCardsVolume(): number {
    return this.cardsVolume;
  }

  setJinglesVolume(next: number): void {
    this.jinglesVolume = this.clampVolume(next);
  }

  getJinglesVolume(): number {
    return this.jinglesVolume;
  }
}

export const soundEffects = new SoundEffects();
