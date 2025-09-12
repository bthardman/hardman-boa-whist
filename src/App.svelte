<script lang="ts">
  import { gameStage, winner, type Player, gameState, players, scoreboard } from './store';
  import Scoreboard from './components/Scoreboard.svelte';
  import Lobby from './components/Lobby.svelte';
  import GameBoard from './components/GameBoard.svelte';
  import WinnerScreen from './components/WinnerScreen.svelte';
  import { socket } from "./socket";
  import { onMount } from 'svelte';

  
  onMount(() => {
    socket.on("game_started", (state: any) => {
      gameStage.set("playing");
      gameState.set(state);
    });

    socket.on("trickComplete", ({ winner, tricksWon, state, scoreboard: sb }: any) => {
      gameState.set(state);
      if (sb) scoreboard.set(sb);
      // Optionally show trick winner
      if (winner) {
        const winPlayer = state.players.find((p: any) => p.name === winner) || null;
        winner && winner.set(winPlayer);
      }
      // End game if all hands are empty
      if (state.players.every((p: any) => p.hand.length === 0)) {
        gameStage.set("winner");
      }
    });
    socket.on("game_over", (winnerPlayer: any) => {
      winner.set(winnerPlayer);
      gameStage.set("gameOver");
    });

    socket.on("trickUpdate", (currentTrick: any) => {
      gameState.update((gs: any) => {
        if (gs) gs.currentTrick = currentTrick;
        return gs;
      });
    });

    socket.on("lobby_update", (updatedPlayers: any) => {
      players.set(updatedPlayers);
    });
  });
</script>

{#if $gameStage === 'lobby'}
  <Lobby />
{:else if $gameStage === 'playing'}
  <Scoreboard />
  <GameBoard />
{:else if $gameStage === 'winner'}
  <WinnerScreen />
{/if}
