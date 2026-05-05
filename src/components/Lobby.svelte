<script lang="ts">
  import { onMount, onDestroy, tick, afterUpdate } from 'svelte';
  import { gameState, roomId, localPlayer } from '../store';
  import type { Player } from '../../shared/types';
  import { AvatarChoice } from '../../shared/types';
  import { socket } from "../socket";
  import { getAvatarData, getPlayerName } from '../avatarData';
  import { registerErrorHandler, unregisterErrorHandler } from '../utils/socketHandlers';
  import { soundEffects } from '../utils/soundEffects';
  import {
    persistCardsVolumePct,
    persistJinglesVolumePct,
    persistScreenTurnFlash,
    readScreenTurnFlashEnabled,
    readVolumePrefs
  } from '../utils/playerPrefsCookies';

  let errorMessage = '';
  let blockedMessage = '';
  let settingsOpen = false;
  let cardsVolume = 100;
  let jinglesVolume = 100;
  let screenTurnFlashEnabled =
    typeof document !== 'undefined' ? readScreenTurnFlashEnabled() : true;
  let gameSpeed: 'slow' | 'normal' | 'fast' = 'normal';
  let localWinningScore = 5;
  const winningScoreOptions = [1, 2, 3, 4, 5];
  const preferredAvatarOrder = ['Tony', 'Rowan', 'Brad', 'Carol', 'Derek', 'Angela', 'Vanessa', 'Afroditi'];
  const avatarChoices = (
    Object.values(AvatarChoice).filter((c) => c !== AvatarChoice.UNDEFINED) as AvatarChoice[]
  ).sort((a, b) => {
    const nameA = getPlayerName(a);
    const nameB = getPlayerName(b);
    const idxA = preferredAvatarOrder.indexOf(nameA);
    const idxB = preferredAvatarOrder.indexOf(nameB);
    const rankA = idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA;
    const rankB = idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB;
    if (rankA !== rankB) return rankA - rankB;
    return nameA.localeCompare(nameB);
  });
  let carouselIndex = 0;
  let currentDisplayIndex = 0;
  let suppressScrollSyncUntil = 0;
  let introStage: 'pending' | 'pending_shrink' | 'splash' | 'dock' | 'carousel' | 'done' =
    'pending';
  const introTimers: ReturnType<typeof setTimeout>[] = [];
  let pendingShrinkFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** Safety net if animationend doesn’t fire; ~one frame longer than CSS shrink + fill. */
  const PENDING_SHRINK_MS = 240;
  let tapHintIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let showPendingTapHint = false;
  const TAP_LOGO_HINT_IDLE_MS = 5000;
  let introFaceFrame: 1 | 2 = 1;
  let introFaceTimer: ReturnType<typeof setInterval> | null = null;
  let hasPlayedIntroSound = false;
  let lobbyScroller: HTMLDivElement | null = null;
  let carouselCards: Array<HTMLDivElement | null> = [];
  const infiniteRepeatCount = 11;
  const preferredAvatarCookie = 'preferredAvatarChoice';
  const introOrbitSeeds = [
    { x: -36, y: -22, path: 'a' }
  ] as const;
  let introOrbitBubbles: Array<{
    avatarChoice: AvatarChoice;
    burstTx: string;
    burstTy: string;
    burstTxAlt: string;
    burstTyAlt: string;
    duration: string;
    delay: string;
    size: string;
  }> = [];
  let restoredPreferredAvatar = false;
  $: hasInfiniteCarousel = avatarChoices.length > 1;
  $: introOrbitBubbles = avatarChoices.flatMap((avatarChoice, avatarIdx) => {
    return introOrbitSeeds.map((_, copyIdx) => {
      const seed = avatarIdx * 3 + copyIdx;
      const angleDeg = (seed * 137.508) % 360;
      const rad = (angleDeg * Math.PI) / 180;
      const altRad = ((angleDeg + 180 + 12) * Math.PI) / 180;
      const distVw = 58 + (seed % 6) * 1.6;
      const distVh = 48 + (seed % 5) * 1.8;
      const altDistVw = 50 + (seed % 6) * 1.2;
      const altDistVh = 42 + (seed % 5) * 1.4;
      const burstTx = `${(Math.cos(rad) * distVw).toFixed(2)}vw`;
      const burstTy = `${(Math.sin(rad) * distVh).toFixed(2)}vh`;
      const burstTxAlt = `${(Math.cos(altRad) * altDistVw).toFixed(2)}vw`;
      const burstTyAlt = `${(Math.sin(altRad) * altDistVh).toFixed(2)}vh`;
      const durationSec = 4.1 + (seed % 5) * 0.22;
      const duration = `${durationSec.toFixed(2)}s`;
      const delay = '0s';
      const size = `${50 + (seed % 5) * 6}px`;
      return { avatarChoice, burstTx, burstTy, burstTxAlt, burstTyAlt, duration, delay, size };
    });
  });
  $: carouselCycleLength = avatarChoices.length;
  $: carouselRenderChoices = hasInfiniteCarousel
    ? Array.from({ length: carouselCycleLength * infiniteRepeatCount }, (_, i) => avatarChoices[i % carouselCycleLength])
    : avatarChoices;
  $: gameSpeed = $gameState?.gameSpeed === 'slow' || $gameState?.gameSpeed === 'fast' ? $gameState.gameSpeed : 'normal';

  $: localWinningScore = $gameState?.winningScore ?? 5;
  $: if ($localPlayer && $localPlayer.selectedAvatar !== AvatarChoice.UNDEFINED) {
    const selectedIndex = avatarChoices.findIndex((c) => c === $localPlayer?.selectedAvatar);
    if (selectedIndex >= 0) carouselIndex = selectedIndex;
  }
  $: if ($localPlayer && $gameState && !restoredPreferredAvatar) {
    restoredPreferredAvatar = true;
    const preferredAvatar = getPreferredAvatarFromCookie();
    if (preferredAvatar && preferredAvatar !== AvatarChoice.UNDEFINED) {
      const preferredIndex = avatarChoices.findIndex((choice) => choice === preferredAvatar);
      if (preferredIndex >= 0) {
        scrollToCarouselIndex(preferredIndex, 'auto');

        const localSelectedAvatar = $localPlayer.selectedAvatar;
        const isTakenByOtherPlayer = $gameState.players.some(
          (player) => player.playerId !== $localPlayer!.playerId && player.selectedAvatar === preferredAvatar
        );
        if (localSelectedAvatar === AvatarChoice.UNDEFINED && !isTakenByOtherPlayer) {
          socket.emit("select_avatar", {
            roomId: $roomId,
            playerId: $localPlayer.playerId,
            avatarChoice: preferredAvatar
          });
        }
      }
    }
  }

  function setPreferredAvatarCookie(avatarChoice: AvatarChoice) {
    if (typeof document === 'undefined') return;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 365);
    document.cookie = `${preferredAvatarCookie}=${encodeURIComponent(String(avatarChoice))}; expires=${expiry.toUTCString()}; path=/; SameSite=Lax`;
  }

  function getPreferredAvatarFromCookie(): AvatarChoice | null {
    if (typeof document === 'undefined') return null;
    const encodedName = `${preferredAvatarCookie}=`;
    const parts = document.cookie.split(';');
    for (const rawPart of parts) {
      const part = rawPart.trim();
      if (!part.startsWith(encodedName)) continue;
      const decoded = decodeURIComponent(part.slice(encodedName.length));
      const asNumber = Number(decoded);
      if (!Number.isFinite(asNumber)) return null;
      const avatar = asNumber as AvatarChoice;
      return avatarChoices.includes(avatar) ? avatar : null;
    }
    return null;
  }

  function startGame() {
    if (introStage !== 'done') return;
    soundEffects.playGameStart();
    socket.emit("start_game", { roomId: $roomId });
  }

  function setWinningScore(score: number) {
    if (!$gameState || $gameState.state !== 'lobby') return;
    socket.emit('set_winning_score', { roomId: $roomId, winningScore: score });
  }

  function setGameSpeed(speed: 'slow' | 'normal' | 'fast') {
    socket.emit('set_game_speed', { roomId: $roomId, gameSpeed: speed });
  }

  function setCardsVolume(next: number) {
    cardsVolume = Math.max(0, Math.min(100, next));
    persistCardsVolumePct(cardsVolume);
    soundEffects.setCardsVolume(cardsVolume / 100);
  }

  function setJinglesVolume(next: number) {
    jinglesVolume = Math.max(0, Math.min(100, next));
    persistJinglesVolumePct(jinglesVolume);
    soundEffects.setJinglesVolume(jinglesVolume / 100);
  }

  function setScreenTurnFlashEnabled(on: boolean) {
    screenTurnFlashEnabled = on;
    persistScreenTurnFlash(on);
  }

  function toggleSettings() {
    if (introStage !== 'done') return;
    settingsOpen = !settingsOpen;
  }

  function closeSettings() {
    settingsOpen = false;
  }

  function resetLobby() {
    if (!$gameState || $gameState.state !== 'lobby') return;
    socket.emit('reset_lobby', { roomId: $roomId });
    settingsOpen = false;
  }

  function handleError(message: string) {
    errorMessage = message;
    setTimeout(() => errorMessage = '', 3000);
  }

  function handleJoinBlocked(message: string) {
    blockedMessage = message || 'Unable to join this game.';
  }

  function refreshPage() {
    window.location.reload();
  }

  function finishPendingShrinkIntoSplash() {
    if (introStage !== 'pending_shrink') return;
    if (pendingShrinkFallbackTimer) {
      clearTimeout(pendingShrinkFallbackTimer);
      pendingShrinkFallbackTimer = null;
    }
    for (const t of introTimers) clearTimeout(t);
    introTimers.length = 0;
    runIntroSequence();
  }

  function beginLobbyIntro() {
    if (introStage !== 'pending') return;
    clearTapLogoHintTimer();
    showPendingTapHint = false;
    soundEffects.playGameStart();
    hasPlayedIntroSound = true;
    if (pendingShrinkFallbackTimer) {
      clearTimeout(pendingShrinkFallbackTimer);
      pendingShrinkFallbackTimer = null;
    }
    introStage = 'pending_shrink';
    const shrinkSafetyMs =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 60
        : PENDING_SHRINK_MS;
    pendingShrinkFallbackTimer = setTimeout(finishPendingShrinkIntoSplash, shrinkSafetyMs);
  }

  function onPendingLogoShrinkDone(_e: AnimationEvent) {
    finishPendingShrinkIntoSplash();
  }

  function runIntroSequence() {
    introStage = 'splash';
    if (!hasPlayedIntroSound) {
      soundEffects.playGameStart();
      hasPlayedIntroSound = true;
    }
    introTimers.push(
      setTimeout(() => {
        introStage = 'dock';
      }, 3000)
    );
    introTimers.push(
      setTimeout(() => {
        introStage = 'carousel';
        runCarouselIntroSpin();
      }, 3800)
    );
    introTimers.push(
      setTimeout(() => {
        introStage = 'done';
      }, 5000)
    );
  }

  function runCarouselIntroSpin() {
    if (!hasInfiniteCarousel || carouselCards.length === 0) return;
    const finalDisplay = getMiddleDisplayIndex(carouselIndex);
    const spinOffset = Math.max(avatarChoices.length * 2, 4);
    const startDisplay = Math.min(carouselRenderChoices.length - 1, finalDisplay + spinOffset);
    suppressScrollSyncUntil = Date.now() + 1600;
    scrollToDisplayIndex(startDisplay, 'auto');
    currentDisplayIndex = startDisplay;
    carouselIndex = displayToRealIndex(startDisplay);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToDisplayIndex(finalDisplay, 'smooth');
        currentDisplayIndex = finalDisplay;
        carouselIndex = displayToRealIndex(finalDisplay);
      });
    });
  }

  onMount(() => {
    // Set body class for background
    document.body.classList.add('lobby-bg');
    document.documentElement.classList.add('lobby-bg');

    // Register error handlers
    registerErrorHandler("avatar_selection_error", handleError);
    registerErrorHandler("start_game_error", handleError);
    registerErrorHandler("join_error", handleJoinBlocked);
    const volumes = readVolumePrefs();
    cardsVolume = volumes.cardsVolume;
    jinglesVolume = volumes.jinglesVolume;
    screenTurnFlashEnabled = readScreenTurnFlashEnabled();
    soundEffects.setCardsVolume(cardsVolume / 100);
    soundEffects.setJinglesVolume(jinglesVolume / 100);
    void tick().then(() => {
      if (hasInfiniteCarousel) {
        const initialDisplay = getMiddleDisplayIndex(carouselIndex);
        requestAnimationFrame(() => {
          scrollToDisplayIndex(initialDisplay, 'auto');
          currentDisplayIndex = initialDisplay;
        });
      }
    });

    return () => {
      clearTapLogoHintTimer();
      if (pendingShrinkFallbackTimer) {
        clearTimeout(pendingShrinkFallbackTimer);
        pendingShrinkFallbackTimer = null;
      }
      unregisterErrorHandler("avatar_selection_error");
      unregisterErrorHandler("start_game_error");
      unregisterErrorHandler("join_error");
      document.body.classList.remove('lobby-bg');
      document.documentElement.classList.remove('lobby-bg');
    };
  });

  onDestroy(() => {
    unregisterErrorHandler("avatar_selection_error");
    unregisterErrorHandler("start_game_error");
    unregisterErrorHandler("join_error");
    clearTapLogoHintTimer();
    if (pendingShrinkFallbackTimer) {
      clearTimeout(pendingShrinkFallbackTimer);
      pendingShrinkFallbackTimer = null;
    }
    for (const timer of introTimers) clearTimeout(timer);
    introTimers.length = 0;
    if (introFaceTimer) {
      clearInterval(introFaceTimer);
      introFaceTimer = null;
    }
    document.body.classList.remove('lobby-bg');
    document.documentElement.classList.remove('lobby-bg');
  });

  $: {
    if (introStage === 'splash' && !introFaceTimer) {
      introFaceTimer = setInterval(() => {
        introFaceFrame = introFaceFrame === 1 ? 2 : 1;
      }, 820);
    } else if (introStage !== 'splash' && introFaceTimer) {
      clearInterval(introFaceTimer);
      introFaceTimer = null;
    }
  }

  /** Schedules idle hint without reactive deps on `tapHintIdleTimer` (avoids re-run wiping the hint when the timer resolves). */
  let lastIntroStageForTapHint: typeof introStage | null = null;
  afterUpdate(() => {
    if (lastIntroStageForTapHint === introStage) return;
    lastIntroStageForTapHint = introStage;
    if (tapHintIdleTimer !== null) {
      clearTimeout(tapHintIdleTimer);
      tapHintIdleTimer = null;
    }
    showPendingTapHint = false;
    if (introStage === 'pending') {
      tapHintIdleTimer = setTimeout(() => {
        showPendingTapHint = true;
      }, TAP_LOGO_HINT_IDLE_MS);
    }
  });

  function clearTapLogoHintTimer(): void {
    if (tapHintIdleTimer !== null) {
      clearTimeout(tapHintIdleTimer);
      tapHintIdleTimer = null;
    }
  }

  function selectPlayerAvatar(avatarChoice: AvatarChoice) {
    if (introStage !== 'done') return;
    if (!$localPlayer || !$gameState) return;

    if (getAvatarSelectionState($gameState.players, avatarChoice).isSelectedByMe) {
      socket.emit("select_avatar", {
        roomId: $roomId,
        playerId: $localPlayer.playerId,
        avatarChoice: AvatarChoice.UNDEFINED
      });
      return;
    }

    const isTaken = $gameState.players.some(
      (p) =>
        p.playerId !== $localPlayer!.playerId &&
        p.selectedAvatar !== AvatarChoice.UNDEFINED &&
        p.selectedAvatar === avatarChoice
    );

    if (isTaken) {
      errorMessage = 'Avatar already selected by another player';
      setTimeout(() => errorMessage = '', 3000);
      return;
    }

    socket.emit("select_avatar", { 
      roomId: $roomId, 
      playerId: $localPlayer.playerId, 
      avatarChoice
    });
    setPreferredAvatarCookie(avatarChoice);
    soundEffects.playAvatarSelect();
  }

  function canStartGame(players: Player[]): boolean {
    return players.filter(p => p.selectedAvatar !== AvatarChoice.UNDEFINED).length >= 2;
  }

  function getAvatarSelectionState(players: Player[], avatarChoice: AvatarChoice) {
    const selectedByPlayer = players.find(p => p.selectedAvatar === avatarChoice);
    return {
      isSelected: !!selectedByPlayer,
      selectedByPlayerId: selectedByPlayer?.playerId,
      isSelectedByMe: $localPlayer ? selectedByPlayer?.playerId === $localPlayer.playerId : false
    };
  }

  function getAvatarBorderColor(players: Player[], avatarChoice: AvatarChoice) {
    const state = getAvatarSelectionState(players, avatarChoice);
    if (state.isSelected) {
      return state.isSelectedByMe ? '#5AB9F2' : '#D81B60'; // Green for me, red for others
    }
    return '#ccc'; // Grey for unselected
  }

  function getReadyTextColor(players: Player[], avatarChoice: AvatarChoice) {
    const state = getAvatarSelectionState(players, avatarChoice);
    if (state.isSelected) {
      return state.isSelectedByMe ? '#5AB9F2' : '#D81B60'; // Same colors
    }
    return '#aaa'; // Waiting text can remain orange
  }

  function scrollToCarouselIndex(index: number, behavior: ScrollBehavior = 'smooth') {
    if (avatarChoices.length === 0) return;
    const wrapped = ((index % avatarChoices.length) + avatarChoices.length) % avatarChoices.length;
    carouselIndex = wrapped;
    const displayIndex = hasInfiniteCarousel ? getMiddleDisplayIndex(wrapped) : wrapped;
    const card = carouselCards[displayIndex];
    if (card) {
      card.scrollIntoView({ behavior, block: 'nearest', inline: 'center' });
      currentDisplayIndex = displayIndex;
    }
  }

  function scrollToDisplayIndex(displayIndex: number, behavior: ScrollBehavior = 'smooth') {
    const card = carouselCards[displayIndex];
    if (card) {
      card.scrollIntoView({ behavior, block: 'nearest', inline: 'center' });
    }
  }

  function getNearestDisplayInfo(): { index: number; distance: number } {
    if (!lobbyScroller || carouselCards.length === 0) {
      return { index: hasInfiniteCarousel ? getMiddleDisplayIndex(carouselIndex) : carouselIndex, distance: 0 };
    }
    const scrollerCenter = lobbyScroller.scrollLeft + lobbyScroller.clientWidth / 2;
    let nearestDisplay = hasInfiniteCarousel ? getMiddleDisplayIndex(carouselIndex) : carouselIndex;
    let nearestDistance = Number.POSITIVE_INFINITY;
    carouselCards.forEach((card, idx) => {
      if (!card) return;
      const cardCenter = card.offsetLeft + card.clientWidth / 2;
      const distance = Math.abs(cardCenter - scrollerCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestDisplay = idx;
      }
    });
    return { index: nearestDisplay, distance: nearestDistance };
  }

  function displayToRealIndex(displayIndex: number): number {
    if (!hasInfiniteCarousel) return Math.max(0, Math.min(displayIndex, avatarChoices.length - 1));
    const n = avatarChoices.length;
    return ((displayIndex % n) + n) % n;
  }

  function scrollCarousel(direction: -1 | 1) {
    if (introStage !== 'done') return;
    if (avatarChoices.length === 0 || carouselCards.length === 0) return;
    const nextDisplay = Math.max(0, Math.min(currentDisplayIndex + direction, carouselRenderChoices.length - 1));
    suppressScrollSyncUntil = Date.now() + 240;
    scrollToDisplayIndex(nextDisplay, 'auto');
    const normalizedDisplay = normalizeDisplayIndex(nextDisplay);
    if (normalizedDisplay !== nextDisplay) {
      scrollToDisplayIndex(normalizedDisplay, 'auto');
      currentDisplayIndex = normalizedDisplay;
      carouselIndex = displayToRealIndex(normalizedDisplay);
    } else {
      currentDisplayIndex = nextDisplay;
      carouselIndex = displayToRealIndex(nextDisplay);
    }
  }

  function handleCarouselScroll() {
    if (!lobbyScroller || carouselCards.length === 0) return;
    if (Date.now() < suppressScrollSyncUntil) return;
    const { index: nearestDisplay } = getNearestDisplayInfo();
    const normalizedDisplay = normalizeDisplayIndex(nearestDisplay);
    if (normalizedDisplay !== nearestDisplay) {
      scrollToDisplayIndex(normalizedDisplay, 'auto');
      currentDisplayIndex = normalizedDisplay;
      carouselIndex = displayToRealIndex(normalizedDisplay);
    } else {
      currentDisplayIndex = nearestDisplay;
      carouselIndex = displayToRealIndex(nearestDisplay);
    }
  }

  function getMiddleDisplayIndex(realIndex: number): number {
    if (!hasInfiniteCarousel) return realIndex;
    const middleCycle = Math.floor(infiniteRepeatCount / 2);
    return middleCycle * carouselCycleLength + realIndex;
  }

  function normalizeDisplayIndex(displayIndex: number): number {
    if (!hasInfiniteCarousel) return displayIndex;
    const n = carouselCycleLength;
    const total = carouselRenderChoices.length;
    const minSafe = n;
    const maxSafe = total - n - 1;
    if (displayIndex >= minSafe && displayIndex <= maxSafe) return displayIndex;
    const realIndex = displayToRealIndex(displayIndex);
    return getMiddleDisplayIndex(realIndex);
  }
