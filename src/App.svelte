<script lang="ts">
  import { gameState, players, scoreboard } from './store';
  import Scoreboard from './components/Scoreboard.svelte';
  import Lobby from './components/Lobby.svelte';
  import GameBoard from './components/GameBoard.svelte';
  import WinnerScreen from './components/WinnerScreen.svelte';
  import { socket } from "./socket";
  import { onMount } from 'svelte';

  
  onMount(() => {
    socket.on("state_updated", (state: any) => {
      gameState.set(state);
    });
  });
</script>

{#if $gameState}
  {#if $gameState.state === 'lobby'}
    <Lobby />
  {:else if $gameState.state === 'bidding' || $gameState.state === 'tricks' || $gameState.state === 'round_end'}
    <Scoreboard />
    <GameBoard />
  {:else if $gameState.state === 'winner'}
    <WinnerScreen />
  {/if}
{/if}