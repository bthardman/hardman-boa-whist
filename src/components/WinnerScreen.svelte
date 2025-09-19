<script lang="ts">
  import { gameState } from '../store';
  import { getWinnerAvatarUrl } from '../avatarUtils';
  import { getPlayerName } from '../avatarData';

  function playAgain(event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement; }) {
    // ToDo send message to Server
  }

</script>

<div class="winner-screen">
  <h2>Winner!</h2>
  {#if $gameState && $gameState.winner}
    <img src={getWinnerAvatarUrl($gameState.winner)} alt="Winner Avatar" class="avatar"/>
    <div class="player-name">{getPlayerName($gameState.winner.selectedAvatar)}</div>
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
