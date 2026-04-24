<script lang="ts">
  import { gameState } from '../store';
  import { socket } from '../socket';
  import { getWinnerAvatarUrl } from '../avatarUtils';
  import { getAvatarData } from '../avatarData';
  import type { Player } from '../../shared/types';
  import { registerErrorHandler, unregisterErrorHandler } from '../utils/socketHandlers';
  import { onMount, onDestroy } from 'svelte';

  let errorMessage = '';
  let showConfirm = false;
  let confirmMode: 'lobby' | 'rematch' | null = null;

  onMount(() => {
    registerErrorHandler('start_game_error', (message) => {
      errorMessage = message;
      showConfirm = false;
    });
    return () => {
      unregisterErrorHandler('start_game_error');
    };
  });

  onDestroy(() => {
    unregisterErrorHandler('start_game_error');
  });

  function requestBackToLobby() {
    confirmMode = 'lobby';
    showConfirm = true;
  }

  function requestRematch() {
    confirmMode = 'rematch';
    showConfirm = true;
  }

  function cancelConfirm() {
    showConfirm = false;
    confirmMode = null;
  }

  function confirmResetAndProceed() {
    if (!$gameState || !confirmMode) return;
    if (confirmMode === 'rematch') {
      socket.emit('rematch_game', { roomId: $gameState.roomId });
    } else {
      socket.emit('cancel_game', { roomId: $gameState.roomId });
    }
    cancelConfirm();
  }

  function getSortedPlayers(): Player[] {
    if (!$gameState) return [];
    
    const state = $gameState;
    return [...state.players].sort((a, b) => {
      const indexA = state.players.indexOf(a);
      const indexB = state.players.indexOf(b);
      const scoreA = state.scoreboard[indexA] || 0;
      const scoreB = state.scoreboard[indexB] || 0;
      return scoreB - scoreA;
    });
  }

</script>

