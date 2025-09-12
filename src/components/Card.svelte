<script lang="ts">
  import { gameState, roomId, type OwnedCard } from '../store';
  import { socket } from '../socket';
  import { fly } from 'svelte/transition';
  import { get } from 'svelte/store';

  export let ownedCard: OwnedCard;

  const card = ownedCard.card;

  let isPlayable = false;

  $: {
    const trick = get(gameState);
    if (!trick?.currentTrick.length) {
      isPlayable = true;
    } else  {
      const suitPlayed = trick.currentTrick[0].card.suit;
      isPlayable = ownedCard.player.hand.some(c => c.card.suit === suitPlayed)
        ? card.suit === suitPlayed
        : true;
    }
  }

  function playCard() {
    if (!isPlayable) return;
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
  on:click={() => isPlayable && playCard()}
  on:keydown={(e) => isPlayable && (e.key === 'Enter' || e.key === ' ') && playCard()}
  transition:fly={{ y: -50, duration: 400 }}
>
  <img src={`/cards/${card.value.toLowerCase()}_of_${card.suit.toLowerCase()}.svg`} alt={card.value + ' of ' + card.suit} />
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