</script>

<div class="lobby-wrapper">
{#if blockedMessage}
  <div class="blocked-screen" role="alert" aria-live="assertive">
    <h2>Unable to join this game</h2>
    <p>{blockedMessage}</p>
    <button type="button" class="blocked-refresh-btn" on:click={refreshPage}>Back to lobby</button>
  </div>
{:else}

<div
  class="lobby-main"
  class:intro-pending={introStage === 'pending' || introStage === 'pending_shrink'}
  class:intro-splash={introStage === 'splash'}
  class:intro-dock={introStage === 'dock'}
  class:intro-carousel={introStage === 'carousel'}
  class:intro-done={introStage === 'done'}
>
  {#if introStage === 'pending' || introStage === 'pending_shrink'}
    <div class="intro-overlay intro-pending-layer">
      <button
        type="button"
        class="intro-pending-hit"
        disabled={introStage === 'pending_shrink'}
        on:click={beginLobbyIntro}
        aria-label="Start — tap the logo to play the opening sound and animation"
      >
        <img
          src="/logo/logo.png"
          alt=""
          class="intro-pending-logo"
          class:intro-pending-logo-shrink={introStage === 'pending_shrink'}
          on:animationend={onPendingLogoShrinkDone}
        />
        <div class="intro-pending-hint-row" aria-live="polite">
          {#if introStage === 'pending' && showPendingTapHint}
            <span class="intro-pending-hint">Tap logo to start</span>
          {/if}
        </div>
      </button>
    </div>
  {/if}
  {#if introStage === 'splash'}
    <div class="intro-overlay" aria-hidden="true">
      {#if introOrbitBubbles.length > 0}
        <div class="intro-avatar-cloud">
          {#each introOrbitBubbles as orbit}
            {#each [0, 1] as burstWave}
              <div
                class="intro-orbit intro-burst"
                style="--burst-tx: {burstWave === 0 ? orbit.burstTx : orbit.burstTxAlt}; --burst-ty: {burstWave === 0 ? orbit.burstTy : orbit.burstTyAlt}; --burst-duration: {orbit.duration}; --burst-delay: {orbit.delay}; --burst-extra-delay: {burstWave === 0 ? '0s' : '1s'}; --orbit-size: {orbit.size};"
              >
                <img
                  src={introFaceFrame === 1 ? getAvatarData(orbit.avatarChoice).avatar1 : getAvatarData(orbit.avatarChoice).avatar2}
                  alt=""
                  class="intro-orbit-avatar"
                />
              </div>
            {/each}
          {/each}
        </div>
      {/if}
      <img src="/logo/logo.png" alt="" class="intro-logo" />
    </div>
  {/if}
  <header
    class="app-header"
    aria-hidden={introStage === 'pending' ||
      introStage === 'pending_shrink' ||
      introStage === 'splash' ||
      introStage === 'dock'}
  >
      <img src="/logo/logo.png" alt="Game Logo" class="app-logo" />
  </header>
  {#if errorMessage}
    <div class="lobby-avatar-error-bubble" role="alert" aria-live="polite">{errorMessage}</div>
  {/if}
  <div
    class="lobby-shell"
    class:intro-shell-hidden={introStage === 'pending' ||
      introStage === 'pending_shrink' ||
      introStage === 'splash' ||
      introStage === 'dock'}
    class:intro-shell-enter={introStage === 'carousel' || introStage === 'done'}
  >
    <div class="carousel-frame">
      <div class="lobby" bind:this={lobbyScroller} on:scroll={handleCarouselScroll}>
        {#each carouselRenderChoices as avatarChoice, displayIdx}
          {@const idx = displayToRealIndex(displayIdx)}
          {#if $localPlayer && $gameState}
            <div 
              class="player-card"
              class:clickable={$localPlayer &&
                !$gameState.players.some(
                  (p) => p.playerId !== $localPlayer.playerId && p.selectedAvatar === avatarChoice
                )}
              style="border-color: {getAvatarBorderColor($gameState.players, avatarChoice)}"
              on:click={() => {
                carouselIndex = idx;
                suppressScrollSyncUntil = Date.now() + 220;
                scrollToDisplayIndex(displayIdx);
                currentDisplayIndex = displayIdx;
                selectPlayerAvatar(avatarChoice);
              }}
              on:keydown={(e) => e.key === 'Enter' && selectPlayerAvatar(avatarChoice)}
              role="button"
              tabindex="0"
              bind:this={carouselCards[displayIdx]}
            >
              <div class="player-name">{getPlayerName(avatarChoice)}</div>
              <div class="avatar-options">
                <div
                  class="avatar-option"
                  style="border-color: {getAvatarBorderColor($gameState.players, avatarChoice)}"
                >
                  <img src={getAvatarData(avatarChoice).avatar1} alt="{getPlayerName(avatarChoice)} Avatar" class="option-avatar" />
                  {#if getAvatarSelectionState($gameState.players, avatarChoice).isSelected}
                    <div class="selection-indicator">
                      {getAvatarSelectionState($gameState.players, avatarChoice).isSelectedByMe
                        ? 'You'
                        : 'Player ' + ($gameState.players.findIndex(p => p.selectedAvatar === avatarChoice) + 1)
                      }
                    </div>
                  {/if}
                </div>
              </div>
              <div class="player-status">
                  <span  style="color: {getReadyTextColor($gameState.players, avatarChoice)}">
                    {#if getAvatarSelectionState($gameState.players, avatarChoice).isSelected}
                      Ready to play
                    {:else}
                      Click to select
                    {/if}
                  </span>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {#if avatarChoices.length > 1}
    <div class="carousel-controls" aria-label="Avatar carousel controls">
      <button
        type="button"
        class="carousel-nav-btn"
        on:click={() => scrollCarousel(-1)}
        aria-label="Previous avatar"
        disabled={introStage !== 'done'}
      >
        ‹
      </button>
      <button
        type="button"
        class="carousel-nav-btn"
        on:click={() => scrollCarousel(1)}
        aria-label="Next avatar"
        disabled={introStage !== 'done'}
      >
        ›
      </button>
    </div>
  {/if}
  </div>

  {#if $gameState}
  <div class="lobby-bottom-actions">
    <button 
      on:click={startGame} 
      disabled={!canStartGame($gameState.players) || introStage !== 'done'}
      class="start-button"
    >
      {canStartGame($gameState.players) ? 'Start Game' : 'Need at least 2 players with selected avatars'}
    </button>
    <div class="lobby-actions-row">
      <button
        type="button"
        class="lobby-settings-btn"
        on:click={toggleSettings}
        aria-expanded={settingsOpen}
        disabled={introStage !== 'done'}
      >
        ⚙ Game Settings
      </button>
    </div>
  </div>
  {/if}
</div>
{#if $gameState && settingsOpen}
  <div class="lobby-settings-overlay" role="dialog" aria-label="Lobby settings" aria-modal="true">
    <button type="button" class="lobby-settings-backdrop" on:click={closeSettings} aria-label="Close settings"></button>
    <div class="lobby-settings-panel">
      <h3>Game Settings</h3>
      <div class="winning-score-picker">
        <div class="winning-score-label">👑 Target score: {localWinningScore}</div>
        <div class="winning-score-options">
          {#each winningScoreOptions as score}
            <button
              type="button"
              class="winning-score-btn"
              class:active={localWinningScore === score}
              on:click={() => setWinningScore(score)}
            >
              {score}
            </button>
          {/each}
        </div>
      </div>
      <div class="lobby-settings-group">
        <div class="lobby-settings-label">Game Speed</div>
        <div class="lobby-settings-options">
          <button type="button" class="lobby-settings-chip" class:active={gameSpeed === 'slow'} on:click={() => setGameSpeed('slow')}>Slow</button>
          <button type="button" class="lobby-settings-chip" class:active={gameSpeed === 'normal'} on:click={() => setGameSpeed('normal')}>Normal</button>
          <button type="button" class="lobby-settings-chip" class:active={gameSpeed === 'fast'} on:click={() => setGameSpeed('fast')}>Fast</button>
        </div>
      </div>
      <div class="lobby-settings-group">
        <div class="lobby-settings-label">FX ({cardsVolume}%)</div>
        <div class="lobby-volume-options">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            bind:value={cardsVolume}
            on:input={() => setCardsVolume(cardsVolume)}
            aria-label="FX volume"
          />
        </div>
      </div>
      <div class="lobby-settings-group">
        <div class="lobby-settings-label">Music ({jinglesVolume}%)</div>
        <div class="lobby-volume-options">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            bind:value={jinglesVolume}
            on:input={() => setJinglesVolume(jinglesVolume)}
            aria-label="Music volume"
          />
        </div>
      </div>
      <div class="lobby-settings-group lobby-settings-checkbox-row">
        <label class="lobby-pref-checkbox">
          <input
            type="checkbox"
            checked={screenTurnFlashEnabled}
            on:change={(e) => setScreenTurnFlashEnabled(e.currentTarget.checked)}
            aria-label="Gold screen edge during the game when it is your turn"
          />
          <span>Screen flash on your turn</span>
        </label>
      </div>
      <button type="button" class="lobby-reset-btn" on:click={resetLobby}>Reset Lobby</button>
      <button type="button" class="lobby-settings-close" on:click={closeSettings}>Close</button>
    </div>
  </div>
{/if}
{/if}
</div>

<style>
  .app-header {
    width: 100vw;
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: 1.5rem;
    margin-bottom: 1.5rem;
    z-index: 10;
    position: relative;
    transition: transform 0.55s ease, opacity 0.55s ease;
  }
  .app-logo {
    max-width: clamp(220px, 40vw, 340px);
    max-height: clamp(220px, 34vh, 320px);
    object-fit: contain;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.10));
  }

  :global(body.lobby-bg) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    min-height: 100dvh;
    width: 100%;
    overflow-y: auto !important;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    transition: background 0.3s;
  }
  :global(html.lobby-bg) {
    height: auto !important;
    min-height: 100dvh;
    overflow-y: auto !important;
    overflow-x: hidden !important;
  }
  :global(body.lobby-bg #app) {
    height: auto !important;
    min-height: 100dvh;
    overflow-y: auto !important;
    overflow-x: hidden !important;
  }
  :global(html),
  :global(body),
  :global(#app) {
    width: 100%;
    height: 100%;
  }

  .lobby-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    width: 100%;
    box-sizing: border-box;
    padding: 0 clamp(0.5rem, 2vw, 1rem);
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }
  .blocked-screen {
    width: min(92vw, 560px);
    margin: 1rem auto 0;
    padding: 1.15rem 1rem;
    border-radius: 12px;
    background: linear-gradient(180deg, #fff, #f7f9fc);
    border: 1px solid rgba(60, 78, 96, 0.2);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    text-align: center;
    color: #1f2f44;
  }
  .blocked-screen h2 {
    margin: 0 0 0.6rem;
    font-size: clamp(1.1rem, 3.6vw, 1.5rem);
  }
  .blocked-screen p {
    margin: 0 0 0.9rem;
    color: #526274;
  }
  .blocked-refresh-btn {
    border: none;
    border-radius: 8px;
    background: #004c8c;
    color: #fff;
    padding: 0.6rem 1rem;
    cursor: pointer;
    font-weight: 700;
  }
  .blocked-refresh-btn:hover {
    background: #0066bb;
  }

  .lobby {
    display: flex;
    overflow-x: auto;
    overflow-y: visible;
    scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    gap: clamp(0.7rem, 2vw, 1.05rem);
    max-width: min(1100px, 96vw);
    width: 100%;
    margin: 0 auto;
    align-items: stretch;
    justify-content: flex-start;
    background: transparent;
    /* Room for hover lift + border/outline so tiles aren’t clipped */
    padding: clamp(0.75rem, 2.5vh, 1.25rem) clamp(0.85rem, 4vw, 2.6rem);
  }
  .lobby::-webkit-scrollbar {
    display: none;
  }
  .lobby-shell {
    width: 100%;
    max-width: min(1460px, 99vw);
    margin: 0 auto;
    overflow: visible;
    background: transparent;
  }
  .lobby-main {
    width: 100%;
    min-height: calc(100dvh - 1.2rem);
    display: grid;
    grid-template-rows: 1fr auto 1fr;
    align-items: center;
    justify-items: center;
    gap: clamp(0.5rem, 1.5vh, 0.9rem);
    position: relative;
    overflow-x: hidden;
    overflow-y: visible;
  }
  .lobby-main.intro-splash,
  .lobby-main.intro-pending {
    overflow: visible;
  }
  .intro-pending-layer {
    pointer-events: none;
  }
  .intro-pending-hit {
    --intro-pending-hint-gap: 0.55rem;
    --intro-pending-hint-row-h: clamp(2.15rem, 5.5vw, 2.85rem);
    pointer-events: auto;
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 2;
    /* Centre the logo on the viewport: default flex-centre aligns the midpoint of logo+hint; nudge down by (hint row + gap)/2 so the logo’s centre lands on middle. */
    translate: -50%
      calc(-50% + (var(--intro-pending-hint-row-h) + var(--intro-pending-hint-gap)) / 2);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: var(--intro-pending-hint-gap);
    margin: 0;
    padding: 0.5rem 1rem;
    border: none;
    background: transparent;
    font: inherit;
    cursor: pointer;
    border-radius: 12px;
    -webkit-tap-highlight-color: transparent;
  }
  .intro-pending-hit:focus {
    outline: none;
  }
  .intro-pending-hit:focus-visible {
    outline: 3px solid rgba(0, 76, 140, 0.55);
    outline-offset: 6px;
  }
  .intro-pending-hit:disabled {
    cursor: default;
  }
  /* Dedicated class — do not reuse .intro-logo (it forces the 3s introLogoGrow animation). */
  .intro-pending-logo {
    width: auto;
    height: auto;
    max-width: clamp(220px, 40vw, 340px);
    max-height: clamp(220px, 34vh, 320px);
    object-fit: contain;
    transform: scale(1);
    transform-origin: center center;
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.1));
  }
  .intro-pending-logo.intro-pending-logo-shrink {
    animation: introLogoShrinkIntoIntro 0.16s cubic-bezier(0.32, 0, 0.2, 1) forwards;
  }
  .intro-pending-hint-row {
    min-height: var(--intro-pending-hint-row-h);
    width: min(92vw, 22rem);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .intro-pending-hint {
    font-size: clamp(0.78rem, 2vw, 0.95rem);
    font-weight: 700;
    letter-spacing: 0.03em;
    color: rgba(23, 59, 90, 0.72);
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.85);
    user-select: none;
    line-height: 1.3;
  }
  .lobby-main.intro-pending .app-header {
    opacity: 0;
    transform: translateY(50px) scale(0.86);
  }
  .lobby-main.intro-pending .lobby-bottom-actions {
    opacity: 0;
    transform: translateY(24px) scale(0.985);
    pointer-events: none;
  }
  .intro-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    z-index: 30;
    pointer-events: none;
  }
  .intro-avatar-cloud {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: visible;
  }
  .intro-orbit {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--orbit-size);
    height: var(--orbit-size);
    margin-left: calc(var(--orbit-size) * -0.5);
    margin-top: calc(var(--orbit-size) * -0.5);
    opacity: 0.8;
    will-change: transform;
  }
  .intro-burst {
    animation: introBurstFly var(--burst-duration) cubic-bezier(0.06, 0.82, 0.17, 1) infinite;
    animation-delay: calc(var(--burst-delay) + var(--burst-extra-delay));
  }
  .intro-orbit-avatar {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid rgba(255, 255, 255, 0.7);
    box-shadow: 0 10px 20px rgba(11, 37, 59, 0.24);
  }
  .intro-logo {
    width: clamp(180px, 32vw, 320px);
    height: auto;
    opacity: 1;
    filter: drop-shadow(0 14px 28px rgba(13, 54, 86, 0.28));
    animation: introLogoGrow 3s cubic-bezier(0.17, 0.9, 0.32, 1) forwards;
    z-index: 2;
  }
  .lobby-main.intro-splash .app-header {
    opacity: 0;
    transform: translateY(50px) scale(0.86);
  }
  .lobby-main.intro-dock .app-header,
  .lobby-main.intro-carousel .app-header,
  .lobby-main.intro-done .app-header {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  .lobby-shell.intro-shell-hidden,
  .lobby-main.intro-splash .lobby-bottom-actions {
    opacity: 0;
    transform: translateY(24px) scale(0.985);
    pointer-events: none;
  }
  .lobby-shell.intro-shell-enter,
  .lobby-main.intro-carousel .lobby-bottom-actions,
  .lobby-main.intro-done .lobby-bottom-actions {
    opacity: 1;
    transform: translateY(0) scale(1);
    transition: transform 0.6s ease, opacity 0.6s ease;
  }
  @keyframes introLogoShrinkIntoIntro {
    from {
      transform: scale(1);
    }
    to {
      transform: scale(0.4);
    }
  }
  @keyframes introLogoGrow {
    0% {
      transform: scale(0.4);
    }
    64% {
      transform: scale(2.25);
    }
    100% {
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .intro-pending-logo.intro-pending-logo-shrink {
      animation-duration: 0.01ms;
    }
  }

  @keyframes introBurstFly {
    0% {
      transform: translate(0, 0) scale(0.35);
      opacity: 0;
    }
    5% {
      opacity: 1;
      transform: translate(0, 0) scale(0.95);
    }
    100% {
      transform: translate(var(--burst-tx), var(--burst-ty)) scale(1);
      opacity: 0.82;
    }
  }
  .lobby-bottom-actions {
    grid-row: 3;
    align-self: center;
    justify-self: center;
    width: min(96vw, 560px);
  }
  /* Avatar selection errors: fixed layer between logo + carousel, no layout shift */
  .lobby-avatar-error-bubble {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    top: clamp(8.5rem, 24vh, 14.5rem);
    z-index: 200;
    pointer-events: none;
    width: max-content;
    max-width: min(92vw, 420px);
    margin: 0;
    padding: clamp(0.55rem, 1.4vw, 0.72rem) clamp(1rem, 3vw, 1.25rem);
    border-radius: 12px;
    text-align: center;
    font-weight: 700;
    font-size: clamp(0.86rem, 2.2vw, 0.98rem);
    line-height: 1.35;
    color: #fff;
    background: linear-gradient(165deg, rgba(220, 61, 82, 0.97), rgba(190, 38, 62, 0.97));
    box-shadow: 0 10px 26px rgba(124, 29, 44, 0.32);
    border: 1px solid rgba(255, 213, 219, 0.48);
  }

  .carousel-frame {
    --carousel-fade-w: clamp(48px, 9vw, 130px);
    position: relative;
    min-height: clamp(168px, 26vh, 228px);
    display: flex;
    align-items: center;
    overflow: visible;
    padding-block: clamp(0.25rem, 1vh, 0.5rem);
    background: transparent;
  }
  /* Left + right scroll fades — colors track body.lobby-bg so there’s no “box” seam */
  .carousel-frame::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    background:
      linear-gradient(90deg, rgba(220, 238, 247, 0.88) 0%, rgba(207, 228, 240, 0.45) 38%, transparent 100%),
      linear-gradient(270deg, rgba(220, 238, 247, 0.88) 0%, rgba(207, 228, 240, 0.45) 38%, transparent 100%);
    background-size: var(--carousel-fade-w) 100%, var(--carousel-fade-w) 100%;
    background-position: left center, right center;
    background-repeat: no-repeat;
  }
  .carousel-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.7rem;
    margin-top: 0.65rem;
    position: relative;
    z-index: 4;
  }
  .carousel-nav-btn {
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 999px;
    border: 1px solid rgba(96, 136, 177, 0.48);
    background: linear-gradient(160deg, rgba(248, 252, 255, 0.95), rgba(231, 239, 247, 0.95));
    color: #173b5a;
    font-size: 1.2rem;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 8px 18px rgba(14, 42, 65, 0.16);
    pointer-events: auto;
  }
  @media (max-width: 768px) {
    .lobby {
      padding: clamp(0.65rem, 2.2vh, 1rem) 0.4rem;
    }
  }

  @media (max-width: 480px) {
    .lobby {
      gap: 0.65rem;
      padding: clamp(0.6rem, 2vh, 0.95rem) 0.2rem;
    }
  }
  
  .player-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 0 0 clamp(200px, 28vw, 260px);
    scroll-snap-align: center;
    padding: clamp(1rem, 2.5vw, 1.5rem);
    border: clamp(2px, 0.5vw, 3px) solid #e0e0e0;
    border-radius: clamp(8px, 2vw, 10px);
    background-color: #fafafa;
    transition: all 0.3s;
    cursor: default;
  }
  
  .player-card.clickable {
    cursor: pointer;
  }
  
  .player-card.clickable:hover {
    border-color: #0077ff;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
  }

  .player-card.clickable:focus {
    outline: 2px solid #0077ff;
    outline-offset: 2px;
  }
  
  .player-name {
    font-size: clamp(1rem, 2.5vw, 1.2rem);
    font-weight: bold;
    margin-bottom: clamp(0.75rem, 2vh, 1rem);
    color: #333;
    text-align: center;
  }
  
  .avatar-options {
    display: flex;
    justify-content: center;
    margin-bottom: 1rem;
  }
  
  .avatar-option {
    position: relative;
    background: none;
    border: clamp(2px, 0.5vw, 3px) solid #ccc;
    border-radius: 50%;
    padding: 0;
    transition: all 0.3s;
    width: clamp(60px, 12vw, 80px);
    height: clamp(60px, 12vw, 80px);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .option-avatar {
    width: clamp(55px, 11vw, 70px);
    height: clamp(55px, 11vw, 70px);
    border-radius: 50%;
    object-fit: cover;
  }
  
  .selection-indicator {
    position: absolute;
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%);
    background-color: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 0.7rem;
    font-weight: bold;
    white-space: nowrap;
  }
  
  .player-status {
    font-size: clamp(0.8rem, 2vw, 0.9rem);
    font-weight: 500;
    text-align: center;
  }
  
  .start-button {
    margin-top: clamp(1rem, 3vh, 2rem);
    padding: clamp(0.75rem, 2vh, 1rem) clamp(1rem, 3vw, 2rem);
    min-height: 44px;
    font-size: clamp(0.95rem, 2.5vw, 1.1rem);
    background-color: #004C8C;
    color: white;
    border: none;
    border-radius: clamp(4px, 1vw, 5px);
    cursor: pointer;
    transition: background-color 0.3s;
    display: block;
    margin-left: auto;
    margin-right: auto;
    touch-action: manipulation;
    max-width: 95vw;
    word-wrap: break-word;
  }
  .lobby-actions-row {
    margin-top: 0.65rem;
    margin-bottom: 0.3rem;
    display: flex;
    justify-content: center;
  }
  .lobby-settings-btn {
    border: 1px solid rgba(44, 62, 80, 0.25);
    border-radius: 999px;
    background: #fff;
    color: #2c3e50;
    padding: 0.36rem 0.75rem;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
  }
  .lobby-settings-overlay {
    position: fixed;
    inset: 0;
    z-index: 260;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .lobby-settings-backdrop {
    position: absolute;
    inset: 0;
    border: none;
    background: rgba(0, 0, 0, 0.52);
    cursor: pointer;
  }
  .lobby-settings-panel {
    position: relative;
    z-index: 1;
    width: min(92vw, 430px);
    border-radius: 12px;
    background: linear-gradient(180deg, #fff, #f7f9fc);
    border: 1px solid rgba(44, 62, 80, 0.14);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    padding: 0.95rem 0.95rem 0.9rem;
    text-align: center;
  }
  .lobby-settings-panel h3 {
    margin: 0 0 0.45rem;
    color: #1f2f44;
  }
  .lobby-settings-checkbox-row {
    text-align: left;
    margin-top: 0.15rem;
  }
  .lobby-pref-checkbox {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: #2c3e50;
    cursor: pointer;
    user-select: none;
    justify-content: flex-start;
  }
  .lobby-pref-checkbox input {
    width: 1rem;
    height: 1rem;
    accent-color: #004c8c;
    cursor: pointer;
    flex-shrink: 0;
  }
  .lobby-settings-close {
    margin-top: 0.45rem;
    width: 100%;
    border: 1px solid rgba(44, 62, 80, 0.22);
    background: #fff;
    color: #2c3e50;
    border-radius: 8px;
    padding: 0.5rem 0.7rem;
    font-weight: 700;
    cursor: pointer;
  }
  .lobby-reset-btn {
    margin-top: 0.4rem;
    width: 100%;
    border: 1px solid rgba(168, 69, 80, 0.42);
    background: linear-gradient(165deg, rgba(241, 95, 113, 0.95), rgba(205, 56, 76, 0.95));
    color: #fff;
    border-radius: 8px;
    padding: 0.52rem 0.7rem;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 10px 20px rgba(131, 39, 53, 0.2);
    transition: transform 130ms ease, box-shadow 180ms ease, filter 180ms ease;
  }
  .lobby-reset-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 24px rgba(131, 39, 53, 0.28);
    filter: saturate(1.06);
  }
  .winning-score-picker {
    margin-top: 0.75rem;
    margin-bottom: 0.35rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
  }
  .winning-score-label {
    font-size: clamp(0.8rem, 2.1vw, 0.95rem);
    font-weight: 700;
    color: #2f3f51;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .winning-score-options {
    display: inline-flex;
    gap: 0.35rem;
    justify-content: center;
    flex-wrap: wrap;
  }
  .winning-score-btn {
    min-width: 2rem;
    border: 1px solid rgba(44, 62, 80, 0.22);
    border-radius: 999px;
    background: #fff;
    color: #2c3e50;
    padding: 0.26rem 0.52rem;
    font-size: 0.84rem;
    font-weight: 700;
    cursor: pointer;
  }
  .winning-score-btn.active {
    background: #004c8c;
    color: #fff;
    border-color: #004c8c;
  }
  .lobby-settings-group {
    margin-top: 0.55rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.34rem;
  }
  .lobby-settings-label {
    font-size: clamp(0.8rem, 2.1vw, 0.95rem);
    font-weight: 700;
    color: #2f3f51;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .lobby-settings-options {
    display: inline-flex;
    gap: 0.35rem;
    justify-content: center;
    flex-wrap: wrap;
  }
  .lobby-settings-chip {
    min-width: 3.2rem;
    border: 1px solid rgba(44, 62, 80, 0.22);
    border-radius: 999px;
    background: #fff;
    color: #2c3e50;
    padding: 0.28rem 0.62rem;
    font-size: 0.84rem;
    font-weight: 700;
    cursor: pointer;
  }
  .lobby-settings-chip.active {
    background: #004c8c;
    color: #fff;
    border-color: #004c8c;
  }
  .lobby-volume-options {
    width: min(94%, 320px);
  }
  .lobby-volume-options input[type='range'] {
    width: 100%;
    accent-color: #0077ff;
  }
  
  .start-button:hover:not(:disabled) {
    background-color: #00B7C2;
  }
  
  .start-button:disabled {
    background-color: #ccc;
    cursor: not-allowed;
  }
  
  /* Color coding for avatar borders */
  .avatar-option[style*="border-color: #4CAF50"] {
    border-color: #4CAF50 !important;
    box-shadow: 0 0 10px rgba(76, 175, 80, 0.3);
  }
  
  .avatar-option[style*="border-color: #FF9800"] {
    border-color: #FF9800 !important;
    box-shadow: 0 0 10px rgba(255, 152, 0, 0.3);
  }
  
  .avatar-option[style*="border-color: #ccc"] {
    border-color: #ccc !important;
  }

  :global(body.lobby-bg) {
    background:
      radial-gradient(circle at 18% 14%, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 36%),
      radial-gradient(circle at 84% 82%, rgba(82, 160, 207, 0.2), rgba(82, 160, 207, 0) 42%),
      linear-gradient(165deg, #dceef7 0%, #cfe4f0 48%, #c7dfec 100%) !important;
  }

  .lobby-wrapper {
    padding: 0.4rem clamp(0.75rem, 2.2vw, 1.4rem) 1.6rem;
    gap: 0.6rem;
  }

  .app-header {
    margin-top: clamp(0.5rem, 1.6vh, 1rem);
    margin-bottom: clamp(0.45rem, 1.4vh, 0.85rem);
  }

  .app-logo {
    filter:
      drop-shadow(0 8px 18px rgba(10, 44, 66, 0.25))
      drop-shadow(0 2px 0 rgba(255, 255, 255, 0.3));
  }

  .lobby {
    gap: clamp(0.85rem, 2.2vw, 1.4rem);
    max-width: min(1420px, 99vw);
    padding-inline: 0;
    padding-block: clamp(0.8rem, 2.5vh, 1.15rem);
  }
  .app-header {
    grid-row: 1;
    align-self: center;
    justify-self: center;
  }
  .lobby-shell {
    grid-row: 2;
    align-self: center;
    justify-self: center;
  }

  .player-card {
    border: 1px solid rgba(122, 160, 190, 0.42);
    border-radius: 16px;
    background:
      radial-gradient(120% 100% at 10% -20%, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0) 58%),
      linear-gradient(160deg, rgba(249, 252, 255, 0.93), rgba(236, 244, 250, 0.9));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.95),
      0 14px 28px rgba(21, 63, 91, 0.16);
    transition:
      transform 170ms ease,
      box-shadow 200ms ease,
      border-color 180ms ease,
      filter 180ms ease;
  }

  .player-card.clickable:hover {
    transform: translateY(-4px);
    border-color: rgba(76, 127, 170, 0.7);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.95),
      0 18px 34px rgba(18, 55, 81, 0.24);
    filter: saturate(1.06);
  }

  .player-card.clickable:focus {
    outline: 2px solid rgba(62, 136, 217, 0.9);
    outline-offset: 2px;
  }

  .player-name {
    color: #173b5a;
    font-weight: 800;
    letter-spacing: 0.01em;
  }

  .avatar-option {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(242, 248, 253, 0.95));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.9),
      0 7px 14px rgba(16, 45, 70, 0.15);
  }

  .selection-indicator {
    background: linear-gradient(165deg, rgba(16, 34, 54, 0.93), rgba(34, 63, 95, 0.93));
    border: 1px solid rgba(168, 201, 232, 0.4);
    box-shadow: 0 6px 12px rgba(9, 22, 36, 0.3);
  }

  .player-status {
    font-weight: 600;
  }

  .lobby-actions-row {
    margin-top: 0.75rem;
    margin-bottom: 0;
  }

  .lobby-settings-btn {
    border: 1px solid rgba(96, 136, 177, 0.45);
    background:
      radial-gradient(140% 150% at 20% 10%, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0) 60%),
      linear-gradient(160deg, rgba(248, 252, 255, 0.92), rgba(229, 238, 248, 0.92));
    color: #173b5a;
    padding: 0.45rem 0.9rem;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.95),
      0 9px 18px rgba(14, 42, 65, 0.14);
    transition: transform 140ms ease, box-shadow 180ms ease, border-color 180ms ease;
  }

  .lobby-settings-btn:hover {
    transform: translateY(-1px);
    border-color: rgba(75, 121, 172, 0.62);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.95),
      0 12px 22px rgba(14, 42, 65, 0.2);
  }

  .start-button {
    margin-top: 0;
    border-radius: 12px;
    border: 1px solid rgba(122, 188, 237, 0.45);
    background: linear-gradient(165deg, #2f7bef 0%, #245fcf 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.32),
      0 12px 24px rgba(28, 83, 178, 0.28);
    transition:
      transform 140ms ease,
      box-shadow 190ms ease,
      filter 180ms ease;
  }

  .start-button:hover:not(:disabled) {
    transform: translateY(-2px);
    background: linear-gradient(165deg, #3585fd 0%, #2a66d8 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.35),
      0 16px 30px rgba(27, 80, 170, 0.34);
    filter: saturate(1.06);
  }

  .start-button:disabled {
    background: linear-gradient(165deg, #b9c7d4 0%, #aab9c8 100%);
    border-color: rgba(132, 154, 175, 0.5);
    color: rgba(40, 58, 76, 0.78);
    box-shadow: none;
  }

  .blocked-screen,
  .lobby-settings-panel {
    border-radius: 16px;
    border: 1px solid rgba(121, 155, 191, 0.4);
    background:
      radial-gradient(120% 100% at 14% -20%, rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0) 58%),
      linear-gradient(160deg, rgba(248, 251, 255, 0.94), rgba(232, 240, 249, 0.92));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.92),
      0 16px 36px rgba(16, 47, 73, 0.24);
    backdrop-filter: blur(10px);
  }

  .lobby-settings-close,
  .lobby-reset-btn,
  .winning-score-btn,
  .blocked-refresh-btn {
    transition: transform 130ms ease, box-shadow 180ms ease, background 180ms ease, border-color 180ms ease;
  }

  .winning-score-btn.active {
    background: linear-gradient(165deg, #2f7bef, #245fcf);
    border-color: #245fcf;
    box-shadow: 0 8px 16px rgba(28, 83, 178, 0.3);
  }

  .winning-score-btn:hover:not(.active) {
    border-color: rgba(87, 132, 182, 0.55);
    transform: translateY(-1px);
  }

  @media (max-width: 768px) {
    .lobby-main {
      min-height: calc(100dvh - 0.8rem);
      grid-template-rows: 1fr auto 1fr;
      gap: 0.55rem;
    }
    .carousel-frame {
      --carousel-fade-w: 44px;
      min-height: clamp(164px, 24vh, 210px);
    }
    .lobby-bottom-actions {
      width: min(96vw, 440px);
    }
  }
</style>
