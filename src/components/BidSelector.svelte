<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { TRICKS_PER_ROUND } from '../utils/gameUtils';

  /** The one number the last bidder can't choose. */
  export let forbidden: number | null = null;
  /** Small avatars above each number showing who else bid it. */
  export let bidMarkers: Record<number, { avatarUrl: string; label: string }[]> = {};
  export let disabled = false;

  const dispatch = createEventDispatcher<{ bid: { bid: number } }>();
  const options = Array.from({ length: TRICKS_PER_ROUND + 1 }, (_, i) => i);
</script>

<div class="keypad" role="group" aria-label="Choose your bid">
  {#each options as num}
    {@const blocked = forbidden === num}
    <button
      type="button"
      class="key"
      class:blocked
      disabled={blocked || disabled}
      data-no-button-sound="true"
      aria-label={blocked ? `${num}, not allowed` : `Bid ${num}`}
      on:click={() => dispatch('bid', { bid: num })}
    >
      {#if bidMarkers[num]?.length}
        <span class="markers" aria-hidden="true">
          {#each bidMarkers[num] as marker}
            <img src={marker.avatarUrl} alt="" title={marker.label} />
          {/each}
        </span>
      {/if}
      <span class="num">{num}</span>
    </button>
  {/each}
</div>

<style>
  .keypad {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: clamp(6px, 1.2vw, 10px);
    padding-top: 14px; /* room for the avatar markers */
  }
  .key {
    position: relative;
    aspect-ratio: 5 / 6;
    min-height: 48px;
    border: 0;
    border-radius: 12px;
    background: white;
    color: var(--ink);
    box-shadow:
      inset 0 0 0 1.5px var(--paper-line),
      0 3px 0 #c9d6e2;
    cursor: pointer;
    transition: transform 120ms var(--ease-out), box-shadow 120ms, background-color 120ms;
  }
  .key .num {
    font-size: clamp(1.5rem, 5vw, 2.2rem);
    font-weight: 800;
  }
  .key:hover:not(:disabled) {
    background: var(--ink);
    color: var(--ice);
    box-shadow: 0 3px 0 #04121e;
  }
  .key:active:not(:disabled) {
    transform: translateY(3px);
    box-shadow: 0 0 0 #04121e;
  }
  .key.blocked {
    background: transparent;
    color: #a9b6c3;
    box-shadow: inset 0 0 0 1.5px var(--paper-line);
    cursor: not-allowed;
  }
  .key.blocked .num {
    text-decoration: line-through;
    text-decoration-color: var(--heart);
    text-decoration-thickness: 3px;
  }
  .markers {
    position: absolute;
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
  }
  .markers img {
    width: 22px;
    height: 22px;
    margin-left: -6px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid white;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .markers img:first-child {
    margin-left: 0;
  }
</style>
