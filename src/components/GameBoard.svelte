<script lang="ts">
  import { gameState, isLocalPlayer, localPlayer, localPlayerId, roomId } from '../store';
  import { onMount, onDestroy } from 'svelte';
  import type { Player, OwnedCard } from '../../shared/types';
  import Card from './Card.svelte';
  import BidSelector from './BidSelector.svelte';
  import Scoreboard from './Scoreboard.svelte';
  import { socket } from '../socket';
  import { fly } from 'svelte/transition';
  import { getAvatarData } from '../avatarData';
  import { getPlayerAvatarUrl } from '../avatarUtils';
  import { startAvatarSwap, stopAvatarSwap, stopAllAvatarSwaps } from '../utils/avatarManager';
  import { calculateTrickWinner, cardValue } from '../utils/gameUtils';

  let winnerMessage: string | null = null;
  let showWinner = false;
  let previousTrickLength = 0;

  function startNextRound() {
    socket.emit('next_round', { roomId: $roomId });
  }

  // Calculate forbidden bid (bid that would make total = 7)
  function getForbiddenBid(): number | null {
    if (!$gameState) return null;
    
    const playersWhoBidded = $gameState.players.filter(p => typeof p.bid === 'number').length;
    const isLastBidder = playersWhoBidded === $gameState.players.length - 1;
    
    if (!isLastBidder) return null;
    
    const currentTotal = $gameState.players.reduce((sum, p) => {
      const bid = typeof p.bid === 'number' ? p.bid : 0;
      return sum + bid;
    }, 0);
    
    const forbiddenBid = 7 - currentTotal;
    return (forbiddenBid >= 0 && forbiddenBid <= 7) ? forbiddenBid : null;
  }

  // Get current winning card index in trick
  function getWinningCardIndex(): number {
    if (!$gameState || !$gameState.currentTrick.length) return -1;
    
    const trick = $gameState.currentTrick;
    const suitLed = trick[0].card.suit;
    let winningIndex = 0;
    let winningCard = trick[0];

    trick.forEach((played, index) => {
      if (
        // hearts trump anything not hearts
        (played.card.suit === 'hearts' && winningCard.card.suit !== 'hearts') ||
        // higher trump beats lower trump
        (played.card.suit === 'hearts' && winningCard.card.suit === 'hearts' &&
          cardValue(played.card.value) > cardValue(winningCard.card.value)) ||
        // higher card of led suit
        (played.card.suit === suitLed && winningCard.card.suit === suitLed &&
          cardValue(played.card.value) > cardValue(winningCard.card.value))
      ) {
        winningCard = played;
        winningIndex = index;
      }
    });

    return winningIndex;
  }

  // Get led suit
  function getLedSuit(): string | null {
    if (!$gameState || !$gameState.currentTrick.length) return null;
    return $gameState.currentTrick[0].card.suit;
  }

  onMount(() => {
    document.body.classList.add('game-bg');
    
    // Start avatar swapping for all players
    if ($gameState?.players) {
      $gameState.players.forEach((player: Player) => {
        startAvatarSwap(player);
      });
    }
    
    return () => {
      stopAllAvatarSwaps();
      document.body.classList.remove('game-bg');
    };
  });

  onDestroy(() => {
    stopAllAvatarSwaps();
    document.body.classList.remove('game-bg');
  });

  // Watch for trick completion - server handles winner calculation
  $: if ($gameState?.state === 'tricks') {
    const currentTrickLength = $gameState.currentTrick.length;
    const numPlayers = $gameState.players?.length || 0;
    
    // Trick just completed (was full, now empty or reset)
    if (previousTrickLength === numPlayers && currentTrickLength === 0 && numPlayers > 0) {
      // Server has already calculated winner and updated state
      // Find the player who won (they should have incremented tricksWon)
      // Show a brief message
      showWinner = true;
      winnerMessage = 'Trick completed!';
      
      setTimeout(() => {
        showWinner = false;
        winnerMessage = null;
      }, 2000);
    }
    
    previousTrickLength = currentTrickLength;
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
                    --card-offset: {(idx - (player.hand.length - 1) / 2)};
                    left: calc(50% - clamp(30px, 6vw, 40px) + var(--card-offset) * clamp(28px, 4.5vw, 36px));
                    z-index: {idx};
                    transform: rotate(calc(var(--card-offset) * -18deg)) translateY(-10px);
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
        {@const winningIndex = getWinningCardIndex()}
        {#each $gameState.currentTrick as ownedCard, index (ownedCard.card.id)}
          <div 
            class="played-card {index === winningIndex ? 'winning-card' : ''}" 
            transition:fly={{ y: -50, duration: 400 }}
          >
            <Card {ownedCard} />
            {#if index === winningIndex}
              <div class="winning-indicator">👑</div>
            {/if}
          </div>
        {/each}
      {/if}
      <!-- Bidding UI: only show for local player and only on their turn -->
      {#if $gameState?.state === 'bidding' && $gameState?.currentPlayer !== undefined}
        {#if isLocalPlayer($gameState.players[$gameState.currentPlayer])}
          <div class="bid-center">
            <div class="bid-player-info">
              <div class="bid-player-name">{getAvatarData($gameState.players[$gameState.currentPlayer].selectedAvatar).name}</div>
              <div class="bid-instruction">Select your bid for tricks:</div>
            </div>
            <BidSelector
              playerName=""
              forbidden={getForbiddenBid()}
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

      <!-- Led suit indicator -->
      {#if $gameState?.currentTrick.length > 0 && $gameState.state === 'tricks'}
        {@const ledSuit = getLedSuit()}
        {#if ledSuit}
          <div class="led-suit-indicator">
            Led suit: <span class="suit-name">{ledSuit}</span>
          </div>
        {/if}
      {/if}

      <!-- Trick winner announcement -->
      {#if showWinner && winnerMessage}
        <div class="winner-banner">{winnerMessage}</div>
      {/if}

      <!-- Round End Overlay -->
      {#if $gameState?.state === 'round_end'}
        <div class="round-end-overlay">
          <div class="round-end-content">
            <h2>Round {$gameState.roundNumber} Complete!</h2>
            <div class="round-results">
              {#each $gameState.players as player, index}
                {@const bid = player.bid ?? 0}
                {@const tricks = player.tricksWon}
                {@const score = bid === tricks ? 1 : 0}
                {@const isSuccess = bid === tricks}
                <div class="player-result" class:success={isSuccess} class:failure={!isSuccess}>
                  <span class="player-name">{getAvatarData(player.selectedAvatar).name}</span>
                  <span class="result-details">
                    Bid: {bid} | Tricks: {tricks} | Points: {score}
                    {#if isSuccess}
                      <span class="bonus">✓ Success!</span>
                    {:else}
                      <span class="failure-text">✗ Failed</span>
                    {/if}
                  </span>
                </div>
              {/each}
            </div>
            <Scoreboard />
            <button class="next-round-button" on:click={startNextRound}>
              {#if Object.values($gameState.scoreboard || {}).some(s => s >= 5)}
                View Final Scores
              {:else}
                Start Next Round
              {/if}
            </button>
          </div>
        </div>
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
                --card-offset: {(idx - ($localPlayer.hand.length - 1) / 2)};
                left: calc(50% - clamp(30px, 6vw, 40px) + var(--card-offset) * clamp(28px, 4.5vw, 36px));
                z-index: {idx};
                transform: rotate(calc(var(--card-offset) * 18deg)) translateY(10px);
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
    max-width: 100%;
    max-height: 100%;
    background: url('/background/table_bg.svg') center/cover no-repeat;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: stretch;
    overflow: hidden;
    touch-action: pan-y pinch-zoom;
  }

  .opponents {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: clamp(40vh, 50vh, 60vh);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: clamp(0.5rem, 2vw, 1rem);
    pointer-events: none;
    z-index: 2;
    padding: clamp(0.5rem, 2vh, 1rem);
  }
  .opponent-seat {
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: auto;
    min-width: clamp(80px, 15vw, 120px);
    max-width: clamp(100px, 20vw, 150px);
    position: relative;
    flex: 0 1 auto;
  }
  /* Spread opponents evenly for 2-6 players - responsive */
  .players-1 { justify-content: center; }
  .players-2 .seat-0 { order: 1; } .players-2 .seat-1 { order: 2; }
  .players-3 .seat-0 { order: 1; } .players-3 .seat-1 { order: 2; } .players-3 .seat-2 { order: 3; }
  .players-4 .seat-0 { order: 1; } .players-4 .seat-1 { order: 2; } .players-4 .seat-2 { order: 3; } .players-4 .seat-3 { order: 4; }
  .players-5 .seat-0 { order: 1; } .players-5 .seat-1 { order: 2; } .players-5 .seat-2 { order: 3; } .players-5 .seat-3 { order: 4; } .players-5 .seat-4 { order: 5; }

  .opponent-avatar {
    width: clamp(50px, 10vw, 70px);
    height: clamp(50px, 10vw, 70px);
    border-radius: 50%;
    border: clamp(2px, 0.5vw, 3px) solid #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    background: #f8f8f8;
    margin-bottom: clamp(0.25rem, 1vh, 0.5rem);
  }
  .opponent-name {
    font-size: clamp(0.75rem, 2.5vw, 1.1rem);
    font-weight: 600;
    color: #fff;
    text-shadow: 0 2px 8px rgba(0,0,0,0.25);
    margin-bottom: clamp(0.1rem, 0.5vh, 0.2rem);
    text-align: center;
    word-break: break-word;
  }
  .local-player-panel {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: 100%;
    max-width: 100vw;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: clamp(0.75rem, 2vh, 1.5rem) clamp(0.5rem, 2vw, 1rem) clamp(0.6rem, 1.5vh, 1.2rem);
    z-index: 10;
    background: none;
    box-shadow: none;
  }
  .local-avatar {
    width: clamp(60px, 12vw, 90px);
    height: clamp(60px, 12vw, 90px);
    border-radius: 50%;
    border: clamp(2px, 0.5vw, 3px) solid #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.10);
    margin-bottom: clamp(0.25rem, 1vh, 0.5rem);
    background: #f8f8f8;
  }
  .local-name {
    font-size: clamp(1rem, 3vw, 1.3rem);
    font-weight: 700;
    color: #fff;
    margin-bottom: clamp(0.35rem, 1.5vh, 0.7rem);
    text-shadow: 0 2px 8px rgba(0,0,0,0.18);
    text-align: center;
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
    height: clamp(100px, 20vh, 130px);
    min-width: clamp(240px, 60vw, 320px);
    max-width: 100%;
    margin-left: auto;
    margin-right: auto;
    width: fit-content;
    pointer-events: auto;
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
    box-shadow: 0 6px 18px rgba(0,0,0,0.18);
    transform: scale(1.08) translateY(-18px) !important;
  }
  @media (hover: none) {
    .fanned-card:active {
      z-index: 100;
      transform: scale(1.05) translateY(-10px) !important;
    }
  }
  .opponent-hand {
    position: relative;
    height: clamp(60px, 12vh, 80px);
    min-width: clamp(200px, 50vw, 280px);
    max-width: 100%;
    margin-bottom: clamp(0.25rem, 1vh, 0.5rem);
    margin-top: clamp(0.1rem, 0.5vh, 0.2rem);
    width: fit-content;
    display: block;
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
    min-width: clamp(280px, 70vw, 320px);
    max-width: 95vw;
    min-height: clamp(140px, 25vh, 180px);
    pointer-events: none;
    padding: clamp(0.5rem, 2vw, 1rem);
  }

  .bid-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.98);
    border-radius: clamp(12px, 3vw, 16px);
    box-shadow: 0 2px 16px rgba(0,0,0,0.10);
    padding: clamp(1rem, 3vw, 2rem) clamp(1rem, 4vw, 2.5rem) clamp(0.75rem, 2.5vw, 1.5rem);
    margin-top: clamp(0.75rem, 2vh, 1.5rem);
    pointer-events: auto;
    max-width: 95vw;
    width: fit-content;
  }

  .bid-player-info {
    text-align: center;
    margin-bottom: clamp(0.5rem, 1.5vh, 1rem);
  }

  .bid-player-name {
    font-size: clamp(1.1rem, 3.5vw, 1.4rem);
    font-weight: 700;
    color: #2c3e50;
    margin-bottom: clamp(0.25rem, 0.75vh, 0.5rem);
  }

  .bid-instruction {
    font-size: clamp(0.9rem, 2.5vw, 1.1rem);
    color: #555;
  }

  .played-card {
    width: clamp(60px, 12vw, 80px);
    height: clamp(90px, 18vw, 120px);
  }

  .winner-banner {
    position: absolute;
    top: 40%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(255,255,255,0.9);
    padding: clamp(0.75rem, 2vw, 1rem) clamp(1rem, 3vw, 2rem);
    border-radius: clamp(8px, 2vw, 12px);
    font-size: clamp(1.1rem, 3.5vw, 1.5rem);
    font-weight: bold;
    box-shadow: 0 2px 10px rgba(0,0,0,0.4);
    z-index: 20;
    max-width: 90vw;
    text-align: center;
  }

  .card-back {
    width: clamp(60px, 12vw, 80px);
    height: clamp(90px, 18vw, 120px);
    border-radius: clamp(6px, 1.5vw, 8px);
    background: #fff url('/cards/back.svg') center/cover no-repeat;
    border: clamp(1px, 0.3vw, 1.5px) solid #d0d0d0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.10);
    position: absolute;
    left: 0;
    bottom: 0;
    margin: 0;
    opacity: 1;
    overflow: visible;
  }

  .bid-wait-message {
    margin-top: clamp(1rem, 3vh, 2rem);
    font-size: clamp(1rem, 3vw, 1.3rem);
    color: #fff;
    background: rgba(0,0,0,0.45);
    padding: clamp(0.75rem, 2vw, 1rem) clamp(1rem, 3vw, 2rem);
    border-radius: clamp(8px, 2vw, 12px);
    text-align: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.10);
    z-index: 10;
    max-width: 90vw;
    word-wrap: break-word;
  }

  .played-card {
    position: relative;
  }

  .played-card.winning-card {
    transform: translateY(-10px) scale(1.05);
    z-index: 10;
    box-shadow: 0 4px 20px rgba(255, 215, 0, 0.6);
    border: 3px solid gold;
    border-radius: 8px;
  }

  .winning-indicator {
    position: absolute;
    top: -15px;
    right: -15px;
    font-size: 2rem;
    z-index: 11;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
  }

  .led-suit-indicator {
    position: absolute;
    top: clamp(10px, 3vh, 20px);
    left: 50%;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.95);
    padding: clamp(0.4rem, 1.5vw, 0.5rem) clamp(0.75rem, 2vw, 1rem);
    border-radius: clamp(6px, 1.5vw, 8px);
    font-size: clamp(0.85rem, 2.5vw, 1rem);
    font-weight: 600;
    color: #2c3e50;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 6;
    white-space: nowrap;
  }

  .led-suit-indicator .suit-name {
    text-transform: capitalize;
    color: #e74c3c;
  }

  .player-result .bonus {
    color: #4caf50;
    font-weight: 600;
  }

  .player-result .failure-text {
    color: #f44336;
    font-weight: 600;
  }

  .round-end-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    pointer-events: auto;
  }

  .round-end-content {
    background: #fff;
    border-radius: 16px;
    padding: 2rem 3rem;
    max-width: 600px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  }

  .round-end-content h2 {
    margin: 0 0 1.5rem 0;
    font-size: 2rem;
    color: #2c3e50;
    text-align: center;
  }

  .round-results {
    margin-bottom: 1.5rem;
  }

  .player-result {
    padding: 1rem;
    margin: 0.5rem 0;
    border-radius: 8px;
    background: #f5f5f5;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .player-result.success {
    background: #e8f5e9;
    border: 2px solid #4caf50;
  }

  .player-result.failure {
    background: #ffebee;
    border: 2px solid #f44336;
  }

  .player-result .player-name {
    font-weight: 600;
    font-size: 1.1rem;
    color: #2c3e50;
  }

  .player-result .result-details {
    font-size: 0.95rem;
    color: #555;
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .player-result .bonus {
    color: #4caf50;
    font-weight: 600;
  }

  .next-round-button {
    width: 100%;
    padding: clamp(0.75rem, 2vh, 1rem) clamp(1rem, 3vw, 2rem);
    min-height: 44px;
    font-size: clamp(1rem, 3vw, 1.2rem);
    font-weight: 600;
    background-color: #004C8C;
    color: white;
    border: none;
    border-radius: clamp(6px, 1.5vw, 8px);
    cursor: pointer;
    transition: background-color 0.3s;
    margin-top: clamp(0.75rem, 2vh, 1rem);
    touch-action: manipulation;
  }

  .next-round-button:hover {
    background-color: #00B7C2;
  }

  /* Responsive breakpoints */
  @media (max-width: 1024px) {
    .opponents {
      height: clamp(35vh, 45vh, 55vh);
    }
    .local-player-panel {
      padding: clamp(0.5rem, 1.5vh, 1rem) clamp(0.5rem, 1.5vw, 1rem);
    }
  }

  @media (max-width: 768px) {
    .opponents {
      height: clamp(30vh, 40vh, 50vh);
      flex-wrap: wrap;
      gap: clamp(0.25rem, 1vw, 0.5rem);
    }
    .opponent-seat {
      min-width: clamp(70px, 12vw, 100px);
      max-width: clamp(90px, 18vw, 130px);
    }
    .table {
      min-width: clamp(250px, 80vw, 300px);
    }
    .bid-center {
      padding: clamp(0.75rem, 2.5vw, 1.5rem) clamp(0.75rem, 3vw, 1.5rem);
    }
    .hand-fanned {
      min-width: clamp(200px, 70vw, 280px);
      height: clamp(90px, 18vh, 120px);
    }
    .opponent-hand {
      min-width: clamp(180px, 60vw, 250px);
      height: clamp(50px, 10vh, 70px);
    }
  }

  @media (max-width: 480px) {
    .opponents {
      height: clamp(25vh, 35vh, 45vh);
      padding: 0.25rem;
    }
    .opponent-avatar {
      width: clamp(40px, 8vw, 55px);
      height: clamp(40px, 8vw, 55px);
    }
    .opponent-name {
      font-size: clamp(0.65rem, 2vw, 0.85rem);
    }
    .local-avatar {
      width: clamp(50px, 10vw, 70px);
      height: clamp(50px, 10vw, 70px);
    }
    .local-name {
      font-size: clamp(0.9rem, 2.5vw, 1.1rem);
    }
    .table {
      min-width: clamp(220px, 85vw, 280px);
      padding: 0.5rem;
    }
    .bid-center {
      padding: clamp(0.5rem, 2vw, 1rem) clamp(0.5rem, 2.5vw, 1rem);
      max-width: 98vw;
    }
    .hand-fanned {
      min-width: clamp(180px, 75vw, 240px);
      height: clamp(80px, 16vh, 110px);
    }
    .opponent-hand {
      min-width: clamp(160px, 65vw, 220px);
      height: clamp(45px, 9vh, 65px);
    }
    .played-card {
      width: clamp(50px, 10vw, 70px);
      height: clamp(75px, 15vw, 105px);
    }
    .card-back {
      width: clamp(50px, 10vw, 70px);
      height: clamp(75px, 15vw, 105px);
    }
  }

  @media (orientation: landscape) and (max-height: 600px) {
    .opponents {
      height: clamp(25vh, 35vh, 40vh);
    }
    .local-player-panel {
      padding: clamp(0.25rem, 1vh, 0.5rem) clamp(0.5rem, 1vw, 1rem);
    }
    .hand-fanned {
      height: clamp(70px, 14vh, 100px);
    }
    .opponent-hand {
      height: clamp(40px, 8vh, 60px);
    }
  }
</style>
