<script lang="ts">
  import { gameState } from './store';
  import Scoreboard from './components/Scoreboard.svelte';
  import Lobby from './components/Lobby.svelte';
  import GameBoard from './components/GameBoard.svelte';
  import WinnerScreen from './components/WinnerScreen.svelte';
  import { onMount, onDestroy } from 'svelte';
  import {
    setupSocketHandlers,
    cleanupSocketHandlers,
    registerErrorHandler,
    unregisterErrorHandler
  } from './utils/socketHandlers';

  let joinBlockedMessage = '';

  onMount(() => {
    setupSocketHandlers();
    registerErrorHandler('join_error', (message) => {
      joinBlockedMessage = message || 'Game in progress. Please wait for the next game.';
    });
  });

  onDestroy(() => {
    unregisterErrorHandler('join_error');
    cleanupSocketHandlers();
  });
</script>

<div class="app-bg">
  {#if joinBlockedMessage}
    <div class="join-blocked-screen" role="alert" aria-live="assertive">
      <h2>Game In Progress</h2>
      <p>{joinBlockedMessage}</p>
      <button type="button" on:click={() => window.location.reload()}>Return to Lobby</button>
    </div>
  {:else}
  {#if $gameState}
    {#if $gameState.state === 'lobby'}
      <Lobby />
    {:else if $gameState.state === 'bidding' || $gameState.state === 'tricks' || $gameState.state === 'round_end'}
      <GameBoard />
    {:else if $gameState.state === 'winner'}
      <WinnerScreen />
    {/if}
  {/if}
  {/if}
</div>

<style>
  .join-blocked-screen {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 1rem;
    background: linear-gradient(180deg, #e9f5fb, #dfeef8);
    color: #1f2f44;
  }
  .join-blocked-screen h2 {
    margin: 0 0 0.45rem;
  }
  .join-blocked-screen p {
    margin: 0 0 0.9rem;
    max-width: 520px;
    color: #4f6073;
  }
  .join-blocked-screen button {
    border: none;
    border-radius: 8px;
    background: #004c8c;
    color: #fff;
    padding: 0.6rem 1rem;
    font-weight: 700;
    cursor: pointer;
  }
</style>
