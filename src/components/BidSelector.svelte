<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let forbidden: number | null = null;
  export let playerName: string = '';

  const dispatch = createEventDispatcher();

  function selectBid(bid: number) {
    if (forbidden !== null && bid === forbidden) return;
    dispatch('bid', { bid });
  }
</script>

<div class="bid-title">
  {playerName}, select your bid for tricks:
</div>
<div class="bid-container">
  {#each Array(8).fill(0).map((_, i) => i) as num}
    <button
      type="button"
      class="bid-card {forbidden !== null && num === forbidden ? 'disabled' : ''}"
      on:click={() => selectBid(num)}
      disabled={forbidden !== null && num === forbidden}
      aria-disabled={forbidden !== null && num === forbidden}
    >
      {num}
    </button>
  {/each}
</div>

<style>
.bid-container {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: center;
  margin: 2rem 0;
}
.bid-card {
  width: 60px;
  height: 90px;
  background: linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.10);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: bold;
  color: #2c3e50;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
  user-select: none;
}
.bid-card:hover {
  transform: scale(1.08);
  box-shadow: 0 4px 16px rgba(44,62,80,0.15);
}
.bid-card.disabled {
  background: #eee;
  color: #aaa;
  cursor: not-allowed;
  box-shadow: none;
  opacity: 0.6;
}
.bid-title {
  text-align: center;
  font-size: 1.2rem;
  margin-bottom: 1rem;
  color: #34495e;
}
</style>
