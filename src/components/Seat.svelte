<script lang="ts">
  import type { Player } from '../../shared/types';
  import { displayName } from '../../shared/players';
  import { getPlayerAvatarUrl } from '../avatarUtils';
  import Icon from './ui/Icon.svelte';
  import { createEventDispatcher } from 'svelte';

  export let player: Player;
  export let active = false;
  export let isYou = false;
  /** Brief highlight after this player takes a trick. */
  export let justWon = false;
  /** The bid can no longer be made. */
  export let trouble = false;
  export let showTricks = true;
  /** 'row' puts the stats beside the avatar (used for your own seat). */
  export let layout: 'stack' | 'row' = 'stack';
  /** Tight spaces (many players on a phone): "1/2" instead of "Won 1 of 2". */
  export let compact = false;
  /** Already played this trick (or already bid): dimmed so the players still to go stand out. */
  export let done = false;
  /** A reaction to show in a speech bubble, if any. */
  export let emote: { emoji: string; text: string } | null = null;
  /** Your own seat: tapping the picture opens the reactions. */
  export let portraitButton = false;

  const dispatch = createEventDispatcher<{ tally: void; portrait: void }>();

  $: name = displayName(player);
  $: hasBid = typeof player.bid === 'number';
  $: bid = player.bid ?? 0;
  $: won = player.tricksWon ?? 0;
  // One pip per trick bid; extra red pips for tricks taken beyond the bid.
  $: pips = Array.from({ length: Math.max(bid, won) }, (_, i) =>
    i < Math.min(won, bid) ? 'won' : i < bid ? 'open' : 'over'
  );
  $: summary = !hasBid
    ? `${name} hasn't bid yet`
    : showTricks
      ? `${name}: won ${won} of ${bid} bid`
      : `${name} bid ${bid}`;
</script>

<div
  class="seat {layout}"
  class:active
  class:you={isYou}
  class:just-won={justWon}
  class:offline={player.disconnected}
  class:done
  data-seat-id={player.playerId}
  aria-label={summary}
