<script lang="ts">
  import { gameState, roomId, localPlayer, localPlayerIndex } from '../store';
  import type {  OwnedCard } from '../../shared/types';
  import { socket } from '../socket';
  import { fly } from 'svelte/transition';

  export let ownedCard: OwnedCard;

  const card = ownedCard.card;

  let isPlayable = false;
  let isTurn = false;

  $: if ($gameState && $localPlayer !== undefined) {
    const state = $gameState;
    if (!state) {
      isPlayable = false;
      isTurn = false;
    } else {
      isTurn = state.currentPlayer === $localPlayerIndex && state.state === 'tricks';

      if (!isTurn) {
        isPlayable = false;
      } else if (!state.currentTrick.length) {
        isPlayable = true;
      } else {
        const localHand = $localPlayer.hand;
        const suitLed = state.currentTrick[0].card.suit;
        const hasSuit = localHand.some(c => c.card.suit === suitLed);
        isPlayable = hasSuit ? card.suit === suitLed : true;
      }
    }
  } else {
    isPlayable = false;
    isTurn = false;
  }

  function playCard() {
    if (!isPlayable || !isTurn) return;
    socket.emit('playCard', {
      roomId: $roomId,
      card: ownedCard
    });
  }

  function getCardFilename(card: { value: string; suit: string }) {
    // Capitalize first letter of value (A, K, Q, J, 10, 9, ...)
    let value = card.value;
    if (value.length === 1) value = value.toUpperCase();
    else if (["jack","queen","king","ace"].includes(value.toLowerCase())) value = value[0].toUpperCase();
    else if (["j","q","k","a"].includes(value.toLowerCase())) value = value.toUpperCase();
    // For 10, leave as 10
    // Capitalize suit
    // let suit = card.suit.charAt(0).toUpperCase() + card.suit.slice(1).toLowerCase();
    return `${value}_of_${card.suit.toLowerCase()}.svg`;
  }
</script>

<div
  class="card {isPlayable ? 'playable' : 'unplayable'} {$gameState?.state === 'bidding' ? 'viewing' : ''}"
  role="button"
  tabindex={isPlayable ? 0 : -1}
  aria-disabled={!isPlayable}
  on:click={playCard}
  on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && playCard()}
  transition:fly={{ y: -50, duration: 400 }}
>
  <img
    src={`/cards/${getCardFilename(card)}`}
    alt={`${card.value} of ${card.suit}`}
    style="background: #fff; border-radius: 6px;"
  />
</div>

<style>
  .card {
    width: clamp(60px, 12vw, 80px);
    height: clamp(90px, 18vw, 120px);
    cursor: pointer;
    user-select: none;
    transition: transform 0.2s;
    background: #fff;
    border-radius: clamp(4px, 1vw, 6px);
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
    position: relative;
    z-index: 1;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .card img {
    width: 100%;
    height: 100%;
    border-radius: clamp(4px, 1vw, 6px);
    box-shadow: none;
    background: #fff;
    display: block;
  }
  .card.playable:hover {
    transform: translateY(-10px) scale(1.05);
    box-shadow: 0 6px 15px rgba(0,0,0,0.4);
  }
  @media (hover: none) {
    .card.playable:active {
      transform: translateY(-5px) scale(1.02);
    }
  }
  .card.unplayable {
    cursor: not-allowed;
    opacity: 0.6;
  }
  /* During bidding, show cards at full opacity so player can see their hand clearly */
  .card.viewing {
    opacity: 1;
  }
</style>
