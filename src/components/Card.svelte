<script lang="ts">
  import { players, currentTrick, type Card, type Player } from '../store';
  import { fly } from 'svelte/transition';
  import { get } from 'svelte/store';

  export let card: Card;
  export let player: Player;

  let isPlayable = false;

  $: {
    const trick = get(currentTrick);
    if (!trick.cards.length) {
      isPlayable = true;
    } else {
      const suitPlayed = trick.cards[0].suit;
      isPlayable = player.hand.some(c => c.suit === suitPlayed)
        ? card.suit === suitPlayed
        : true;
    }
  }

  function playCard() {
    if (!isPlayable) return;

    players.update(pls => {
      const p = pls.find(pl => pl.name === player.name);
      if (p)
      {
        p.hand = p.hand.filter(c => c.id !== card.id);
      }
      return pls;
    });

    currentTrick.update(trick => {
      trick.cards.push({ ...card, player: player.name });
      return trick;
    });
  }
</script>

<div
  class="card {isPlayable ? 'playable' : 'unplayable'}"
  on:click={playCard}
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
