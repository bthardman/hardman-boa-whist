<script lang="ts">
  import { gameState } from '../store';
</script>

{#if $gameState}
<div class="scoreboard">
  <h2>Scoreboard</h2>
  <ul>
    {#each Object.entries($gameState.scoreboard) as [name, score]}
      <li>{name} <span>{score}</span></li>
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
.scoreboard li {
  font-size: 1.15rem;
  margin: 0.25rem 0;
  color: #34495e;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>