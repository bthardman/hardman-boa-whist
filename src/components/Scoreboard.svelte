<script lang="ts">
  import { gameState } from '../store';
  import { getAvatarData } from '../avatarData';
  import type { Player } from '../../shared/types';
</script>

{#if $gameState && $gameState.roundNumber > 0}
<div class="scoreboard">
  <h2>Scoreboard</h2>
  <div class="round-info">Round {$gameState.roundNumber}</div>
  <ul>
    {#each $gameState.players as player, index}
      {@const score = $gameState.scoreboard[index] || 0}
      {@const isLeading = Math.max(...Object.values($gameState.scoreboard || {})) === score && score > 0}
      <li class:leading={isLeading}>
        <span class="player-name">{getAvatarData(player.selectedAvatar).name}</span>
        <span class="score">{score}</span>
        {#if isLeading && Object.values($gameState.scoreboard || {}).filter(s => s === score).length === 1}
          <span class="leader-badge">👑</span>
        {/if}
      </li>
    {/each}
  </ul>
</div>
{/if}

<style>
.scoreboard {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  padding: 1.5rem 2rem;
  margin: 1rem auto;
  max-width: 400px;
  text-align: center;
}
.scoreboard h2 {
  margin-bottom: 0.5rem;
  font-size: 1.5rem;
  color: #2c3e50;
}
.scoreboard ul {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem 0;
}
.scoreboard .round-info {
  font-size: 0.9rem;
  color: #7f8c8d;
  margin-bottom: 1rem;
  font-weight: 500;
}
.scoreboard ul {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem 0;
}
.scoreboard li {
  font-size: 1.15rem;
  margin: 0.5rem 0;
  color: #34495e;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  border-radius: 6px;
  transition: background-color 0.2s;
}
.scoreboard li.leading {
  background-color: #fff9e6;
  font-weight: 600;
}
.scoreboard .player-name {
  flex: 1;
  text-align: left;
}
.scoreboard .score {
  font-weight: bold;
  min-width: 50px;
  text-align: right;
}
.scoreboard .leader-badge {
  margin-left: 0.5rem;
  font-size: 1.2rem;
}
</style>