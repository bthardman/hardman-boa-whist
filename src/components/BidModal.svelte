<script lang="ts">
  import type { OwnedCard, Player, GameState } from '../../shared/types';
  import Card from './Card.svelte';
  import BidSelector from './BidSelector.svelte';
  import { getAvatarData } from '../avatarData';
  import { getPlayerAvatarUrl } from '../avatarUtils';
  import { createEventDispatcher } from 'svelte';

  export let gameState: GameState;
  export let localPlayer: Player | undefined;
  export let biddingSequence: Player[];
  export let forbiddenBid: number | null;
  export let sortHand: (hand: OwnedCard[]) => OwnedCard[];

  const dispatch = createEventDispatcher<{ bid: { bid: number } }>();

  $: currentPlayer = gameState.players[gameState.currentPlayer ?? 0];
  $: hand = currentPlayer?.hand ?? [];

  function onBid(e: CustomEvent<{ bid: number }>) {
    dispatch('bid', { bid: e.detail.bid });
  }
</script>

<section class="bidding-layout" role="dialog" aria-label="Place your bid">
  <div class="bid-center">
    <div class="bids-so-far">
      <span class="bids-so-far-label">Bids so far:</span>
      {#each biddingSequence as p (p.playerId)}
        <span
          class="bids-so-far-item"
          class:you={localPlayer && p.playerId === localPlayer.playerId}
        >
          {getAvatarData(p.selectedAvatar).name}{#if localPlayer && p.playerId === localPlayer.playerId}<span class="you-tag">&nbsp;(you)</span>{/if}:
          {typeof p.bid === 'number' ? p.bid : '—'}
        </span>
      {/each}
    </div>
    <BidSelector playerName="" forbidden={forbiddenBid} on:bid={onBid} />
  </div>

  <div class="bidding-player-row">
    <div class="bidding-hand-stage">
      <div class="hand hand-fanned local-hand">
        {#each sortHand(hand) as ownedCard, idx (ownedCard.card.id)}
          {@const len = hand.length}
          <div
            class="fanned-card"
            style="
              --card-offset: {idx - (len - 1) / 2};
              --fan-lift: {Math.pow(Math.abs(idx - (len - 1) / 2), 2) * 1.6}px;
              left: calc(50% - var(--hand-half, 35px) + var(--card-offset) * var(--hand-spread, 30px));
              z-index: {idx};
              bottom: 0;
              transform-origin: bottom center;
              transform: rotate(calc(var(--card-offset) * var(--hand-rotate, 14deg))) translateY(calc(var(--hand-base-y, -6px) - var(--fan-lift)));
            "
          >
            <Card {ownedCard} />
          </div>
        {/each}
      </div>
    </div>
    <div class="bidding-top-meta">
      <img src={getPlayerAvatarUrl(currentPlayer)} alt="Avatar" class="local-avatar" />
      <div class="local-name">{getAvatarData(currentPlayer.selectedAvatar).name}</div>
    </div>
  </div>
</section>

<style>
  .bidding-layout {
    flex: 1 1 auto;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: clamp(0.6rem, 2vh, 1.2rem);
    padding: clamp(0.75rem, 2vh, 1.1rem) 0.75rem clamp(0.5rem, 2vh, 1rem);
    box-sizing: border-box;
    min-height: 0;
    width: 100%;
    justify-items: center;
    overflow: visible;
  }

  .bid-center {
    background: rgba(255, 255, 255, 0.97);
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    padding: 0.6rem 0.75rem 0.5rem;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
    min-width: 0;
    max-width: min(960px, 96%);
    box-sizing: border-box;
    width: fit-content;
  }

  .bids-so-far {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.35rem 1rem;
    padding: 0.35rem 0.5rem;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 8px;
    font-size: clamp(0.75rem, 2vw, 0.95rem);
    color: #34495e;
  }
  .bids-so-far-label {
    font-weight: 700;
    margin-right: 0.25rem;
  }
  .bids-so-far-item {
    white-space: nowrap;
  }
  .bids-so-far-item.you {
    font-weight: 700;
  }

  .bidding-player-row {
    display: flex;
    flex-direction: row;
    align-items: flex-end;
    justify-content: center;
    gap: clamp(0.5rem, 2vw, 1.2rem);
    min-width: 0;
    min-height: 0;
    width: 100%;
    padding: 0 0.25rem clamp(0.5rem, 3vh, 1.25rem);
    box-sizing: border-box;
  }
  .bidding-hand-stage {
    position: relative;
    border-radius: 14px;
    padding: 0.45rem 0.65rem 0.35rem;
    background:
      radial-gradient(90% 95% at 50% 75%, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03) 72%),
      linear-gradient(180deg, rgba(8, 42, 26, 0.28), rgba(6, 28, 18, 0.18));
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 6px 16px rgba(0, 0, 0, 0.2);
  }

  .bidding-top-meta {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 0.25rem;
    margin-bottom: clamp(0.25rem, 1.2vh, 0.5rem);
  }
  .bidding-top-meta .local-avatar {
    width: clamp(44px, 9vw, 70px);
    height: clamp(44px, 9vw, 70px);
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    margin: 0;
    background: transparent;
    object-fit: contain;
  }
  .bidding-top-meta .local-name {
    margin: 0;
    color: #fff;
    font-weight: 700;
    font-size: clamp(0.85rem, 2vh, 1.05rem);
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
    white-space: nowrap;
  }

  /* Hand + fanned cards (scoped to this component) */
  .hand {
    display: flex;
    gap: 0.5rem;
    margin: 0;
    justify-content: center;
    position: relative;
  }
  .hand-fanned {
    display: block;
    position: relative;
    flex: 0 1 auto;
    min-width: clamp(190px, 50vw, 360px);
    max-width: 70vw;
    height: 100%;
    max-height: 100%;
    width: fit-content;
    pointer-events: auto;
  }
  .local-hand {
    --hand-half: clamp(20px, 4vw, 32px);
    --hand-spread: clamp(16px, 3vw, 26px);
    --hand-rotate: 9deg;
    --hand-base-y: -4px;
  }
  .fanned-card {
    position: absolute;
    background: #ffffff;
    border-radius: clamp(6px, 1.5vw, 8px);
    transition: transform 0.2s, box-shadow 0.2s;
    pointer-events: auto;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    overflow: visible;
    touch-action: manipulation;
  }
  .fanned-card:hover {
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18), 0 0 0 2px rgba(255, 255, 255, 0.65);
    filter: brightness(1.04) saturate(1.08);
  }

  @media (max-width: 768px) {
    .bidding-layout {
      padding: clamp(0.6rem, 2vh, 1rem) 0.5rem clamp(0.4rem, 2vh, 0.8rem);
      gap: 0.5rem;
    }
    .bid-center {
      padding: 0.45rem 0.55rem;
    }
    .bids-so-far {
      padding: 0.25rem 0.4rem;
      font-size: 0.72rem;
      gap: 0.25rem 0.55rem;
    }
    .bidding-player-row {
      padding: 0 0.25rem clamp(0.4rem, 2.5vh, 1rem);
      gap: 0.5rem;
    }
    .hand-fanned {
      min-width: clamp(170px, 52vw, 260px);
      max-width: 62vw;
    }
    .local-hand {
      --hand-half: 20px;
      --hand-spread: 16px;
      --hand-rotate: 8deg;
      --hand-base-y: -2px;
    }
    .bidding-top-meta .local-avatar {
      width: 44px;
      height: 44px;
    }
    .bidding-top-meta .local-name {
      font-size: 0.8rem;
    }
  }

  @media (max-width: 430px) {
    .hand-fanned {
      min-width: 54vw;
      max-width: 58vw;
    }
    .local-hand {
      --hand-half: 16px;
      --hand-spread: 13px;
      --hand-rotate: 7deg;
      --hand-base-y: -1px;
    }
    .bidding-top-meta .local-avatar {
      width: 40px;
      height: 40px;
    }
  }

  @media (orientation: landscape) and (max-height: 500px) {
    .bidding-layout {
      padding: clamp(0.4rem, 1.5vh, 0.7rem) 0.5rem clamp(0.3rem, 1.5vh, 0.6rem);
      gap: 0.4rem;
    }
    .bid-center {
      padding: 0.3rem 0.55rem;
    }
    .bids-so-far {
      padding: 0.2rem 0.4rem;
      font-size: 0.72rem;
      margin-bottom: 0;
    }
    .bidding-player-row {
      padding: 0 0.3rem 0.35rem;
      gap: 0.8rem;
    }
    .hand-fanned {
      min-width: clamp(200px, 48vw, 320px);
      max-width: 60vw;
    }
    .local-hand {
      --hand-half: 18px;
      --hand-spread: 14px;
      --hand-rotate: 7deg;
      --hand-base-y: -2px;
    }
  }
</style>
