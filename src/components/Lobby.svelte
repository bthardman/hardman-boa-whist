<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { gameState, roomId, localPlayer } from '../store';
  import type { Player } from '../../shared/types';
  import { AvatarChoice } from '../../shared/types';
  import { socket } from "../socket";
  import { getAvatarData, getPlayerName } from '../avatarData';
  import { registerErrorHandler, unregisterErrorHandler } from '../utils/socketHandlers';
  import { soundEffects } from '../utils/soundEffects';

  let errorMessage = '';
  let blockedMessage = '';
  let settingsOpen = false;
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
  let lobbyScroller: HTMLDivElement | null = null;
  let carouselCards: Array<HTMLDivElement | null> = [];
  const infiniteRepeatCount = 11;
  const preferredAvatarCookie = 'preferredAvatarChoice';
  let restoredPreferredAvatar = false;
  $: hasInfiniteCarousel = avatarChoices.length > 1;
  $: carouselCycleLength = avatarChoices.length;
  $: carouselRenderChoices = hasInfiniteCarousel
    ? Array.from({ length: carouselCycleLength * infiniteRepeatCount }, (_, i) => avatarChoices[i % carouselCycleLength])
    : avatarChoices;

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
    soundEffects.playGameStart();
    socket.emit("start_game", { roomId: $roomId });
  }

  function setWinningScore(score: number) {
    if (!$gameState || $gameState.state !== 'lobby') return;
    socket.emit('set_winning_score', { roomId: $roomId, winningScore: score });
  }

  function toggleSettings() {
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

  onMount(() => {
    // Set body class for background
    document.body.classList.add('lobby-bg');
    document.documentElement.classList.add('lobby-bg');

    // Register error handlers
    registerErrorHandler("avatar_selection_error", handleError);
    registerErrorHandler("start_game_error", handleError);
    registerErrorHandler("join_error", handleJoinBlocked);
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
    document.body.classList.remove('lobby-bg');
    document.documentElement.classList.remove('lobby-bg');
  });

  function selectPlayerAvatar(avatarChoice: AvatarChoice) {
    if (!$localPlayer || !$gameState) return;

    if ($localPlayer.selectedAvatar === avatarChoice) {
      socket.emit("select_avatar", {
        roomId: $roomId,
        playerId: $localPlayer.playerId,
        avatarChoice: AvatarChoice.UNDEFINED
      });
      return;
    }

    const isTaken = $gameState.players.some(
      p => p.playerId !== $localPlayer.playerId && p.selectedAvatar === avatarChoice
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
{#if errorMessage}
  <div class="error-message">{errorMessage}</div>
{/if}

<div class="lobby-main">
  <header class="app-header">
      <img src="/logo/logo.png" alt="Game Logo" class="app-logo" />
  </header>
  <div class="lobby-shell">
    <div class="carousel-frame">
      <div class="lobby" bind:this={lobbyScroller} on:scroll={handleCarouselScroll}>
        {#each carouselRenderChoices as avatarChoice, displayIdx}
          {@const idx = displayToRealIndex(displayIdx)}
          {#if $localPlayer && $gameState}
            <div 
              class="player-card"
              class:clickable={!$gameState.players.some((p) => p.selectedAvatar === avatarChoice)}
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
      <button type="button" class="carousel-nav-btn" on:click={() => scrollCarousel(-1)} aria-label="Previous avatar">
        ‹
      </button>
      <button type="button" class="carousel-nav-btn" on:click={() => scrollCarousel(1)} aria-label="Next avatar">
        ›
      </button>
    </div>
  {/if}
  </div>

  {#if $gameState}
  <div class="lobby-bottom-actions">
    <button 
      on:click={startGame} 
      disabled={!canStartGame($gameState.players)}
      class="start-button"
    >
      {canStartGame($gameState.players) ? 'Start Game' : 'Need at least 2 players with selected avatars'}
    </button>
    <div class="lobby-actions-row">
      <button type="button" class="lobby-settings-btn" on:click={toggleSettings} aria-expanded={settingsOpen}>
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
    background: #E6F5FA !important;
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
    overflow-y: hidden;
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
    padding: 0 clamp(0.85rem, 4vw, 2.6rem) 0.5rem;
  }
  .lobby::-webkit-scrollbar {
    display: none;
  }
  .lobby-shell {
    width: 100%;
    max-width: min(1460px, 99vw);
    margin: 0 auto;
  }
  .lobby-main {
    width: 100%;
    min-height: calc(100dvh - 1.2rem);
    display: grid;
    grid-template-rows: 1fr auto 1fr;
    align-items: center;
    justify-items: center;
    gap: clamp(0.5rem, 1.5vh, 0.9rem);
  }
  .lobby-bottom-actions {
    grid-row: 3;
    align-self: center;
    justify-self: center;
    width: min(96vw, 560px);
  }
  .carousel-frame {
    position: relative;
    min-height: clamp(152px, 24vh, 210px);
    display: flex;
    align-items: center;
  }
  .carousel-frame::before,
  .carousel-frame::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: clamp(48px, 9vw, 130px);
    z-index: 3;
    pointer-events: none;
  }
  .carousel-frame::before {
    left: 0;
    background: linear-gradient(90deg, rgba(205, 224, 236, 0.98) 0%, rgba(205, 224, 236, 0.9) 34%, rgba(205, 224, 236, 0) 100%);
  }
  .carousel-frame::after {
    right: 0;
    background: linear-gradient(270deg, rgba(205, 224, 236, 0.98) 0%, rgba(205, 224, 236, 0.9) 34%, rgba(205, 224, 236, 0) 100%);
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
      padding: 0 0.4rem 0.55rem;
    }
  }

  @media (max-width: 480px) {
    .lobby {
      gap: 0.65rem;
      padding: 0 0.2rem 0.55rem;
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
  
  .start-button:hover:not(:disabled) {
    background-color: #00B7C2;
  }
  
  .start-button:disabled {
    background-color: #ccc;
    cursor: not-allowed;
  }
  
  .error-message {
    background-color: #f44336;
    color: white;
    padding: clamp(0.75rem, 2vw, 1rem);
    margin: clamp(0.75rem, 2vh, 1rem) clamp(0.5rem, 2vw, 1rem);
    border-radius: clamp(4px, 1vw, 5px);
    text-align: center;
    font-size: clamp(0.9rem, 2.5vw, 1rem);
    max-width: 95vw;
    margin-left: auto;
    margin-right: auto;
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

  .error-message {
    border-radius: 12px;
    background: linear-gradient(165deg, rgba(220, 61, 82, 0.95), rgba(190, 38, 62, 0.95));
    box-shadow: 0 10px 20px rgba(124, 29, 44, 0.25);
    border: 1px solid rgba(255, 213, 219, 0.45);
  }

  .lobby {
    gap: clamp(0.85rem, 2.2vw, 1.4rem);
    max-width: min(1420px, 99vw);
    padding: 0;
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
      min-height: clamp(148px, 22vh, 190px);
    }
    .carousel-frame::before,
    .carousel-frame::after {
      width: 44px;
    }
    .lobby-bottom-actions {
      width: min(96vw, 440px);
    }
  }
</style>
