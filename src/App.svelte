<script lang="ts">
  import { gameState, localSocketId, localPlayerId } from './store';
  import type { Player } from '../shared/types';
  import Scoreboard from './components/Scoreboard.svelte';
  import Lobby from './components/Lobby.svelte';
  import GameBoard from './components/GameBoard.svelte';
  import WinnerScreen from './components/WinnerScreen.svelte';
  import { socket } from "./socket";
  import { onMount } from 'svelte';
  import { roomId } from './store';

  onMount(() => {
    socket.on("state_updated", (state: any) => {
      // Always assign a new array reference for Svelte reactivity
      const newPlayers = (state.players as any[]);
      state = { ...state, players: newPlayers };
      gameState.set(state);
    });

    socket.on("connect", () => {
      localSocketId.set(socket.id);
    });

    socket.emit("get_state", { roomId: $roomId });

    setTimeout(() => {
      if (!$gameState || $gameState.players.findIndex((p: Player) => p.playerId === $localPlayerId)) {
        socket.emit("join_lobby", { roomId: $roomId, playerId: $localPlayerId });
      }
    }, 500);
  });
  
  $: console.log("$gameState:", $gameState);
</script>

<div class="app-bg">
  {#if $gameState}
    {#if $gameState.state === 'lobby'}
      <Lobby />
    {:else if $gameState.state === 'bidding' || $gameState.state === 'tricks' || $gameState.state === 'round_end'}
      <!--<Scoreboard />-->
      <GameBoard />
    {:else if $gameState.state === 'winner'}
      <WinnerScreen />
    {/if}
  {/if}
</div>
