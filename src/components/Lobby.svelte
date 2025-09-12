<script lang="ts">
  import { players, gameStage } from '../store';

  function startGame() {
    gameStage.set('playing');
  }

  function selectAvatar(index: number, avatarUrl: string) {
    players.update(pls => {
      pls[index].selectedAvatar = avatarUrl;
      return pls;
    });
  }
</script>

<h1>Lobby</h1>
<div class="lobby">
  {#each $players as player, i}
    <div class="lobby-avatar">
      <img
        src={player.selectedAvatar || player.avatar1}
        alt={player.name}
        class="avatar"
        on:click={() => selectAvatar(i, player.avatar1)}
      />
      <div class="player-name">{player.name}</div>
    </div>
  {/each}
</div>

<button on:click={startGame}>Start Game</button>

<style>
  .lobby {
    display: flex;
    justify-content: space-around;
    padding: 2rem;
  }
  .lobby-avatar {
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
  }
  .avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    border: 2px solid #fff;
    transition: transform 0.3s;
  }
  .lobby-avatar:hover .avatar {
    transform: scale(1.1);
  }
  .player-name {
    margin-top: 0.5rem;
    font-weight: bold;
  }
</style>
