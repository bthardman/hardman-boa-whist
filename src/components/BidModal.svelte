<script lang="ts">
  // The "your bid" panel shown in the middle of the table when it's your turn to bid.
  import type { Player } from '../../shared/types';
  import BidSelector from './BidSelector.svelte';
  import { displayName } from '../../shared/players';
  import { getPlayerAvatarUrl } from '../avatarUtils';
  import { TRICKS_PER_ROUND, totalBids } from '../utils/gameUtils';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { registerErrorHandler } from '../utils/socketHandlers';
  import { showToast } from '../utils/toast';

  export let players: Player[];
  export let localPlayerId: string;
  export let forbiddenBid: number | null;

  const dispatch = createEventDispatcher<{ bid: { bid: number } }>();
  let submitted = false;

  // If the server rejects the bid, unlock the keypad so a different number can be chosen.
  const stopListening = registerErrorHandler('bid_error', (message) => {
    submitted = false;
    showToast(message);
  });
  onDestroy(stopListening);

  $: others = players.filter((p) => p.playerId !== localPlayerId);
  $: total = totalBids(players);
  $: bidders = others.filter((p) => typeof p.bid === 'number');
  $: waiting = others.filter((p) => typeof p.bid !== 'number');
  $: remainingBidders = waiting.length;
  $: bidMarkers = (() => {
    const markers: Record<number, { avatarUrl: string; label: string }[]> = {};
    for (const p of others) {
      if (typeof p.bid !== 'number') continue;
      (markers[p.bid] ??= []).push({ avatarUrl: getPlayerAvatarUrl(p), label: displayName(p) });
    }
    return markers;
  })();

  function onBid(e: CustomEvent<{ bid: number }>) {
    if (submitted) return;
    submitted = true;
    dispatch('bid', e.detail);
  }
</script>

<section class="sheet bid-panel" aria-labelledby="bid-title">
  <h2 id="bid-title">How many tricks will you win?</h2>
  <p class="context">
    {#if total === 0 && remainingBidders === others.length}
      You're first to bid. There are {TRICKS_PER_ROUND} tricks this round.
    {:else}
      Bids so far add up to <strong class="num">{total}</strong> of {TRICKS_PER_ROUND} tricks.
    {/if}
  </p>

  {#if bidders.length}
    <ul class="bids-so-far" aria-label="Bids so far">
      {#each bidders as p (p.playerId)}
        <li>
          <img class="avatar" src={getPlayerAvatarUrl(p)} alt="" />
          <span class="who">{displayName(p)}</span>
          <span class="what">bid <strong class="num">{p.bid}</strong></span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if waiting.length}
    <p class="still-to-bid">
      <span class="label">Still to bid after you:</span>
      <span class="faces" aria-hidden="true">
        {#each waiting as p (p.playerId)}<img class="avatar" src={getPlayerAvatarUrl(p)} alt="" />{/each}
      </span>
      <span class="names">{waiting.map(displayName).join(', ')}</span>
    </p>
  {/if}

  <BidSelector forbidden={forbiddenBid} {bidMarkers} disabled={submitted} on:bid={onBid} />

  {#if forbiddenBid !== null}
    <p class="rule">
      You bid last, so you can't pick <strong class="num">{forbiddenBid}</strong> — the bids can't add up to exactly {TRICKS_PER_ROUND}.
    </p>
  {/if}
</section>

<style>
  .bid-panel {
    width: min(100%, 520px);
    padding: 1.2rem 1.2rem 1.1rem;
    text-align: center;
  }
  h2 {
    font-size: clamp(1.6rem, 6vw, 2.1rem);
  }
  .context {
    margin: 0.4rem 0 0.6rem;
    color: var(--ink-soft);
  }
  .context strong {
    color: var(--ink);
    font-size: 1.2em;
  }
  .bids-so-far {
    list-style: none;
    margin: 0 0 0.9rem;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }
  .bids-so-far li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.2rem 0.7rem 0.2rem 0.2rem;
    border-radius: 999px;
    background: white;
    box-shadow: inset 0 0 0 1px var(--paper-line);
    font-size: 0.95rem;
  }
  .bids-so-far .avatar {
    width: 30px;
    height: 30px;
    border-width: 2px;
    border-color: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  }
  .who {
    font-weight: 700;
  }
  /* Separate from (and quieter than) the bids already made, which matter most. */
  .still-to-bid {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 0.3rem 0.45rem;
    margin: -0.3rem 0 0.8rem;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  .still-to-bid .faces {
    display: flex;
  }
  .still-to-bid .avatar {
    width: 24px;
    height: 24px;
    margin-left: -6px;
    border-width: 2px;
    border-color: white;
  }
  .still-to-bid .avatar:first-child {
    margin-left: 0;
  }
  .what strong {
    font-size: 1.25em;
    color: var(--ink);
  }
  @media (min-width: 700px) and (min-height: 700px) {
    .bid-panel {
      width: min(100%, 640px);
      padding: 1.6rem 1.6rem 1.4rem;
    }
    h2 {
      font-size: 2.5rem;
    }
    .context {
      font-size: 1.15rem;
    }
  }
  /* Narrow phones: chips show the (coloured) picture and bid only, so they fit on one row. */
  @media (max-width: 520px) {
    .bids-so-far .who {
      display: none;
    }
    .bid-panel h2 {
      font-size: 1.45rem;
    }
  }
  .rule {
    margin: 0.85rem 0 0;
    padding: 0.55rem 0.75rem;
    border-radius: 10px;
    background: var(--heart-soft);
    color: #8f1d2c;
    font-size: 0.92rem;
    text-align: left;
  }
  /*
   * Screens under 900px tall (phones, landscape tablets and laptops): tighter spacing so the panel
   * fits between the seats and the hand.
   */
  @media (max-height: 899px) {
    .bid-panel {
      width: min(100%, 720px);
      padding: 0.9rem 1.2rem;
    }
    h2 {
      font-size: 1.6rem;
    }
    .context {
      margin: 0.2rem 0 0.7rem;
      font-size: 1rem;
    }
    .bids-so-far {
      margin-bottom: 0.5rem;
    }
    .bids-so-far li {
      font-size: 0.88rem;
    }
    .bids-so-far .avatar {
      width: 24px;
      height: 24px;
    }
    .still-to-bid {
      margin: -0.2rem 0 0.5rem;
      font-size: 0.85rem;
    }
    .rule {
      margin-top: 0.6rem;
      padding: 0.4rem 0.7rem;
    }
  }
</style>
