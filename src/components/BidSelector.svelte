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
  gap: clamp(0.5rem, 2vw, 1rem);
  justify-content: center;
  margin: clamp(1rem, 3vh, 2rem) 0;
  padding: 0 0.5rem;
}
.bid-card {
  width: clamp(50px, 12vw, 70px);
  height: clamp(75px, 18vw, 105px);
  min-width: 50px;
  min-height: 75px;
  background: linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.10);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(1.5rem, 5vw, 2rem);
  font-weight: bold;
  color: #2c3e50;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
  user-select: none;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.bid-card:hover {
  transform: scale(1.08);
  box-shadow: 0 4px 16px rgba(44,62,80,0.15);
}
.bid-card:active {
  transform: scale(0.95);
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
  font-size: clamp(1rem, 3vw, 1.2rem);
  margin-bottom: clamp(0.75rem, 2vh, 1rem);
  color: #34495e;
  padding: 0 1rem;
  line-height: 1.4;
}

@media (max-width: 768px) {
  .bid-container {
    gap: 0.75rem;
  }
  .bid-card {
    width: 55px;
    height: 82px;
    font-size: 1.75rem;
  }
}

@media (max-width: 480px) {
  .bid-container {
    gap: 0.5rem;
  }
  .bid-card {
    width: 50px;
    height: 75px;
    font-size: 1.5rem;
  }
}
</style>
