<script lang="ts">
  import { gameState, roomId, localPlayer, localPlayerIndex } from '../store';
  import type { OwnedCard } from '../../shared/types';
  import { socket } from '../socket';
  import { SUIT_SYMBOL } from '../utils/gameUtils';

  export let ownedCard: OwnedCard;
  /** Only cards in your own hand are playable; cards on the table are display-only. */
  export let interactive = false;

  $: card = ownedCard.card;
  $: hidden = card.suit === 'hidden';

  let isTurn = false;
  let isPlayable = false;
  let mustFollowSuit = false;

  $: {
    const state = $gameState;
    const resolving = !!state && state.currentTrick.length === state.players.length;
    isTurn = interactive && !!state && state.state === 'tricks' && state.currentPlayer === $localPlayerIndex && !resolving;
    if (!isTurn || !state || !$localPlayer) {
      isPlayable = false;
      mustFollowSuit = false;
    } else if (!state.currentTrick.length) {
      isPlayable = true;
      mustFollowSuit = false;
    } else {
      const suitLed = state.currentTrick[0].card.suit;
      mustFollowSuit = $localPlayer.hand.some((c) => c.card.suit === suitLed);
      isPlayable = mustFollowSuit ? card.suit === suitLed : true;
    }
  }

  let sent = false;
  $: if (!isTurn) sent = false;

  function playCard() {
    if (!isPlayable || sent) return;
    sent = true; // guard against double taps while the server responds
    socket.emit('playCard', { roomId: $roomId, card: ownedCard });
  }

  $: src = hidden ? '/cards/back.svg' : `/cards/${card.value}_of_${card.suit}.svg`;
  $: label = hidden ? 'Face-down card' : `${card.value} of ${card.suit}`;
</script>

{#if interactive}
  <button
    type="button"
    class="card"
    class:playable={isPlayable}
    class:blocked={isTurn && !isPlayable}
    class:follow={mustFollowSuit && isPlayable}
    disabled={!isPlayable}
    aria-label={`${label}${isPlayable ? ', playable' : ''}`}
    data-no-button-sound="true"
    on:click={playCard}
  >
    <img {src} alt="" draggable="false" />
  </button>
{:else}
  <div class="card" class:back={hidden} role="img" aria-label={label} title={hidden ? undefined : `${card.value}${SUIT_SYMBOL[card.suit] ?? ''}`}>
    <img {src} alt="" draggable="false" />
  </div>
{/if}

<style>
  /* Sized to the artwork's own proportions (167 x 243) so nothing is cropped. */
  .card {
    display: block;
    width: var(--card-w, 84px);
    aspect-ratio: 167 / 243;
    padding: 0;
    border: 0;
    border-radius: calc(var(--card-w, 84px) * 0.06);
    background: white;
    box-shadow:
      0 0 0 1px rgba(14, 34, 53, 0.18),
      0 4px 10px rgba(3, 14, 24, 0.35);
    user-select: none;
    touch-action: manipulation;
    transition:
      transform 160ms var(--ease-out),
      box-shadow 160ms,
      filter 160ms;
  }
  .card img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }
  /* The back image has its own rounded corners and border. */
  .card.back {
    background: transparent;
    box-shadow: 0 4px 10px rgba(3, 14, 24, 0.35);
  }
  .card.back img {
    object-fit: fill;
  }
  button.card {
    cursor: default;
  }
  button.card:disabled {
    opacity: 1;
  }
  .playable {
    cursor: pointer;
  }
  .playable:hover,
  .playable:focus-visible {
    transform: translateY(-14px);
    box-shadow:
      0 0 0 3px var(--ice),
      0 14px 24px rgba(3, 14, 24, 0.45);
  }
  .follow {
    transform: translateY(-8px);
    box-shadow:
      0 0 0 2px var(--ice),
      0 10px 20px rgba(3, 14, 24, 0.4);
  }
  /* Your turn, but this card can't be played (you must follow suit). */
  .blocked {
    filter: brightness(0.62) saturate(0.6);
  }
</style>
