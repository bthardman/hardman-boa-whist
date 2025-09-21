<script lang="ts">
  import { gameState, isLocalPlayer, localPlayer, localPlayerId } from '../store';
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

    return $gameState?.players.find((p, index) => index === $gameState?.players.findIndex(player => player.playerId === winningCard.playerId)) || null;
  }

  function cardValue(v: string): number {
    const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    return order.indexOf(v);
  }

  // Helper to sort hand by alternating red/black suits, then by value (low to high)
  function getSortedHand(hand: OwnedCard[]): OwnedCard[] {
    if (!hand) return [];
    // Define suit color and alternating order: red/black/red/black
    const suitOrder = ['hearts', 'clubs', 'diamonds', 'spades'];
    const valueOrder = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    return [...hand].sort((a, b) => {
      const suitDiff = suitOrder.indexOf(a.card.suit) - suitOrder.indexOf(b.card.suit);
      if (suitDiff !== 0) return suitDiff;
      return valueOrder.indexOf(a.card.value) - valueOrder.indexOf(b.card.value); // low to high
    });
  }
</script>

{#if $gameState}
  <div class="gameboard">
    <!-- Other players fanned around top/sides -->
    <div class="opponents">
      {#each $gameState?.players.filter(p => !isLocalPlayer(p)) as player, idx (player.playerId)}
        <div class="opponent-seat seat-{idx} players-{($gameState?.players.length || 0) - 1}">
          <img src={getPlayerAvatarUrl(player)} alt="Avatar" class="opponent-avatar" />
          <div class="opponent-name">{player.selectedAvatar ? getAvatarData(player.selectedAvatar).name : 'Player'}</div>
          <div class="opponent-hand hand-fanned">
            {#if player.hand && player.hand.length}
              {#each player.hand as _, idx}
                <div
                  class="fanned-card card-back"
                  style="
                    left: calc(50% - 40px + {(idx - (player.hand.length - 1) / 2) * 36}px);
                    z-index: {idx};
                    transform: rotate({(idx - (player.hand.length - 1) / 2) *  -18}deg) translateY(-10px);
                  "
                ></div>
              {/each}
            {/if}
          </div>
          <div class="trick-pile">
            {#each Array(player.tricksWon) as _, tIdx}
              <div class="pile-card" style="--offset:{tIdx}"></div>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <!-- Trick area (center of table) -->
    <div class="table">
      {#if $gameState}
        {#each $gameState.currentTrick as ownedCard (ownedCard.card.id)}
          <div class="played-card" transition:fly={{ y: -50, duration: 400 }}>
            <Card {ownedCard} />
          </div>
        {/each}
      {/if}
      <!-- Bidding UI: only show for local player and only on their turn -->
      {#if $gameState?.state === 'bidding' && $gameState?.currentPlayer !== undefined}
        {#if isLocalPlayer($gameState.players[$gameState.currentPlayer])}
          <div class="bid-center">
            <BidSelector
              playerName={getAvatarData($gameState.players[$gameState.currentPlayer].selectedAvatar).name}
              on:bid={(e) =>
                socket.emit('submit_bid', {
                  roomId: $gameState.roomId,
                  playerIndex: $gameState.currentPlayer,
                  bid: e.detail.bid
                })}
            />
          </div>
        {:else}
          <div class="bid-wait-message">
            {getAvatarData($gameState.players[$gameState.currentPlayer].selectedAvatar).name} is selecting their bid...
          </div>
        {/if}
      {/if}

      <!-- Trick winner announcement -->
      {#if showWinner && winnerMessage}
        <div class="winner-banner">{winnerMessage}</div>
      {/if}
    </div>

    <!-- Local player panel at bottom -->
    {#if $localPlayer}
      <div class="local-player-panel">
        <img src={getPlayerAvatarUrl($localPlayer)} alt="Your Avatar" class="local-avatar" />
        <div class="local-name">{getAvatarData($localPlayer.selectedAvatar).name}</div>
        <div class="hand hand-fanned">
          {#each getSortedHand($localPlayer.hand) as ownedCard, idx (ownedCard.card.id)}
            <div
              class="fanned-card"
              style="
                left: calc(50% - 40px + {(idx - ($localPlayer.hand.length - 1) / 2) * 36}px);
                z-index: {idx};
                transform: rotate({(idx - ($localPlayer.hand.length - 1) / 2) * 18}deg) translateY(10px);
              "
            >
              <Card {ownedCard} />
            </div>
          {/each}
        </div>
        <div class="trick-pile">
          {#each Array($localPlayer.tricksWon) as _, idx}
            <div class="pile-card" style="--offset:{idx}"></div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

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
    width: 100vw;
    height: 100vh;
    background: url('/background/table_bg.svg') center/cover no-repeat;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: stretch;
    overflow: hidden;
  }

  .opponents {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 60vh;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    pointer-events: none;
    z-index: 2;
  }
  .opponent-seat {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0 2vw;
    pointer-events: auto;
    min-width: 120px;
    min-height: 120px;
    position: relative;
    top: 2vh;
  }
  /* Spread opponents evenly for 2-6 players */
  .players-1 { justify-content: center; }
  .players-2 .seat-0 { left: -20vw; } .players-2 .seat-1 { left: 20vw; }
  .players-3 .seat-0 { left: -25vw; } .players-3 .seat-1 { left: 0vw; } .players-3 .seat-2 { left: 25vw; }
  .players-4 .seat-0 { left: -30vw; } .players-4 .seat-1 { left: -10vw; } .players-4 .seat-2 { left: 10vw; } .players-4 .seat-3 { left: 30vw; }
  .players-5 .seat-0 { left: -32vw; } .players-5 .seat-1 { left: -16vw; } .players-5 .seat-2 { left: 0vw; } .players-5 .seat-3 { left: 16vw; } .players-5 .seat-4 { left: 32vw; }

  .opponent-avatar {
    width: 70px;
    height: 70px;
    border-radius: 50%;
    border: 3px solid #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    background: #f8f8f8;
    margin-bottom: 0.5rem;
  }
  .opponent-name {
    font-size: 1.1rem;
    font-weight: 600;
    color: #fff;
    text-shadow: 0 2px 8px rgba(0,0,0,0.25);
    margin-bottom: 0.2rem;
  }
  .local-player-panel {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: 100vw;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1.5rem 0 1.2rem 0;
    z-index: 10;
    background: none;
    box-shadow: none;
  }
  .local-avatar {
    width: 90px;
    height: 90px;
    border-radius: 50%;
    border: 3px solid #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.10);
    margin-bottom: 0.5rem;
    background: #f8f8f8;
  }
  .local-name {
    font-size: 1.3rem;
    font-weight: 700;
    color: #fff;
    margin-bottom: 0.7rem;
    text-shadow: 0 2px 8px rgba(0,0,0,0.18);
  }
  .hand {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    margin-bottom: 0.5rem;
    justify-content: center;
    width: 100%;
    position: relative;
  }
  .hand-fanned {
    display: block;
    position: relative;
    height: 130px;
    min-width: 320px;
    margin-left: auto;
    margin-right: auto;
    width: fit-content;
    pointer-events: auto;
  }
  .fanned-card {
    position: absolute;
    background: #ffffff;
    border-radius: 8px;
    transition: transform 0.2s, box-shadow 0.2s;
    pointer-events: auto;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    overflow: visible;
  }
  .fanned-card:hover {
    z-index: 100;
    box-shadow: 0 6px 18px rgba(0,0,0,0.18);
    transform: scale(1.08) translateY(-18px) !important;
  }
  .opponent-hand {
    position: relative;
    height: 80px;
    min-width: 320px;
    margin-bottom: 0.5rem;
    margin-top: 0.2rem;
    width: fit-content;
    display: block;
  }
  .hand-fanned {
    min-width: 320px;
    height: 140px;
    position: relative;
    margin-left: auto;
    margin-right: auto;
    width: fit-content;
    pointer-events: auto;
  }
  .trick-pile {
    position: relative;
    width: 40px;
    height: 60px;
    margin-top: 0.5rem;
    margin-left: 0.5rem;
    display: inline-block;
  }
  .pile-card {
    position: absolute;
    width: 40px;
    height: 60px;
    background: url('/cards/back.svg') center/cover no-repeat;
    transform: translateY(calc(var(--offset) * 2px));
  }
  .table {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 5;
    min-width: 320px;
    min-height: 180px;
    pointer-events: none;
  }

  .bid-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.98);
    border-radius: 16px;
    box-shadow: 0 2px 16px rgba(0,0,0,0.10);
    padding: 2rem 2.5rem 1.5rem 2.5rem;
    margin-top: 1.5rem;
    pointer-events: auto;
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
    z-index: 20;
  }

  .card-back {
    width: 80px;
    height: 120px;
    border-radius: 8px;
    background: #fff url('/cards/back.svg') center/cover no-repeat;
    border: 1.5px solid #d0d0d0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.10);
    position: absolute;
    left: 0;
    bottom: 0;
    margin: 0;
    opacity: 1;
    overflow: visible;
  }

  .bid-wait-message {
    margin-top: 2rem;
    font-size: 1.3rem;
    color: #fff;
    background: rgba(0,0,0,0.45);
    padding: 1rem 2rem;
    border-radius: 12px;
    text-align: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.10);
    z-index: 10;
  }
</style>
