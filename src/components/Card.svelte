<script lang="ts">
  import { gameState, roomId } from '../store';
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
    } else {
      isTurn = state.currentPlayer === ownedCard.player.name;

      if (!isTurn) {
        isPlayable = false;
      } else if (!state.currentTrick.length) {
        // first card of trick
        isPlayable = true;
      } else {
        // must follow suit if possible
        const suitLed = state.currentTrick[0].card.suit;
        const hasSuit = ownedCard.player.hand.some(c => c.card.suit === suitLed);
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
    src={`/cards/${card.value.toLowerCase()}_of_${card.suit.toLowerCase()}.svg`}
    alt={`${card.value} of ${card.suit}`}
  />
</div>

<style>
  .card {
    width: 80px;
    height: 120px;
    cursor: pointer;
    user-select: none;
    transition: transform 0.2s;
  }
  .card img {
    width: 100%;
    height: 100%;
    border-radius: 6px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
  }
  .card.playable:hover {
    transform: translateY(-10px) scale(1.05);
    box-shadow: 0 6px 15px rgba(0,0,0,0.4);
  }
  .card.unplayable {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
