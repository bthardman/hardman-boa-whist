<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  // (no card rendering here - BidSelector only shows bid buttons)

  export let forbidden: number | null = null;
  export let bidMarkers: Record<number, { avatarUrl: string; label: string }[]> = {};

  const dispatch = createEventDispatcher();

  function selectBid(bid: number) {
    if (forbidden !== null && bid === forbidden) return;
    dispatch('bid', { bid });
  }
</script>
<div class="bid-container">
  {#each Array(8).fill(0).map((_, i) => i) as num}
    <button
      type="button"
      class="bid-card {forbidden !== null && num === forbidden ? 'disabled' : ''}"
      on:click={() => selectBid(num)}
      disabled={forbidden !== null && num === forbidden}
      aria-disabled={forbidden !== null && num === forbidden}
    >
      {#if bidMarkers[num] && bidMarkers[num].length > 0}
        <div class="bid-markers" aria-hidden="true">
          {#each bidMarkers[num] as marker, markerIdx (marker.avatarUrl + markerIdx)}
            <img src={marker.avatarUrl} alt={marker.label} class="bid-marker-avatar" />
          {/each}
        </div>
      {/if}
      {num}
    </button>
  {/each}
</div>

<style>
/* Horizontal row of 8 bid buttons that always fits the available width */
.bid-container {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: clamp(0.2rem, 0.5vw, 0.4rem);
  margin: 0.4vh auto;
  padding: 0;
  width: fit-content;
  max-width: 100%;
  box-sizing: border-box;
}
.bid-card {
  position: relative;
  overflow: visible;
  flex: 0 1 auto;
  width: clamp(38px, 8vw, 70px);
  aspect-ratio: 0.78;
  min-width: 36px;
  min-height: 0;
  max-width: 70px;
  max-height: 92px;
  background: linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.10);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(1rem, 3.2vw, 1.8rem);
  font-weight: bold;
  color: #2c3e50;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
  user-select: none;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  border: 1px solid rgba(44, 62, 80, 0.2);
  padding: 0;
}
.bid-markers {
  position: absolute;
  left: 50%;
  top: -14px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  pointer-events: none;
}
.bid-marker-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: contain;
  border: 1px solid rgba(44, 62, 80, 0.35);
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
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
/* Scale down on narrower viewports, but keep 8 in one row */
@media (max-width: 900px) {
  .bid-container {
    gap: 0.3rem;
  }
  .bid-card {
    width: clamp(38px, 7vw, 58px);
    max-width: 58px;
    max-height: 76px;
    font-size: clamp(0.9rem, 2.6vw, 1.2rem);
    border-radius: 8px;
  }
  .bid-markers { top: -12px; }
  .bid-marker-avatar { width: 16px; height: 16px; }
}

@media (max-width: 600px) {
  .bid-container {
    gap: 0.22rem;
  }
  .bid-card {
    width: clamp(36px, 9vw, 48px);
    max-width: 48px;
    max-height: 64px;
    font-size: clamp(0.85rem, 3vw, 1.05rem);
    border-radius: 7px;
  }
  .bid-markers { top: -11px; }
  .bid-marker-avatar { width: 14px; height: 14px; }
}

@media (max-width: 430px) {
  .bid-container {
    gap: 0.18rem;
  }
  .bid-card {
    width: clamp(34px, 10vw, 42px);
    max-width: 42px;
    max-height: 56px;
    font-size: 0.92rem;
    border-radius: 6px;
  }
}

@media (orientation: landscape) and (max-height: 500px) {
  .bid-container {
    gap: 0.22rem;
    margin: 0.2vh 0;
  }
  .bid-card {
    width: clamp(38px, 6vw, 52px);
    max-width: 52px;
    max-height: 64px;
    font-size: clamp(0.85rem, 2vw, 1.05rem);
  }
}

</style>