<div class="winner-screen">
  <h1 class="winner-title">🎉 Game Over! 🎉</h1>
  {#if $gameState && $gameState.winner}
    <div class="winner-section">
      <img src={getWinnerAvatarUrl($gameState.winner)} alt="Winner Avatar" class="avatar"/>
      <div class="player-name">{getAvatarData($gameState.winner.selectedAvatar).name}</div>
      <div class="winner-label">Winner!</div>
    </div>
  {/if}
  
  {#if $gameState}
    {@const state = $gameState}
    <div class="final-scores">
      <h2>Final Scores</h2>
      <div class="score-list">
        {#each getSortedPlayers() as player}
          {@const index = state.players.indexOf(player)}
          {@const score = state.scoreboard[index] || 0}
          {@const isWinner = state.winner?.playerId === player.playerId}
          <div class="score-item" class:winner={isWinner}>
            <span class="rank">#{getSortedPlayers().indexOf(player) + 1}</span>
            <span class="name">{getAvatarData(player.selectedAvatar).name}</span>
            <span class="score">{score}</span>
            {#if isWinner}
              <span class="crown">👑</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
  
  {#if errorMessage}
    <div class="error-banner">{errorMessage}</div>
  {/if}

  <div class="postgame-actions">
    <button class="play-again-button" on:click={requestRematch}>Rematch</button>
    <button class="secondary-action-button" on:click={requestBackToLobby}>Back to Lobby</button>
  </div>

  {#if showConfirm}
    <div class="confirm-overlay" role="dialog" aria-label="Confirm score reset">
      <button class="confirm-backdrop" aria-label="Close confirmation" on:click={cancelConfirm}></button>
      <div class="confirm-panel">
        <h3>Reset Scores?</h3>
        <p>
          {#if confirmMode === 'rematch'}
            This starts a new game with the same players and avatar selections.
          {:else}
            This returns everyone to the lobby and resets game scores.
          {/if}
        </p>
        <button class="confirm-primary" on:click={confirmResetAndProceed}>Yes, Reset Scores</button>
        <button class="confirm-secondary" on:click={cancelConfirm}>Cancel</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .winner-screen {
    text-align: center;
    padding: 2rem;
    max-width: 600px;
    margin: 0 auto;
  }

  .winner-title {
    font-size: 2.5rem;
    color: #2c3e50;
    margin-bottom: 2rem;
  }

  .winner-section {
    margin-bottom: 3rem;
  }

  .avatar {
    width: 150px;
    height: 150px;
    border-radius: 50%;
    border: 4px solid gold;
    box-shadow: 0 4px 20px rgba(255, 215, 0, 0.5);
    margin-bottom: 1rem;
  }

  .player-name {
    font-size: 2rem;
    font-weight: bold;
    color: #2c3e50;
    margin-bottom: 0.5rem;
  }

  .winner-label {
    font-size: 1.5rem;
    color: #f39c12;
    font-weight: 600;
  }

  .final-scores {
    background: #fff;
    border-radius: 12px;
    padding: 2rem;
    margin: 2rem 0;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  }

  .final-scores h2 {
    margin: 0 0 1.5rem 0;
    font-size: 1.8rem;
    color: #2c3e50;
  }

  .score-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .score-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-radius: 8px;
    background: #f5f5f5;
    transition: all 0.2s;
  }

  .score-item.winner {
    background: #fff9e6;
    border: 2px solid gold;
    font-weight: 600;
  }

  .score-item .rank {
    font-size: 1.2rem;
    font-weight: bold;
    color: #7f8c8d;
    min-width: 40px;
  }

  .score-item .name {
    flex: 1;
    text-align: left;
    margin-left: 1rem;
    font-size: 1.1rem;
  }

  .score-item .score {
    font-size: 1.3rem;
    font-weight: bold;
    color: #2c3e50;
    min-width: 60px;
    text-align: right;
  }

  .score-item .crown {
    margin-left: 0.5rem;
    font-size: 1.5rem;
  }

  .postgame-actions {
    margin-top: 1.4rem;
    display: flex;
    gap: 0.7rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .play-again-button {
    padding: 1rem 3rem;
    font-size: 1.2rem;
    font-weight: 600;
    background-color: #004C8C;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.3s;
  }

  .play-again-button:hover {
    background-color: #00B7C2;
  }

  .secondary-action-button {
    padding: 1rem 2rem;
    font-size: 1.05rem;
    font-weight: 600;
    border-radius: 8px;
    border: 1px solid rgba(44, 62, 80, 0.25);
    background: #fff;
    color: #2c3e50;
    cursor: pointer;
  }

  .error-banner {
    margin: 0.8rem auto 0;
    max-width: 460px;
    padding: 0.55rem 0.7rem;
    border-radius: 8px;
    background: #ffe8e8;
    color: #8a1f1f;
    border: 1px solid #ffc4c4;
    font-weight: 600;
  }

  .confirm-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 260;
  }
  .confirm-backdrop {
    position: absolute;
    inset: 0;
    border: none;
    background: rgba(0, 0, 0, 0.55);
    cursor: pointer;
  }
  .confirm-panel {
    position: relative;
    z-index: 1;
    width: min(92vw, 420px);
    background: #fff;
    border-radius: 12px;
    border: 1px solid rgba(44, 62, 80, 0.16);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    padding: 1rem 1rem 0.9rem;
    text-align: center;
  }
  .confirm-panel h3 {
    margin: 0 0 0.4rem;
    color: #1f2f44;
  }
  .confirm-panel p {
    margin: 0 0 0.85rem;
    color: #5f7183;
  }
  .confirm-primary,
  .confirm-secondary {
    width: 100%;
    border-radius: 8px;
    padding: 0.58rem 0.75rem;
    font-weight: 700;
    cursor: pointer;
  }
  .confirm-primary {
    border: none;
    background: #004c8c;
    color: #fff;
    margin-bottom: 0.45rem;
  }
  .confirm-secondary {
    border: 1px solid rgba(44, 62, 80, 0.2);
    background: #fff;
    color: #2c3e50;
  }
</style>
