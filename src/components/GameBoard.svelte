<script lang="ts">
  import { gameState } from '../store';
  import { onMount, onDestroy } from 'svelte';
  import type { Player, OwnedCard } from '../../shared/types';
  import Card from './Card.svelte';
  import BidSelector from './BidSelector.svelte';
  import { socket } from '../socket';
  import { fly } from 'svelte/transition';
  import { getAvatarData } from '../avatarData';
  import { getPlayerAvatarUrl } from '../avatarUtils';

  let winnerMessage: string | null = null;
  let showWinner = false;

  // Avatar swapping
  let swapInterval: any;
  onMount(() => {
    document.body.classList.add('game-bg');
    swapInterval = setInterval(() => {
      if ($gameState?.players) {
        $gameState.players.forEach((player: Player) => {
          const avatarData = getAvatarData(player.selectedAvatar);
          if (player.inGameAvatar) {
            player.inGameAvatar =
              player.inGameAvatar === avatarData.avatar1 ? avatarData.avatar2 : avatarData.avatar1;
          } else {
            player.inGameAvatar = avatarData.avatar1;
          }
        });
      }
    }, 1000);
    return () => document.body.classList.remove('game-bg');
  });

  onDestroy(() => {
    clearInterval(swapInterval);
    document.body.classList.remove('game-bg');
  });

  // Watch for trick resolution from server
  $: if ($gameState?.state === 'tricks' && $gameState.currentTrick.length === ($gameState.players?.length || 0)) {
    // All players have played -> announce trick winner
    const trickWinner = calculateTrickWinner($gameState.currentTrick, $gameState.players[$gameState.firstPlayer]);
    if (trickWinner) {
      winnerMessage = `Player ${$gameState?.players.findIndex(p => p === trickWinner) + 1} wins the trick!`;
      showWinner = true;

      // Delay 5s then clear trick + move cards to winner's stack
      setTimeout(() => {
        socket.emit('endTrick', {
          roomId: $gameState.roomId,
          winner: $gameState?.players.findIndex(p => p === trickWinner),
        });
        showWinner = false;
        winnerMessage = null;
      }, 5000);
    }
  }

  function calculateTrickWinner(trick: OwnedCard[], leadPlayer: Player): Player | null {
    if (!trick.length) return null;
    const suitLed = trick[0].card.suit;

    let winningCard = trick[0];
    trick.forEach((played) => {
      if (
        // Hearts are always trumps
        (played.card.suit === 'hearts' && winningCard.card.suit !== 'hearts') ||
        // Higher trump beats lower trump
        (played.card.suit === 'hearts' &&
          winningCard.card.suit === 'hearts' &&
          cardValue(played.card.value) > cardValue(winningCard.card.value)) ||
        // Higher of led suit (if no trump present)
        (played.card.suit === suitLed &&
          winningCard.card.suit === suitLed &&
          cardValue(played.card.value) > cardValue(winningCard.card.value))
      ) {
        winningCard = played;
      }
    });

    return $gameState?.players.find((p, index) => index === $gameState?.players.findIndex(player => player === winningCard.player)) || null;
  }

  function cardValue(v: string): number {
    const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    return order.indexOf(v);
  }

</script>

<div class="gameboard">
  {#each $gameState?.players || [] as player, i}
    <div class="player-seat seat-{i}">
      <img src={getPlayerAvatarUrl(player)} alt="Player Avatar" class="avatar" />
      <div class="player-name">Player {i + 1}</div>

      <!-- Trick pile (stack of won tricks) -->
      <div class="trick-pile">
        {#each Array(player.tricksWon) as _, idx}
          <div class="pile-card" style="--offset:{idx}"></div>
        {/each}
      </div>

      <!-- Player's hand -->
      <div class="hand">
        {#if player.isLocal}
          <!-- Show local player's cards face-up -->
          {#each player.hand as ownedCard}
            <Card {ownedCard} />
          {/each}
        {:else}
          <!-- Other players: show only backs -->
          {#each player.hand as _, idx}
            <img
              src="/cards/back.svg"
              alt="Card back"
              class="card-back"
              style="--offset:{idx}"
            />
          {/each}
        {/if}
      </div>

    </div>
  {/each}

  <!-- Bidding UI -->
  {#if $gameState?.state === 'bidding' && $gameState?.currentPlayer !== undefined}
    <BidSelector
      playerName={`Player ${$gameState.currentPlayer + 1}`}
      on:bid={(e) =>
        socket.emit('submit_bid', {
          roomId: $gameState.roomId,
          playerIndex: $gameState.currentPlayer,
          bid: e.detail.bid
        })}
    />
  {/if}

  <!-- Trick area (center of table) -->
  <div class="table">
    {#if $gameState}
      {#each $gameState.currentTrick as ownedCard (ownedCard.card.id)}
        <div class="played-card" transition:fly={{ y: -50, duration: 400 }}>
          <Card {ownedCard} />
        </div>
      {/each}
    {/if}
  </div>

  <!-- Trick winner announcement -->
  {#if showWinner && winnerMessage}
    <div class="winner-banner">{winnerMessage}</div>
  {/if}
</div>

<style>
  :global(body.game-bg) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    min-height: 100vh;
    width: 100vw;
    background: #0E7A3A !important;
    transition: background 0.3s;
  }

  .gameboard {
    position: relative;
    width: 100%;
    height: 100%;
    background: url('/background/table_bg.svg') center/cover no-repeat;
    display: grid;
    grid-template-areas:
      "seat0 seat1 seat2"
      "seat5 table seat3"
      "seat4 seatX seatX";
    gap: 1rem;
    padding: 2rem;
  }
  .player-seat {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .avatar {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    border: 2px solid #fff;
  }
  .player-name {
    font-size: 0.9rem;
    margin-top: 0.2rem;
  }
  .hand {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.5rem;
  }
  .trick-pile {
    position: relative;
    width: 40px;
    height: 60px;
    margin-top: 0.5rem;
  }
  .pile-card {
    position: absolute;
    width: 40px;
    height: 60px;
    background: url('/cards/back.svg') center/cover no-repeat;
    transform: translateY(calc(var(--offset) * 2px));
  }
  .table {
    grid-area: table;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 1rem;
    margin: auto;
  }
  .played-card {
    width: 80px;
    height: 120px;
  }
  .winner-banner {
    position: absolute;
    top: 40%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(255,255,255,0.9);
    padding: 1rem 2rem;
    border-radius: 12px;
    font-size: 1.5rem;
    font-weight: bold;
    box-shadow: 0 2px 10px rgba(0,0,0,0.4);
  }

  .card-back {
    width: 80px;
    height: 120px;
    border-radius: 6px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
    margin-left: -50px; /* overlap slightly for fanned look */
    background: url('/cards/back.svg') center/cover no-repeat;
  }
  .hand {
    display: flex;
    margin-top: 0.5rem;
    position: relative;
  }
</style>
