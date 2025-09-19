<script lang="ts">
  import { gameState } from './store';
  import Scoreboard from './components/Scoreboard.svelte';
  import Lobby from './components/Lobby.svelte';
  import GameBoard from './components/GameBoard.svelte';
  import WinnerScreen from './components/WinnerScreen.svelte';
  import { socket } from "./socket";
  import { onMount } from 'svelte';
  import { roomId } from './store';
  
  let mySocketId: string = '';
  onMount(() => {
    let gotState = false;
  mySocketId = socket.id || '';
    socket.on("connect", () => {
      mySocketId = socket.id || '';
    });
    socket.on("state_updated", (state: any) => {
      // Mark the local player client-side only
      if (mySocketId && state.players) {
        // Always assign a new array reference for Svelte reactivity
        const newPlayers = (state.players as any[]).map((p: any) => ({ ...p, isLocal: p.socketId === mySocketId }));
        state = { ...state, players: newPlayers };
      }
      console.log("Received state_updated:", state);
      gameState.set(state);
      gotState = true;
    });
    // Request initial state from server
    socket.emit("get_state", { roomId: $roomId });
    // If no state received after short delay, emit join_lobby for this player
    setTimeout(() => {
      if (!gotState) {
        socket.emit("join_lobby", { roomId: $roomId });
      }
    }, 500);
  });

  $: console.log("$gameState:", $gameState);
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