<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { gameState, roomId, localPlayer } from '../store';
  import type { Player } from '../../shared/types';
  import { AvatarChoice } from '../../shared/types';
  import { socket } from "../socket";
  import { getAvatarData, getPlayerName } from '../avatarData';

  let errorMessage = '';

  function startGame() {
    socket.emit("start_game", { roomId: $roomId });
  }

  onMount(() => {
    // Set body class for background
    document.body.classList.add('lobby-bg');

    socket.on("avatar_selection_error", (data: { message: string }) => {
      errorMessage = data.message;
      setTimeout(() => errorMessage = '', 3000);
    });

    socket.on("start_game_error", (data: { message: string }) => {
      errorMessage = data.message;
      setTimeout(() => errorMessage = '', 3000);
    });

    return () => document.body.classList.remove('lobby-bg');
  });

  onDestroy(() => {
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
    max-width: 200px;
    max-height: 250px;
    object-fit: contain;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.10));
  }

  :global(body.lobby-bg) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    min-height: 100vh;
    width: 100vw;
    background: #E6F5FA !important;
    transition: background 0.3s;
  }

  .lobby {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: 2rem;
    max-width: 900px;
    margin: 0 auto;
    min-height: 500px;
    align-items: stretch;
  }
  
  .player-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1.5rem;
    border: 3px solid #e0e0e0;
    border-radius: 10px;
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
    font-size: 1.2rem;
    font-weight: bold;
    margin-bottom: 1rem;
    color: #333;
  }
  
  .avatar-options {
    display: flex;
    justify-content: center;
    margin-bottom: 1rem;
  }
  
  .avatar-option {
    position: relative;
    background: none;
    border: 3px solid #ccc;
    border-radius: 50%;
    padding: 0;
    transition: all 0.3s;
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .option-avatar {
    width: 70px;
    height: 70px;
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
    font-size: 0.9rem;
    font-weight: 500;
  }
  
  .status-waiting {
    color: #FF9800;
  }
  
  .start-button {
    margin-top: 2rem;
    padding: 1rem 2rem;
    font-size: 1.1rem;
    background-color: #004C8C;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    transition: background-color 0.3s;
    display: block;
    margin-left: auto;
    margin-right: auto;
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
    padding: 1rem;
    margin: 1rem 0;
    border-radius: 5px;
    text-align: center;
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
