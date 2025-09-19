<script lang="ts">
  import { onMount } from 'svelte';
  import { gameState, roomId, localPlayerIndex } from '../store';
  import type { Player } from '../../shared/types';
  import { AvatarChoice } from '../../shared/types';
  import { socket } from "../socket";
  import { getAvatarData, getPlayerName } from '../avatarData';

  import { get } from 'svelte/store';
  let errorMessage = '';

  function startGame() {
    socket.emit("start_game", { roomId });
  }

  onMount(() => {
    socket.on("avatar_selection_error", (data: { message: string }) => {
      errorMessage = data.message;
      setTimeout(() => errorMessage = '', 3000);
    });

    socket.on("start_game_error", (data: { message: string }) => {
      errorMessage = data.message;
      setTimeout(() => errorMessage = '', 3000);
    });
  });

  function selectAvatar(playerIndex: number, avatarChoice: AvatarChoice) {
    errorMessage = '';
    socket.emit("select_avatar", { 
      roomId, 
      playerIndex, 
      avatarChoice 
    });
  }

  function selectPlayerAvatar(playerIndex: number, avatarChoice: AvatarChoice) {
    const idx = get(localPlayerIndex);
    if (idx === undefined) return;
    // Only block if avatar is taken by another player
    const isAvatarTaken = $gameState?.players.some((p, index) => index !== idx && p.selectedAvatar === avatarChoice);
    if (isAvatarTaken) {
      errorMessage = 'Avatar already selected by another player';
      setTimeout(() => errorMessage = '', 3000);
      return;
    }
    selectAvatar(idx, avatarChoice);
  }

  function canStartGame(players: Player[]): boolean {
    const playersWithAvatars = players.filter(p => p.selectedAvatar !== AvatarChoice.UNDEFINED).length || 0;
    return playersWithAvatars >= 2;
  }

  function getAvatarSelectionState(players: Player[], avatarChoice: AvatarChoice) {
    const selectedByIndex = players.findIndex(p => p.selectedAvatar === avatarChoice);
    return {
      isSelected: selectedByIndex !== undefined && selectedByIndex !== -1,
      selectedByIndex,
      isSelectedByMe: selectedByIndex === $localPlayerIndex
    };
  }

  function getAvatarBorderColor(players: Player[], avatarChoice: AvatarChoice) {
    const state = getAvatarSelectionState(players, avatarChoice);
    if (state.isSelected) {
      return state.isSelectedByMe ? '#4CAF50' : '#FF9800'; // Green for me, orange for others
    }
    return '#ccc'; // Grey for unselected
  }

</script>

<h1>Lobby</h1>

{#if errorMessage}
  <div class="error-message">{errorMessage}</div>
{/if}

  <div class="lobby">
    {#each Object.values(AvatarChoice).filter(choice => choice !== AvatarChoice.UNDEFINED) as avatarChoice}
  {#if $localPlayerIndex !== undefined && $gameState}
        <div 
          class="player-card"
          class:clickable={!$gameState?.players.some((p, idx) => idx !== $localPlayerIndex && p.selectedAvatar === avatarChoice)}
          class:selected={getAvatarSelectionState($gameState?.players, avatarChoice).isSelected}
          on:click={() => selectPlayerAvatar(0, avatarChoice)}
          on:keydown={(e) => e.key === 'Enter' && selectPlayerAvatar(0, avatarChoice)}
          role="button"
          tabindex="0"
        >
          <div class="player-name">{getPlayerName(avatarChoice)}</div>
          <div class="avatar-options">
            <div
              class="avatar-option"
              style="border-color: {getAvatarBorderColor($gameState?.players, avatarChoice)}"
            >
              <img src={getAvatarData(avatarChoice).avatar1} alt="{getPlayerName(avatarChoice)} Avatar" class="option-avatar" />
              {#if getAvatarSelectionState($gameState?.players, avatarChoice).isSelected}
                <div class="selection-indicator">
                  {getAvatarSelectionState($gameState?.players, avatarChoice).isSelectedByMe ? 'You' : 'Player ' + ((getAvatarSelectionState($gameState?.players, avatarChoice).selectedByIndex ?? 0) + 1)}
                </div>
              {/if}
            </div>
          </div>
          <div class="player-status">
            {#if getAvatarSelectionState($gameState?.players, avatarChoice).isSelected}
              <span class="status-ready">Ready to play</span>
            {:else}
              <span class="status-waiting">Click to select</span>
            {/if}
          </div>
        </div>
      {/if}
    {/each}
  </div>

{#if $gameState}
<button 
  on:click={startGame} 
  disabled={!canStartGame($gameState?.players)}
  class="start-button"
>
  {canStartGame($gameState?.players) ? 'Start Game' : 'Need at least 2 players with selected avatars'}
</button>
{/if}

<style>
  .lobby {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 2rem;
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }
  
  .player-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1.5rem;
    border: 2px solid #e0e0e0;
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
  
  .player-card.selected {
    border-color: #4CAF50;
    box-shadow: 0 0 10px rgba(76, 175, 80, 0.3);
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
  
  .status-ready {
    color: #4CAF50;
  }
  
  .status-waiting {
    color: #FF9800;
  }
  
  .start-button {
    margin-top: 2rem;
    padding: 1rem 2rem;
    font-size: 1.1rem;
    background-color: #4CAF50;
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
    background-color: #45a049;
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
