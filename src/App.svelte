<script lang="ts">
  import { gameState } from './store';
  import Scoreboard from './components/Scoreboard.svelte';
  import Lobby from './components/Lobby.svelte';
  import GameBoard from './components/GameBoard.svelte';
  import WinnerScreen from './components/WinnerScreen.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { setupSocketHandlers, cleanupSocketHandlers } from './utils/socketHandlers';

  onMount(() => {
    setupSocketHandlers();
  });

  onDestroy(() => {
    cleanupSocketHandlers();
  });
  
  $: console.log("$gameState:", $gameState);
</script>

<div class="app-bg">
  {#if $gameState}
    {#if $gameState.state === 'lobby'}
      <Lobby />
    {:else if $gameState.state === 'bidding' || $gameState.state === 'tricks' || $gameState.state === 'round_end'}
      <GameBoard />
    {:else if $gameState.state === 'winner'}
      <WinnerScreen />
    {/if}
  {/if}
</div>
