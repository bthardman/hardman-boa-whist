<script lang="ts">
  import { onMount } from 'svelte';
  import { players, roomId, type Player } from '../store';
  import { socket } from "../socket";

  function startGame() {
    socket.emit("start_game", { roomId });
  }

  onMount(() => {
    socket.on("lobby_update", (updatedPlayers: Player[]) => {
      $players = updatedPlayers;
    });
  });

  function selectAvatar(index: number, avatarUrl: string) {
    // Send full player object to server
    const player = { ...$players[index], selectedAvatar: avatarUrl };
    socket.emit("join_lobby", { roomId, player });
  }
</script>

<h1>Lobby</h1>
<div class="lobby">
  {#each $players as player, i}
    <div class="lobby-avatar">
      <button
        type="button"
        class="avatar-btn"
        on:click={() => selectAvatar(i, player.avatar1)}
        aria-label={`Select avatar for ${player.name}`}
        disabled={$players.some((p, idx) => idx !== i && p.selectedAvatar === player.avatar1)}
      >
        <img
          src={player.selectedAvatar || player.avatar1}
          alt={player.name}
          class="avatar"
        />
      </button>
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
  .avatar-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .avatar-btn:focus .avatar,
  .lobby-avatar:hover .avatar {
    transform: scale(1.1);
    outline: 2px solid #0077ff;
  }
  .player-name {
    margin-top: 0.5rem;
    font-weight: bold;
  }
</style>
