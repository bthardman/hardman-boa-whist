<script lang="ts">
  import { winner, gameStage } from '../store';

  function playAgain() {
    gameStage.set('lobby');
  }
</script>

<div class="winner-screen">
  <h2>Winner!</h2>
  {#if $winner}
    <img src={$winner.inGameAvatar || $winner.avatar1} alt={$winner.name} class="avatar"/>
    <div class="player-name">{$winner.name}</div>
  {/if}
  <button on:click={playAgain}>Play Again</button>
</div>

<style>
  .winner-screen {
    text-align: center;
    margin-top: 2rem;
  }
  .avatar {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    border: 3px solid gold;
  }
  .player-name {
    margin-top: 1rem;
    font-size: 1.5rem;
    font-weight: bold;
  }
  button {
    margin-top: 2rem;
    padding: 0.5rem 1rem;
    font-size: 1rem;
  }
</style>
