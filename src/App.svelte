<script lang="ts">
  import { gameStage } from './store';
  import Lobby from './components/Lobby.svelte';
  import GameBoard from './components/GameBoard.svelte';
  import WinnerScreen from './components/WinnerScreen.svelte';
</script>

{#if $gameStage === 'lobby'}
  <Lobby />
{:else if $gameStage === 'playing'}
  <GameBoard />
{:else if $gameStage === 'winner'}
  <WinnerScreen />
{/if}