>
  <div class="portrait">
    {#if portraitButton}
      <button type="button" class="portrait-btn" aria-label="Send a reaction" on:click={() => dispatch('portrait')}>
        <img class="avatar" src={getPlayerAvatarUrl(player)} alt="" />
      </button>
    {:else}
      <img class="avatar" src={getPlayerAvatarUrl(player)} alt="" />
    {/if}
    {#if emote}
      {#key emote}
        <div class="bubble" role="status"><span class="emoji" aria-hidden="true">{emote.emoji}</span> {emote.text}</div>
      {/key}
    {/if}
    {#if player.disconnected}
      <span class="offline-badge" title="Reconnecting…"><Icon name="wifi-off" size={14} /></span>
    {/if}
  </div>
  <div class="meta">
    <div class="name">{isYou ? 'You' : name}</div>
    {#if hasBid}
      <svelte:element
        this={showTricks ? 'button' : 'div'}
        type={showTricks ? 'button' : undefined}
        class="tally"
        class:trouble
        class:clickable={showTricks}
        aria-label={showTricks ? `${summary}. Show tricks won` : undefined}
        aria-hidden={showTricks ? undefined : 'true'}
        on:click={() => showTricks && dispatch('tally')}
        role={showTricks ? undefined : 'presentation'}
      >
        {#if showTricks}
          {#if compact}
            <span class="count num">{won}<span class="of">/{bid}</span></span>
          {:else if bid === 0}
            <span class="count num"><span class="of">Bid</span> 0<span class="of">, won</span> {won}</span>
          {:else}
            <span class="count num"><span class="of">Won</span> {won} <span class="of">of</span> {bid}</span>
          {/if}
          {#if pips.length}
            <span class="pips">
              {#each pips as pip}<i class={pip}></i>{/each}
            </span>
          {/if}
        {:else}
          <span class="count num"><span class="of">Bid</span> {bid}</span>
        {/if}
      </svelte:element>
    {:else if active && !isYou}
      <div class="thinking" aria-hidden="true"><i></i><i></i><i></i></div>
    {/if}
  </div>
</div>

<style>
  .seat {
    --size: var(--seat-avatar, 64px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    color: var(--on-felt);
    text-align: center;
  }
  .seat.row {
    flex-direction: row;
    text-align: left;
    gap: 0.7rem;
  }
  .row .meta {
    align-items: flex-start;
  }
  .portrait {
    position: relative;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    transition: transform 240ms var(--ease-out);
  }
  .portrait .avatar {
    width: 100%;
    height: 100%;
    border-color: rgba(234, 244, 251, 0.55);
    transition: border-color 200ms, box-shadow 200ms;
  }
  .active .portrait {
    transform: scale(1.08);
  }
  .active .portrait .avatar {
    border-color: var(--ice);
    box-shadow:
      0 0 0 4px rgba(143, 221, 251, 0.28),
      0 0 26px rgba(143, 221, 251, 0.55);
  }
  .active .portrait::after {
    content: '';
    position: absolute;
    inset: -8px;
    pointer-events: none;
    border-radius: 50%;
    border: 2px solid var(--ice);
    opacity: 0;
    animation: ring 1.8s ease-out infinite;
  }
  .portrait-btn {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    cursor: pointer;
  }
  /* Already played / bid: still visible, just quieter than the players still to go. */
  .done .portrait .avatar {
    filter: grayscale(0.7) brightness(0.72);
  }
  .done .name {
    opacity: 0.7;
  }
  .bubble {
    position: absolute;
    z-index: 40;
    left: 50%;
    bottom: calc(100% + 8px);
    transform: translateX(-50%);
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 700;
    font-size: 0.95rem;
    white-space: nowrap;
    box-shadow: var(--shadow-chip);
    pointer-events: none;
    animation: bubble 2.8s var(--ease-out) forwards;
  }
  .bubble::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 100%;
    margin-left: -7px;
    border: 7px solid transparent;
    border-top-color: var(--paper);
  }
  .bubble .emoji {
    font-size: 1.25em;
  }
  /* Opponents along the top: bubble hangs below so it stays on screen. */
  .stack .bubble {
    bottom: auto;
    top: calc(100% + 8px);
  }
  .stack .bubble::after {
    top: auto;
    bottom: 100%;
    border-top-color: transparent;
    border-bottom-color: var(--paper);
  }
  @keyframes bubble {
    0% {
      opacity: 0;
      transform: translateX(-50%) scale(0.7);
    }
    10%,
    85% {
      opacity: 1;
      transform: translateX(-50%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateX(-50%) scale(0.95);
    }
  }
  .just-won .portrait .avatar {
    border-color: #ffd36b;
    box-shadow: 0 0 0 4px rgba(255, 211, 107, 0.3), 0 0 30px rgba(255, 211, 107, 0.6);
  }
  .offline .portrait .avatar {
    filter: grayscale(1) brightness(0.7);
  }
  .offline-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--ink);
    color: var(--on-felt-muted);
    border: 2px solid var(--felt);
  }
  .meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    min-width: 0;
    max-width: 100%;
  }
  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: var(--seat-name, 1.1rem);
    line-height: 1;
    letter-spacing: 0.01em;
  }
  .active .name {
    color: var(--ice);
  }
  .tally {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    row-gap: 0.15rem;
    gap: 0.4rem;
    padding: 0.15rem 0.55rem 0.15rem 0.5rem;
    border-radius: 0.8rem;
    background: rgba(4, 16, 27, 0.5);
  }
  .count {
    font-size: var(--seat-tally, 1.1rem);
    white-space: nowrap;
    line-height: 1.2;
    color: var(--on-felt);
  }
  .of {
    color: var(--on-felt-muted);
    font-weight: 600;
  }
  .pips {
    display: flex;
    gap: 3px;
  }
  .pips i {
    display: block;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
  }
  .pips .won {
    background: var(--ice);
  }
  .pips .open {
    box-shadow: inset 0 0 0 1.5px rgba(234, 244, 251, 0.6);
  }
  .pips .over {
    background: var(--heart);
  }
  button.tally {
    border: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  button.tally:hover {
    background: rgba(4, 16, 27, 0.75);
  }
  .tally.trouble {
    background: rgba(226, 56, 77, 0.22);
    box-shadow: inset 0 0 0 1px rgba(226, 56, 77, 0.6);
  }
  .tally.trouble .open {
    box-shadow: inset 0 0 0 1.5px var(--heart);
  }
  .thinking {
    display: flex;
    gap: 4px;
    height: 1.5rem;
    align-items: center;
  }
  .thinking i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ice);
    animation: think 1.2s infinite ease-in-out;
  }
  .thinking i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .thinking i:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes ring {
    0% {
      opacity: 0.8;
      transform: scale(0.92);
    }
    100% {
      opacity: 0;
      transform: scale(1.18);
    }
  }
  @keyframes think {
    0%,
    80%,
    100% {
      opacity: 0.25;
      transform: translateY(0);
    }
    40% {
      opacity: 1;
      transform: translateY(-3px);
    }
  }
</style>
