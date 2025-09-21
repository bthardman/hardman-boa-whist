<script lang="ts">
  import { gameState, roomId, localPlayer, localPlayerIndex } from '../store';
  import type {  OwnedCard } from '../../shared/types';
  import { socket } from '../socket';
  import { fly } from 'svelte/transition';
  import { get } from 'svelte/store';

  export let ownedCard: OwnedCard;

  const card = ownedCard.card;

  let isPlayable = false;
  let isTurn = false;

  $: {
    const state = get(gameState);
    if (!state) {
      isPlayable = false;
      isTurn = false;
    } else if ($localPlayer) {
      // Only allow playing cards during 'tricks' phase and if it's the local player's turn
      isTurn = state.currentPlayer === $localPlayerIndex && state.state === 'tricks';

      if (!isTurn) {
        isPlayable = false;
      } else if (!state.currentTrick.length) {
        // first card of trick
        isPlayable = true;
      } else {
        // must follow suit if possible
        // Find the local player's hand
        const localHand = $localPlayer.hand;
        const suitLed = state.currentTrick[0].card.suit;
        const hasSuit = localHand.some(c => c.card.suit === suitLed);
        isPlayable = hasSuit ? card.suit === suitLed : true;
      }
    }
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
  class="card {isPlayable ? 'playable' : 'unplayable'}"
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
    width: 80px;
    height: 120px;
    cursor: pointer;
    user-select: none;
    transition: transform 0.2s;
    background: #fff;
    border-radius: 6px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
    position: relative;
    z-index: 1;
  }
  .card img {
    width: 100%;
    height: 100%;
    border-radius: 6px;
    box-shadow: none;
    background: #fff;
    display: block;
  }
  .card.playable:hover {
    transform: translateY(-10px) scale(1.05);
    box-shadow: 0 6px 15px rgba(0,0,0,0.4);
  }
  .card.unplayable {
    cursor: not-allowed;
  }
</style>
