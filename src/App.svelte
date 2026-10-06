<script lang="ts">
  import { gameState, localSocketId } from './store';
  import Lobby from './components/Lobby.svelte';
  import GameBoard from './components/GameBoard.svelte';
  import WinnerScreen from './components/WinnerScreen.svelte';
  import { soundEffects } from './utils/soundEffects';
  import { toasts } from './utils/toast';
  import './utils/prefs'; // applies the saved text size before anything renders
  import { onMount, onDestroy } from 'svelte';
  import { fly } from 'svelte/transition';
  import { setupSocketHandlers, cleanupSocketHandlers, registerErrorHandler } from './utils/socketHandlers';

  let joinBlockedMessage = '';
  let everConnected = false;
  let stopJoinErrors: (() => void) | null = null;

  $: if ($localSocketId) everConnected = true;
  $: phase = $gameState?.state;
  $: inGame = phase === 'bidding' || phase === 'tricks' || phase === 'round_end';

  function onDocumentClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!button || button.disabled || button.dataset.noButtonSound === 'true') return;
    soundEffects.playButton();
  }

  onMount(() => {
    setupSocketHandlers();
    stopJoinErrors = registerErrorHandler('join_error', (message) => {
      joinBlockedMessage = message || 'A game is already in progress. You can join when it finishes.';
    });
  });

  onDestroy(() => {
    stopJoinErrors?.();
    cleanupSocketHandlers();
  });
</script>

<svelte:document on:click={onDocumentClick} />

{#if joinBlockedMessage}
  <main class="notice" role="alert">
    <img src="/logo/logo.png" alt="Hardman Boa-Whist" />
    <h1>Game in progress</h1>
    <p>{joinBlockedMessage}</p>
    <button class="btn btn-primary" type="button" on:click={() => window.location.reload()}>Try again</button>
  </main>
{:else if !$gameState}
  <main class="notice" aria-busy="true">
    <img src="/logo/logo.png" alt="Hardman Boa-Whist" />
    <p>{everConnected ? 'Loading the table…' : 'Connecting to the table…'}</p>
  </main>
{:else if phase === 'lobby'}
  <Lobby />
{:else if inGame}
  <GameBoard />
{:else if phase === 'winner'}
  <WinnerScreen />
{/if}

{#if $gameState && everConnected && !$localSocketId}
  <div class="connection" role="status">Reconnecting…</div>
{/if}

<div class="toasts" aria-live="assertive">
  {#each $toasts as toast (toast.id)}
    <div class="toast" transition:fly={{ y: -16, duration: 200 }}>{toast.message}</div>
  {/each}
</div>

<style>
  .notice {
    height: 100dvh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.75rem;
    padding: 24px;
    text-align: center;
  }
  .notice img {
    width: clamp(180px, 45vw, 280px);
    margin-bottom: 1rem;
    filter: drop-shadow(0 10px 24px rgba(3, 14, 24, 0.45));
  }
  .notice h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 2.4rem;
    line-height: 1;
  }
  .notice p {
    margin: 0 0 0.5rem;
    max-width: 36ch;
    color: var(--on-felt-muted);
  }
  .connection {
    position: fixed;
    left: 50%;
    bottom: max(16px, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 500;
    padding: 0.4rem 1rem;
    border-radius: 999px;
    background: var(--ink);
    color: var(--on-felt);
    box-shadow: var(--shadow-chip);
    font-weight: 600;
  }
  .toasts {
    position: fixed;
    top: max(12px, env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    z-index: 600;
    display: grid;
    gap: 8px;
    width: min(92vw, 420px);
    pointer-events: none;
  }
  .toast {
    padding: 0.7rem 1rem;
    border-radius: 14px;
    background: var(--paper);
    color: var(--ink);
    box-shadow: var(--shadow-sheet);
    border-left: 4px solid var(--heart);
    font-weight: 600;
  }
</style>
