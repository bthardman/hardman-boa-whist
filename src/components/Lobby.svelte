<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { gameState, roomId, localPlayer } from '../store';
  import type { Player } from '../../shared/types';
  import { AvatarChoice } from '../../shared/types';
  import { socket } from "../socket";
  import { getAvatarData, getPlayerName } from '../avatarData';
  import { registerErrorHandler, unregisterErrorHandler } from '../utils/socketHandlers';

  let errorMessage = '';

  function startGame() {
    socket.emit("start_game", { roomId: $roomId });
  }

  function handleError(message: string) {
    errorMessage = message;
    setTimeout(() => errorMessage = '', 3000);
  }

  onMount(() => {
    // Set body class for background
    document.body.classList.add('lobby-bg');

    // Register error handlers
    registerErrorHandler("avatar_selection_error", handleError);
    registerErrorHandler("start_game_error", handleError);

    return () => {
      unregisterErrorHandler("avatar_selection_error");
      unregisterErrorHandler("start_game_error");
      document.body.classList.remove('lobby-bg');
    };
  });

  onDestroy(() => {
    unregisterErrorHandler("avatar_selection_error");
    unregisterErrorHandler("start_game_error");
    document.body.classList.remove('lobby-bg');
  });

  function selectPlayerAvatar(avatarChoice: AvatarChoice) {
    if (!$localPlayer || !$gameState) return;

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
</script>

<div class="lobby-wrapper">
<header class="app-header">
    <img src="/logo/logo.png" alt="Game Logo" class="app-logo" />
</header>

{#if errorMessage}
  <div class="error-message">{errorMessage}</div>
{/if}

<div class="lobby">
  {#each Object.values(AvatarChoice).filter(c => c !== AvatarChoice.UNDEFINED) as avatarChoice}
    {#if $localPlayer && $gameState}
      <div 
        class="player-card"
        class:clickable={!$gameState.players.some((p) => p.selectedAvatar === avatarChoice)}
        style="border-color: {getAvatarBorderColor($gameState.players, avatarChoice)}"
        on:click={() => selectPlayerAvatar(avatarChoice)}
        on:keydown={(e) => e.key === 'Enter' && selectPlayerAvatar(avatarChoice)}
        role="button"
        tabindex="0"
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

{#if $gameState}
<button 
  on:click={startGame} 
  disabled={!canStartGame($gameState.players)}
  class="start-button"
>
  {canStartGame($gameState.players) ? 'Start Game' : 'Need at least 2 players with selected avatars'}
</button>
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
    max-width: clamp(150px, 30vw, 200px);
    max-height: clamp(180px, 40vw, 250px);
    object-fit: contain;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.10));
  }

  :global(body.lobby-bg) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    min-height: 100dvh;
    width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    background: #E6F5FA !important;
    transition: background 0.3s;
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
    justify-content: flex-start;
    min-height: 100dvh;
    width: 100%;
    box-sizing: border-box;
    padding: 0 clamp(0.5rem, 2vw, 1rem);
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }

  .lobby {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(clamp(200px, 25vw, 280px), 1fr));
    gap: clamp(1rem, 3vw, 2rem);
    max-width: min(900px, 95vw);
    width: 100%;
    margin: 0 auto;
    align-items: stretch;
    padding: 0 clamp(0.5rem, 2vw, 1rem);
  }

  @media (max-width: 768px) {
    .lobby {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 480px) {
    .lobby {
      grid-template-columns: 1fr;
    }
  }

  /* Landscape phone/tablet: fit all 6 avatars in one row with no scrolling */
  @media (orientation: landscape) and (max-height: 600px) {
    .lobby-wrapper {
      height: 100dvh;
      max-height: 100dvh;
      overflow: hidden;
      justify-content: flex-start;
      padding: 0 0.6vw;
    }
    .app-header {
      margin-top: 0.4vh;
      margin-bottom: 0.3vh;
      flex: 0 0 auto;
    }
    .app-logo {
      max-width: min(22vw, 160px);
      max-height: min(14vh, 70px);
    }
    .lobby {
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 0.6vw;
      max-width: 100vw;
      padding: 0 0.6vw;
      flex: 1 1 auto;
      min-height: 0;
      align-items: center;
    }
    .player-card {
      padding: 0.5vh 0.4vw;
      border-radius: 8px;
      border-width: 2px;
      height: auto;
    }
    .player-name {
      font-size: clamp(0.7rem, 2vh, 0.9rem);
      margin-bottom: 0.4vh;
    }
    .avatar-options {
      margin-bottom: 0.4vh;
    }
    .avatar-option {
      width: clamp(40px, 11vh, 62px);
      height: clamp(40px, 11vh, 62px);
      border-width: 2px;
    }
    .option-avatar {
      width: clamp(36px, 9.8vh, 54px);
      height: clamp(36px, 9.8vh, 54px);
    }
    .player-status {
      font-size: clamp(0.62rem, 1.7vh, 0.8rem);
    }
    .selection-indicator {
      font-size: 0.55rem;
      padding: 1px 4px;
      bottom: -4px;
    }
    .start-button {
      margin: 0.5vh auto;
      padding: 0.7vh 1.6vw;
      font-size: clamp(0.78rem, 2vh, 0.95rem);
      min-height: 32px;
      flex: 0 0 auto;
    }
    .error-message {
      padding: 0.4rem 0.8rem;
      font-size: 0.8rem;
      margin: 0.4vh auto;
    }
  }

  /* Very tight landscape (iPhone SE landscape = 667×375) */
  @media (orientation: landscape) and (max-height: 420px) {
    .app-logo {
      max-width: min(18vw, 130px);
      max-height: min(12vh, 54px);
    }
    .player-name {
      font-size: clamp(0.62rem, 1.8vh, 0.78rem);
      margin-bottom: 0.2vh;
    }
    .avatar-option {
      width: clamp(34px, 12vh, 50px);
      height: clamp(34px, 12vh, 50px);
    }
    .option-avatar {
      width: clamp(30px, 10.5vh, 44px);
      height: clamp(30px, 10.5vh, 44px);
    }
    .player-status {
      font-size: clamp(0.55rem, 1.6vh, 0.72rem);
    }
    .start-button {
      padding: 0.5vh 1.2vw;
      font-size: clamp(0.7rem, 1.8vh, 0.85rem);
      min-height: 28px;
    }
  }
  
  .player-card {
    display: flex;
    flex-direction: column;
    align-items: center;
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
</style>
