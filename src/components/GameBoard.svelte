<script lang="ts">
  import { players, gameState, type Player} from '../store';
  import Card from './Card.svelte';
  import { onDestroy } from 'svelte';

  let swapInterval = setInterval(() => {
    players.update((pls: Player[]) => {
      pls.forEach((player: Player) => {
        if (player.inGameAvatar) {
          player.inGameAvatar = player.inGameAvatar === player.avatar1 ? player.avatar2 : player.avatar1;
        } else {
          player.inGameAvatar = player.avatar1;
        }
      });
      return pls;
    });
  }, 1000);

  onDestroy(() => clearInterval(swapInterval));
</script>

<div class="gameboard">
  {#each $players as player, i}
    <div class="player-seat" style="--player-index:{i}">
      <img src={player.inGameAvatar || player.avatar1} alt={player.name} class="avatar"/>
      <div class="player-name">{player.name}</div>
      <div class="hand">
        {#each player.hand as ownedCard}
          <Card {ownedCard}/>
        {/each}
      </div>
    </div>
  {/each}

  <div class="table">
    {#if $gameState}
      {#each $gameState.currentTrick as ownedCard}
        <Card {ownedCard} />
      {/each}
    {/if}
  </div>
</div>

<style>
  .gameboard {
    position: relative;
    width: 100%;
    height: 100%;
    background: url('/background/table_bg.svg') center/cover no-repeat;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem;
  }
  .player-seat {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 1rem;
  }
  .avatar {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    border: 2px solid #fff;
  }
  .player-name {
    font-size: 0.9rem;
    margin-top: 0.2rem;
  }
  .hand {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.5rem;
  }
  .table {
    display: flex;
    gap: 1rem;
    margin-top: 2rem;
  }
</style>
