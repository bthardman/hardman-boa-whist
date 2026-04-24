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
          <img src={getPlayerAvatarUrl(p)} alt="" class="bids-avatar" />
          {getAvatarData(p.selectedAvatar).name}{#if localPlayer && p.playerId === localPlayer.playerId}<span class="you-tag">&nbsp;(you)</span>{/if}:
          {typeof p.bid === 'number' ? p.bid : '—'}
        </span>
      {/each}
    </div>
    <BidSelector forbidden={forbiddenBid} on:bid={onBid} />
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
    grid-template-rows: minmax(0, 0.6fr) auto minmax(0, 1.4fr);
    gap: clamp(0.6rem, 2vh, 1.2rem);
    padding: clamp(0.75rem, 2vh, 1.1rem) 0.75rem clamp(0.5rem, 2vh, 1rem);
    box-sizing: border-box;
    min-height: 0;
    width: 100%;
    justify-items: center;
    overflow: hidden;
  }

  .bid-center {
    grid-row: 2;
    z-index: 2;
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
    gap: 0.45rem 1rem;
    padding: 0.5rem 0.65rem;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 8px;
    font-size: clamp(0.82rem, 2vw, 1rem);
    color: #34495e;
  }
  .bids-so-far-label {
    font-weight: 700;
    margin-right: 0.25rem;
  }
  .bids-so-far-item {
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.75);
    border: 1px solid rgba(52, 73, 94, 0.14);
  }
  .bids-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: contain;
    border: 1px solid rgba(52, 73, 94, 0.25);
    background: transparent;
    flex: 0 0 auto;
  }
  .bids-so-far-item.you .bids-avatar {
    box-shadow: 0 0 0 2px rgba(90, 185, 242, 0.45);
  }
  .bids-so-far-item.you {
    font-weight: 700;
  }

  .bidding-player-row {
    grid-row: 3;
    align-self: end;
    position: relative;
    display: flex;
    flex-direction: row;
    align-items: flex-end;
    justify-content: center;
    gap: clamp(0.4rem, 1.2vw, 0.8rem);
    min-width: 0;
    min-height: 0;
    width: 100%;
    padding: 0.25rem 0.6rem max(1rem, 3vh);
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
    position: absolute;
    right: clamp(0.5rem, 2vw, 1rem);
    bottom: clamp(0.2rem, 1vh, 0.55rem);
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 0.25rem;
    min-width: clamp(74px, 14vw, 130px);
    margin-bottom: clamp(0.2rem, 1vh, 0.45rem);
  }
  .bidding-top-meta .local-avatar {
    width: clamp(56px, 11vw, 84px);
    height: clamp(56px, 11vw, 84px);
    border-radius: 50%;
    border: clamp(2px, 0.5vw, 3px) solid #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    margin-bottom: clamp(0.25rem, 1vh, 0.5rem);
    background: transparent;
    object-fit: contain;
  }
  .bidding-top-meta .local-name {
    margin-bottom: clamp(0.25rem, 1vh, 0.5rem);
    color: #fff;
    font-weight: 700;
    font-size: clamp(0.9rem, 2.6vw, 1.2rem);
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    text-align: center;
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
    flex: 0 0 auto;
    min-width: clamp(220px, 58vw, 320px);
    max-width: 100%;
    height: clamp(96px, 20vh, 130px);
    width: fit-content;
    margin: 0 auto;
    pointer-events: auto;
  }
  .local-hand {
    --hand-half: clamp(24px, 5vw, 36px);
    --hand-spread: clamp(22px, 4vw, 32px);
    --hand-rotate: 14deg;
    --hand-base-y: -8px;
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
      grid-template-rows: minmax(0, 0.6fr) auto minmax(0, 1.4fr);
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
      padding: 0.25rem 0.4rem max(0.7rem, 2vh);
      gap: 0.35rem;
    }
    .bidding-top-meta {
      right: clamp(0.25rem, 1.5vw, 0.6rem);
      bottom: clamp(0.1rem, 0.9vh, 0.3rem);
    }
    .hand-fanned {
      min-width: clamp(170px, 60vw, 240px);
      height: clamp(84px, 16vh, 110px);
    }
    .local-hand {
      --hand-half: 22px;
      --hand-spread: 19px;
      --hand-rotate: 12deg;
      --hand-base-y: -4px;
    }
    .bidding-top-meta .local-avatar {
      width: clamp(46px, 10vw, 66px);
      height: clamp(46px, 10vw, 66px);
    }
    .bidding-top-meta .local-name {
      font-size: 0.88rem;
    }
  }

  @media (max-width: 430px) {
    .hand-fanned {
      min-width: clamp(150px, 70vw, 210px);
      height: clamp(78px, 14vh, 98px);
    }
    .local-hand {
      --hand-half: 19px;
      --hand-spread: 16px;
      --hand-rotate: 10deg;
      --hand-base-y: -3px;
    }
    .bidding-top-meta .local-avatar {
      width: 42px;
      height: 42px;
    }
    .bidding-top-meta {
      right: 0.2rem;
      bottom: 0.05rem;
      min-width: clamp(54px, 18vw, 78px);
    }
    .bidding-top-meta .local-name {
      font-size: 0.8rem;
      margin-bottom: 0.15rem;
    }
  }

  @media (orientation: landscape) and (max-height: 500px) {
    .bidding-layout {
      grid-template-rows: minmax(0, 0.55fr) auto minmax(0, 1.45fr);
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
      padding: 0.15rem 0.35rem 0.5rem;
      gap: 0.45rem;
    }
    .bidding-top-meta {
      right: 0.35rem;
      bottom: 0.05rem;
    }
    .hand-fanned {
      min-width: clamp(170px, 56vw, 240px);
      height: clamp(74px, 22vh, 96px);
    }
    .local-hand {
      --hand-half: 20px;
      --hand-spread: 16px;
      --hand-rotate: 10deg;
      --hand-base-y: -3px;
    }
  }
</style>
