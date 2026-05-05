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
  $: bidColumns = biddingSequence.length <= 1 ? 1 : biddingSequence.length <= 6 ? 2 : 3;
  $: bidMarkers = (() => {
    const markers: Record<number, { avatarUrl: string; label: string }[]> = {};
    for (const p of biddingSequence) {
      if (!localPlayer || p.playerId === localPlayer.playerId) continue;
      if (typeof p.bid !== 'number') continue;
      if (!markers[p.bid]) markers[p.bid] = [];
      markers[p.bid].push({
        avatarUrl: getPlayerAvatarUrl(p),
        label: getAvatarData(p.selectedAvatar).name
      });
    }
    return markers;
  })();
  $: currentTotalBids = biddingSequence.reduce((sum, p) => sum + (typeof p.bid === 'number' ? p.bid : 0), 0);

  function onBid(e: CustomEvent<{ bid: number }>) {
    dispatch('bid', { bid: e.detail.bid });
  }
</script>

<section class="bidding-layout" role="dialog" aria-label="Place your bid">
  <div class="bid-center">
    <div class="bids-so-far">
      <span class="bids-so-far-label">Bids so far:</span>
      <div class="bids-so-far-grid columns-{bidColumns}">
        {#each biddingSequence as p (p.playerId)}
          <div
            class="bids-so-far-item"
            class:you={localPlayer && p.playerId === localPlayer.playerId}
          >
            <img src={getPlayerAvatarUrl(p)} alt="" class="bids-avatar" />
            <div class="bid-player-content">
              <div class="bid-player-name">
                {getAvatarData(p.selectedAvatar).name}
                {#if localPlayer && p.playerId === localPlayer.playerId}
                  <span class="you-tag">(you)</span>
                {/if}
              </div>
              <div class="bid-player-value">
                Bid: <strong>{typeof p.bid === 'number' ? p.bid : '—'}</strong>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
    <div class="total-bids-line">
      Current total bids: <strong>{currentTotalBids}</strong>
    </div>
    <BidSelector forbidden={forbiddenBid} {bidMarkers} on:bid={onBid} />
  </div>

  <div class="bidding-player-row">
    <div class="bidding-top-meta active-turn">
      <img src={getPlayerAvatarUrl(currentPlayer)} alt="Avatar" class="local-avatar" />
      <div class="local-name">{getAvatarData(currentPlayer.selectedAvatar).name}</div>
    </div>
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
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 0.45rem;
    padding: 0.6rem 0.8rem;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 8px;
    font-size: clamp(0.95rem, 2.4vw, 1.12rem);
    color: #34495e;
  }
  .bids-so-far-label {
    font-weight: 700;
    margin-right: 0;
    text-align: center;
  }
  .bids-so-far-grid {
    display: grid;
    gap: 0.4rem;
  }
  .bids-so-far-grid.columns-1 {
    grid-template-columns: 1fr;
  }
  .bids-so-far-grid.columns-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .bids-so-far-grid.columns-3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .bids-so-far-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    padding: 0.3rem 0.5rem;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.75);
    border: 1px solid rgba(52, 73, 94, 0.14);
    font-weight: 600;
  }
  .bid-player-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.05;
  }
  .bid-player-name {
    color: #193857;
    font-size: clamp(0.76rem, 1.8vw, 0.9rem);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bid-player-value {
    font-size: clamp(0.72rem, 1.7vw, 0.84rem);
    color: #3f5367;
  }
  .you-tag {
    margin-left: 0.25rem;
    font-size: 0.78em;
    font-weight: 700;
    color: #1f6aa8;
  }
  .bids-avatar {
    width: 20px;
    height: 20px;
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
  .total-bids-line {
    align-self: center;
    font-size: clamp(0.9rem, 2.2vw, 1.02rem);
    font-weight: 650;
    color: #24374a;
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(44, 62, 80, 0.16);
    border-radius: 999px;
    padding: 0.26rem 0.7rem;
    margin-top: -0.05rem;
  }

  .bidding-player-row {
    grid-row: 3;
    align-self: end;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: clamp(0.22rem, 0.8vh, 0.52rem);
    min-width: 0;
    min-height: 0;
    width: 100%;
    max-width: 100vw;
    padding: 0.2rem 0.2rem max(1rem, 3vh);
    box-sizing: border-box;
  }
  .bidding-hand-stage {
    position: relative;
    width: min(100%, clamp(300px, 78vw, 760px));
    align-self: center;
    margin-right: 0px;
    border-radius: 14px;
    padding: clamp(0.42rem, 1.2vh, 0.6rem) 0.1rem clamp(0.28rem, 0.9vh, 0.45rem);
    background:
      radial-gradient(90% 95% at 50% 75%, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03) 72%),
      linear-gradient(180deg, rgba(8, 42, 26, 0.28), rgba(6, 28, 18, 0.18));
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 6px 16px rgba(0, 0, 0, 0.2);
  }

  .bidding-top-meta {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    align-self: center;
    gap: clamp(0.35rem, 1vw, 0.6rem);
    min-width: 0;
    margin-bottom: clamp(0.3rem, 0.95vh, 0.55rem);
  }
  .bidding-top-meta .local-avatar {
    width: clamp(46px, 9vw, 66px);
    height: clamp(46px, 9vw, 66px);
    border-radius: 50%;
    border: clamp(2px, 0.5vw, 3px) solid #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    margin-bottom: 0;
    background: transparent;
    object-fit: contain;
  }
  .bidding-top-meta .local-name {
    margin-bottom: 0;
    color: #fff;
    font-weight: 700;
    font-size: clamp(0.84rem, 2.1vw, 1rem);
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    text-align: center;
    white-space: nowrap;
  }
  .bidding-top-meta.active-turn .local-avatar {
    border-color: #ffd84f;
    box-shadow:
      0 0 0 3px rgba(255, 216, 79, 0.38),
      0 0 14px rgba(255, 216, 79, 0.55),
      0 2px 10px rgba(0, 0, 0, 0.3);
    animation: turnPulseRing 1.15s ease-in-out infinite;
  }
  .bidding-top-meta.active-turn .local-name {
    color: #ffe889;
    text-shadow: 0 0 10px rgba(255, 216, 79, 0.5), 0 2px 6px rgba(0, 0, 0, 0.45);
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
    min-width: clamp(220px, 58vw, 360px);
    max-width: 100%;
    height: clamp(96px, 17vw, 150px);
    width: 100%;
    margin: 0 auto;
    pointer-events: auto;
  }
  .local-hand {
    --hand-half: clamp(30px, 6vw, 46px);
    --hand-spread: clamp(34px, 5.4vw, 46px);
    --hand-rotate: 11deg;
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
  .bidding-player-row :global(.card) {
    width: clamp(56px, 11.8vw, 76px);
    height: clamp(84px, 17.8vw, 114px);
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
      padding: 0.32rem 0.5rem;
      font-size: 0.82rem;
      gap: 0.25rem 0.55rem;
    }
    .bids-so-far-grid.columns-2 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .bids-so-far-grid.columns-3 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .bidding-player-row {
      padding: 0.2rem 0.2rem max(0.7rem, 2vh);
      justify-content: center;
    }
    .bidding-top-meta {
      align-self: center;
      gap: 0.35rem;
      margin-bottom: 0.45rem;
    }
    .hand-fanned {
      min-width: 0;
      max-width: 100%;
      height: clamp(92px, 18vw, 138px);
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
    .bidding-player-row { padding: 0.2rem 0.2rem max(0.5rem, 1.5vh); }
    .bids-so-far-grid.columns-2,
    .bids-so-far-grid.columns-3 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .bidding-top-meta {
      min-width: 0;
      margin-bottom: 0.4rem;
    }
    .hand-fanned {
      min-width: 0;
      max-width: 100%;
      height: clamp(88px, 20vw, 132px);
    }
    .bidding-hand-stage {
      width: 100%;
      margin-right: 0;
      padding-right: 0.0rem;
    }
    .bidding-top-meta .local-avatar {
      width: 42px;
      height: 42px;
    }
    .bidding-top-meta {
      min-width: 0;
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
      font-size: 0.78rem;
      margin-bottom: 0;
    }
    .bidding-player-row {
      padding: 0.2rem 0.2rem 0.5rem;
      gap: 0.45rem;
    }
    .bidding-top-meta {
      right: 0.35rem;
      bottom: 0.05rem;
    }
    .hand-fanned {
      min-width: clamp(170px, 56vw, 240px);
      height: clamp(80px, 16vw, 118px);
    }
  }
  @keyframes turnPulseRing {
    0%,
    100% {
      transform: scale(1);
      filter: brightness(1);
    }
    50% {
      transform: scale(1.045);
      filter: brightness(1.08);
    }
  }

  .bid-center {
    background:
      radial-gradient(130% 110% at 12% -20%, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0) 58%),
      linear-gradient(160deg, rgba(248, 251, 255, 0.94), rgba(229, 238, 248, 0.9));
    border: 1px solid rgba(136, 164, 201, 0.42);
    border-radius: 16px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.92),
      0 14px 34px rgba(11, 35, 66, 0.24);
    backdrop-filter: blur(10px);
  }

  .bids-so-far {
    background: rgba(255, 255, 255, 0.58);
    border: 1px solid rgba(136, 164, 201, 0.34);
    border-radius: 12px;
  }

  .bids-so-far-item {
    background: rgba(255, 255, 255, 0.82);
    border-color: rgba(112, 142, 182, 0.35);
    color: #1f3a59;
  }

  .bids-so-far-item.you {
    background: linear-gradient(145deg, rgba(228, 246, 255, 0.96), rgba(205, 236, 253, 0.96));
    border-color: rgba(66, 153, 225, 0.45);
  }

  .total-bids-line {
    background: linear-gradient(170deg, rgba(255, 255, 255, 0.94), rgba(235, 242, 250, 0.92));
    border-color: rgba(123, 153, 193, 0.4);
    color: #163a61;
    box-shadow: 0 6px 16px rgba(24, 58, 97, 0.12);
  }

  .bidding-hand-stage {
    background:
      radial-gradient(90% 90% at 50% 78%, rgba(135, 207, 171, 0.22), rgba(255, 255, 255, 0.06) 70%),
      linear-gradient(180deg, rgba(11, 44, 30, 0.32), rgba(7, 28, 18, 0.26));
    border: 1px solid rgba(185, 236, 210, 0.35);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      0 10px 24px rgba(0, 0, 0, 0.24);
  }

  .bidding-top-meta .local-avatar {
    border-color: rgba(255, 255, 255, 0.95);
    box-shadow:
      0 10px 18px rgba(5, 22, 14, 0.34),
      0 0 0 1px rgba(255, 255, 255, 0.35);
  }

  .bidding-top-meta .local-name {
    letter-spacing: 0.01em;
  }
</style>
