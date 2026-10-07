<script lang="ts">
  // The tricks one player has won this round: one row per trick, every card with who played it.
  import { createEventDispatcher } from 'svelte';
  import type { OwnedCard, Player } from '../../shared/types';
  import { displayName } from '../../shared/players';
  import { getPlayerAvatarUrl } from '../avatarUtils';
  import { calculateTrickWinner } from '../utils/gameUtils';
  import Card from './Card.svelte';
  import Icon from './ui/Icon.svelte';

  export let player: Player;
  export let players: Player[];
  export let tricks: { winnerId: string; cards: OwnedCard[] }[];
  export let isYou = false;

  const dispatch = createEventDispatcher<{ close: void }>();

  $: won = tricks
    .map((t, i) => ({ ...t, number: i + 1, winningIndex: calculateTrickWinner(t.cards) }))
    .filter((t) => t.winnerId === player.playerId);
  $: bid = player.bid ?? 0;
  $: title = isYou ? 'Your tricks' : `${displayName(player)}'s tricks`;
  const ownerOf = (c: OwnedCard) => players.find((p) => p.playerId === c.playerId);

  function close() {
    dispatch('close');
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="tricks-title">
  <button class="overlay-dismiss" type="button" aria-label="Close" on:click={close}></button>
  <div class="sheet tricks">
    <header>
      <img class="avatar who" src={getPlayerAvatarUrl(player)} alt="" />
      <div>
        <h3 id="tricks-title">{title}</h3>
        <p class="sub">Won <strong class="num">{player.tricksWon}</strong> of <strong class="num">{bid}</strong> bid</p>
      </div>
      <button class="close" type="button" aria-label="Close" on:click={close}><Icon name="close" /></button>
    </header>

    {#if won.length}
      <ol class="list">
        {#each won as t (t.number)}
          <li>
            <span class="label num">Trick {t.number}</span>
            <div class="cards">
              {#each t.cards as c, i (c.card.id)}
                {@const owner = ownerOf(c)}
                <div class="played" class:winning={i === t.winningIndex}>
                  <Card ownedCard={c} />
                  {#if owner}
                    <img class="owner avatar" src={getPlayerAvatarUrl(owner)} alt={displayName(owner)} title={displayName(owner)} />
                  {/if}
                </div>
              {/each}
            </div>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="empty">No tricks won yet this round.</p>
    {/if}
  </div>
</div>

<style>
  .tricks {
    width: min(100%, 560px);
  }
  header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.8rem;
    margin-bottom: 0.9rem;
  }
  .who {
    width: 48px;
    height: 48px;
    border-width: 2px;
    border-color: white;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  }
  .sub {
    margin: 0.2rem 0 0;
    color: var(--ink-soft);
  }
  .sub strong {
    color: var(--ink);
    font-size: 1.15em;
  }
  .close {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  li {
    display: grid;
    grid-template-columns: 4.2rem 1fr;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.6rem 0.9rem;
    border-radius: 14px;
    background: white;
    box-shadow: inset 0 0 0 1px var(--paper-line);
  }
  .label {
    font-size: 1rem;
    color: var(--ink-soft);
  }
  .cards {
    --card-w: clamp(40px, 10vw, 56px);
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .played {
    position: relative;
  }
  .played.winning :global(.card) {
    box-shadow:
      0 0 0 3px #ffd36b,
      0 4px 10px rgba(3, 14, 24, 0.3);
  }
  .owner {
    position: absolute;
    left: 50%;
    bottom: -10px;
    width: 24px;
    height: 24px;
    transform: translateX(-50%);
    border-width: 2px;
  }
  .empty {
    margin: 0.5rem 0;
    color: var(--ink-soft);
  }
</style>
