<script lang="ts">
  import { gameState, isLocalPlayer, localPlayer, localPlayerIndex, roomId } from '../store';
  import { onMount, onDestroy } from 'svelte';
  import type { Player, OwnedCard } from '../../shared/types';
  import Card from './Card.svelte';
  import BidModal from './BidModal.svelte';
  import Scoreboard from './Scoreboard.svelte';
  import { socket } from '../socket';
  import { fly } from 'svelte/transition';
  import { getAvatarData } from '../avatarData';
  import { getPlayerAvatarUrl } from '../avatarUtils';
  import { startAvatarSwap, stopAllAvatarSwaps } from '../utils/avatarManager';
  import { cardValue } from '../utils/gameUtils';

  let winnerMessage: string | null = null;
  let showWinner = false;
  let previousTrickLength = 0;
  let previousTotalTricksWon = 0;
  let scoreboardOpen = false;
  let settingsOpen = false;
  let showTrickCollect = false;
  let trickCollectTargetClass = 'to-center';
  let trickCollectCardCount = 0;
  let trickCollectTimer: ReturnType<typeof setTimeout> | null = null;
  let turnPulsePlayerId: string | null = null;
  let showBidAnnouncement = false;
  let bidAnnouncementText: string | null = null;
  let bidAnnouncementTimer: ReturnType<typeof setTimeout> | null = null;
  let previousBidMap: Record<string, number | undefined> = {};

  $: isBiddingLocal =
    $gameState?.state === 'bidding' &&
    $gameState?.currentPlayer !== undefined &&
    !!$gameState.players[$gameState.currentPlayer] &&
    isLocalPlayer($gameState.players[$gameState.currentPlayer]);

  $: isBiddingPhase = $gameState?.state === 'bidding';

  function toggleScoreboard() {
    scoreboardOpen = !scoreboardOpen;
  }
  function closeScoreboard() {
    scoreboardOpen = false;
  }
  function openSettings() {
    settingsOpen = true;
  }
  function closeSettings() {
    settingsOpen = false;
  }

  function cancelGame() {
    closeScoreboard();
    closeSettings();
    socket.emit('cancel_game', { roomId: $roomId });
  }

  function startNextRound() {
    socket.emit('next_round', { roomId: $roomId });
  }

  function getForbiddenBid(): number | null {
    if (!$gameState) return null;
    const playersWhoBidded = $gameState.players.filter((p) => typeof p.bid === 'number').length;
    const isLastBidder = playersWhoBidded === $gameState.players.length - 1;
    if (!isLastBidder) return null;
    const currentTotal = $gameState.players.reduce((sum, p) => {
      const bid = typeof p.bid === 'number' ? p.bid : 0;
      return sum + bid;
    }, 0);
    const forbiddenBid = 7 - currentTotal;
    return forbiddenBid >= 0 && forbiddenBid <= 7 ? forbiddenBid : null;
  }

  function getWinningCardIndex(): number {
    if (!$gameState || !$gameState.currentTrick.length) return -1;
    const trick = $gameState.currentTrick;
    const suitLed = trick[0].card.suit;
    let winningIndex = 0;
    let winningCard = trick[0];
    trick.forEach((played, index) => {
      if (
        (played.card.suit === 'hearts' && winningCard.card.suit !== 'hearts') ||
        (played.card.suit === 'hearts' &&
          winningCard.card.suit === 'hearts' &&
          cardValue(played.card.value) > cardValue(winningCard.card.value)) ||
        (played.card.suit === suitLed &&
          winningCard.card.suit === suitLed &&
          cardValue(played.card.value) > cardValue(winningCard.card.value))
      ) {
        winningCard = played;
        winningIndex = index;
      }
    });
    return winningIndex;
  }

  function getLedSuit(): string | null {
    if (!$gameState || !$gameState.currentTrick.length) return null;
    return $gameState.currentTrick[0].card.suit;
  }

  function getWinnerTargetClass(winnerIndex: number): string {
    const n = $gameState?.players?.length || 0;
    if (n === 0 || winnerIndex < 0 || $localPlayerIndex < 0) return 'to-center';
    const stepFromLocal = (winnerIndex - $localPlayerIndex + n) % n;
    if (stepFromLocal === 0) return 'to-local';
    const opponentSeat = stepFromLocal - 1;
    const opponentTotal = Math.max(1, n - 1);
    return `to-${opponentTotal}-seat-${opponentSeat}`;
  }

  function isTricksWarning(player: Player): boolean {
    if (!$gameState || $gameState.state !== 'tricks') return false;
    if (typeof player.bid !== 'number') return false;
    if (player.tricksWon > player.bid) return true;
    // If even winning all remaining tricks cannot reach bid, mark red.
    return player.tricksWon + player.hand.length < player.bid;
  }

  onMount(() => {
    document.body.classList.add('game-bg');
    if ($gameState?.players) {
      $gameState.players.forEach((player: Player) => startAvatarSwap(player));
    }
    return () => {
      stopAllAvatarSwaps();
      document.body.classList.remove('game-bg');
    };
  });

  onDestroy(() => {
    if (trickCollectTimer) {
      clearTimeout(trickCollectTimer);
      trickCollectTimer = null;
    }
    if (bidAnnouncementTimer) {
      clearTimeout(bidAnnouncementTimer);
      bidAnnouncementTimer = null;
    }
    stopAllAvatarSwaps();
    document.body.classList.remove('game-bg');
  });

  let escapeHandler: ((e: KeyboardEvent) => void) | null = null;
  $: if (scoreboardOpen || settingsOpen) {
    if (escapeHandler) window.removeEventListener('keydown', escapeHandler);
    escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeScoreboard();
        closeSettings();
      }
    };
    window.addEventListener('keydown', escapeHandler);
  } else if (escapeHandler) {
    window.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
  }

  $: currentPlayerId =
    $gameState?.currentPlayer !== undefined ? $gameState?.players?.[$gameState.currentPlayer]?.playerId : null;

  $: isLocalTurn =
    !!$gameState &&
    !!$localPlayer &&
    ($gameState.state === 'bidding' || $gameState.state === 'tricks') &&
    currentPlayerId === $localPlayer.playerId;

  $: isLocalTurnToPlay = !!$gameState && !!$localPlayer && $gameState.state === 'tricks' && isLocalTurn;

  $: if ($gameState?.state === 'tricks') {
    const currentTrickLength = $gameState.currentTrick.length;
    const numPlayers = $gameState.players?.length || 0;
    const totalTricksWon = $gameState.players.reduce((sum, p) => sum + (p.tricksWon || 0), 0);

    // Trigger collect animation when a trick has actually been awarded.
    // This is more reliable than waiting for a transient full-trick state.
    if (totalTricksWon > previousTotalTricksWon && currentTrickLength === 0 && numPlayers > 0) {
      trickCollectCardCount = numPlayers;
      const winner = $gameState.players[$gameState.currentPlayer];
      if (winner) {
        const winnerName = getAvatarData(winner.selectedAvatar).name;
        winnerMessage = `${winnerName} wins the trick`;
        turnPulsePlayerId = winner.playerId;
        trickCollectTargetClass = getWinnerTargetClass($gameState.currentPlayer);
        showTrickCollect = true;
      } else {
        winnerMessage = 'Trick completed!';
        trickCollectTargetClass = 'to-center';
        showTrickCollect = true;
      }
      showWinner = true;
      if (trickCollectTimer) clearTimeout(trickCollectTimer);
      trickCollectTimer = setTimeout(() => {
        showTrickCollect = false;
        trickCollectCardCount = 0;
      }, 1650);
      setTimeout(() => {
        turnPulsePlayerId = null;
      }, 1300);
      setTimeout(() => {
        showWinner = false;
        winnerMessage = null;
      }, 2000);
    }
    previousTrickLength = currentTrickLength;
    previousTotalTricksWon = totalTricksWon;
  } else {
    previousTrickLength = 0;
    previousTotalTricksWon = $gameState?.players?.reduce((sum, p) => sum + (p.tricksWon || 0), 0) || 0;
  }

  $: if ($gameState) {
    if ($gameState.state === 'bidding') {
      const currentMap: Record<string, number | undefined> = {};
      for (const p of $gameState.players) currentMap[p.playerId] = p.bid;

      const newlyBid = $gameState.players.find((p) => {
        const prev = previousBidMap[p.playerId];
        return typeof p.bid === 'number' && typeof prev !== 'number';
      });

      if (
        newlyBid &&
        (!$localPlayer || newlyBid.playerId !== $localPlayer.playerId)
      ) {
        const name = getAvatarData(newlyBid.selectedAvatar).name;
        bidAnnouncementText = `${name} bid ${newlyBid.bid}`;
        showBidAnnouncement = true;
        if (bidAnnouncementTimer) clearTimeout(bidAnnouncementTimer);
        bidAnnouncementTimer = setTimeout(() => {
          showBidAnnouncement = false;
          bidAnnouncementText = null;
        }, 1600);
      }

      previousBidMap = currentMap;
    } else {
      previousBidMap = {};
      showBidAnnouncement = false;
      bidAnnouncementText = null;
      if (bidAnnouncementTimer) {
        clearTimeout(bidAnnouncementTimer);
        bidAnnouncementTimer = null;
      }
    }
  }

  // Smart hand sort: alternate red/black where possible, hearts on the right.
  function getSortedHand(hand: OwnedCard[]): OwnedCard[] {
    if (!hand || hand.length === 0) return [];
    const bySuit: Record<string, OwnedCard[]> = { spades: [], hearts: [], diamonds: [], clubs: [] };
    for (const c of hand) {
      if (bySuit[c.card.suit]) bySuit[c.card.suit].push(c);
    }
    const valueOrder = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    for (const s of Object.keys(bySuit)) {
      bySuit[s].sort((a, b) => valueOrder.indexOf(a.card.value) - valueOrder.indexOf(b.card.value));
    }

    const present = Object.keys(bySuit).filter((s) => bySuit[s].length > 0);
    const hasHearts = present.includes('hearts');
    const nonHearts = present.filter((s) => s !== 'hearts');

    const colorOf = (s: string) => (s === 'hearts' || s === 'diamonds' ? 'R' : 'B');
    const permutations = <T,>(arr: T[]): T[][] => {
      if (arr.length <= 1) return [arr];
      const result: T[][] = [];
      for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const p of permutations(rest)) result.push([arr[i], ...p]);
      }
      return result;
    };

    let best: string[] = hasHearts ? [...nonHearts, 'hearts'] : nonHearts;
    let bestScore = Infinity;
    for (const p of permutations(nonHearts)) {
      const full = hasHearts ? [...p, 'hearts'] : p;
      let score = 0;
      for (let i = 1; i < full.length; i++) {
        if (colorOf(full[i]) === colorOf(full[i - 1])) score++;
      }
      if (score < bestScore) {
        bestScore = score;
        best = full;
      }
    }
    return best.flatMap((s) => bySuit[s]);
  }

  $: biddingSequence = $gameState
    ? (() => {
        const players = $gameState.players || [];
        const n = players.length;
        const start = $gameState.firstPlayer ?? 0;
        const seq = [] as Player[];
        for (let i = 0; i < n; i++) seq.push(players[(start + i) % n]);
        return seq;
      })()
    : [];

  $: opponentsClockwise = $gameState
    ? (() => {
        const players = $gameState.players || [];
        const n = players.length;
        if (n <= 1 || $localPlayerIndex < 0) return players.filter((p) => !isLocalPlayer(p));
        const ordered: Player[] = [];
        for (let step = 1; step < n; step++) {
          ordered.push(players[($localPlayerIndex + step) % n]);
        }
        return ordered;
      })()
    : [];

  $: opponentCount = Math.max(0, ($gameState?.players.length || 1) - 1);
  $: announcerText = (() => {
    if (!$gameState) return '';
    if (isBiddingLocal) return 'Your turn — place your bid';
    const cp = $gameState.currentPlayer;
    if (cp === undefined || !$gameState.players[cp]) return '';
    const name = getAvatarData($gameState.players[cp].selectedAvatar).name;
    if ($gameState.state === 'bidding') return `${name} is selecting their bid...`;
    if ($gameState.state === 'tricks') return `${name}'s turn to play`;
    if ($gameState.state === 'round_end') return `Round ${$gameState.roundNumber} complete`;
    return '';
  })();
</script>

{#if $gameState}
  <div class="gameboard" class:modal-bidding={isBiddingLocal} class:bidding-phase={isBiddingPhase}>
    <!-- Fixed top bar: always present. In bidding phase the announcer is centered; in tricks we keep room for the scoreboard button. -->
    <header class="top-bar top-bar-fixed" class:centered={isBiddingPhase}>
      <div class="action-announcer" role="status" aria-live="polite">
        {announcerText || '\u00A0'}
      </div>
      {#if !isBiddingPhase}
        <div class="top-bar-actions">
          <button
            type="button"
            class="settings-toggle"
            aria-label="Open settings"
            aria-expanded={settingsOpen}
            on:click={openSettings}
          >
            ⚙
          </button>
          <button
            type="button"
            class="scoreboard-toggle"
            aria-label="Toggle scoreboard"
            aria-expanded={scoreboardOpen}
            on:click={toggleScoreboard}
          >
            <span class="scoreboard-icon" aria-hidden="true">📊</span>
          </button>
        </div>
      {/if}
    </header>

    {#if scoreboardOpen}
      <div class="scoreboard-overlay" role="dialog" aria-label="Scoreboard" aria-modal="true">
        <button
          type="button"
          class="scoreboard-backdrop"
          aria-label="Close scoreboard"
          on:click={closeScoreboard}
        ></button>
        <div class="scoreboard-overlay-panel">
          <Scoreboard compact={false} />
        </div>
      </div>
    {/if}

    {#if settingsOpen}
      <div class="settings-overlay" role="dialog" aria-label="Game settings" aria-modal="true">
        <button
          type="button"
          class="settings-backdrop"
          aria-label="Close settings"
          on:click={closeSettings}
        ></button>
        <div class="settings-panel">
          <h3>Game Settings</h3>
          <button type="button" class="settings-end-game-btn" on:click={cancelGame}>End Game</button>
          <button type="button" class="settings-close-btn" on:click={closeSettings}>Close</button>
        </div>
      </div>
    {/if}

    <div class="gameboard-content">
      {#if isBiddingPhase && showBidAnnouncement && bidAnnouncementText}
        <div class="bid-banner">{bidAnnouncementText}</div>
      {/if}
      {#if isBiddingLocal}
        <BidModal
          gameState={$gameState}
          localPlayer={$localPlayer}
          {biddingSequence}
          forbiddenBid={getForbiddenBid()}
          sortHand={getSortedHand}
          on:bid={(e) =>
            socket.emit('submit_bid', {
              roomId: $gameState.roomId,
              playerIndex: $gameState.currentPlayer,
              bid: e.detail.bid
            })}
        />
      {:else}
        <!-- Non-local bidding OR tricks OR round_end: show opponents + table + local hand -->
        <div class="middle">
          <div class="opponents opponents-{opponentCount}">
            {#each opponentsClockwise as player, idx (player.playerId)}
              <div
                class="opponent-seat seat-{idx}"
                class:active-turn={($gameState.state === 'bidding' || $gameState.state === 'tricks') &&
                  $gameState.players.findIndex((p) => p.playerId === player.playerId) === $gameState.currentPlayer}
                class:recent-winner={turnPulsePlayerId === player.playerId}
              >
                <img src={getPlayerAvatarUrl(player)} alt="Avatar" class="opponent-avatar" />
                <div class="opponent-name">
                  {player.selectedAvatar ? getAvatarData(player.selectedAvatar).name : 'Player'}
                </div>
                {#if !isBiddingPhase}
                  <div class="player-hand-stats">
                    <div class="stat-line">
                      <span class="stat-icon">🎯</span> Bid: {typeof player.bid === 'number' ? player.bid : '—'}
                    </div>
                    <div class="stat-line" class:warning-stat={isTricksWarning(player)}>
                      <span class="stat-icon">🃏</span> Tricks: {player.tricksWon}
                    </div>
                  </div>
                {:else if typeof player.bid === 'number'}
                  <div class="player-hand-stats">
                    <div class="stat-line">
                      <span class="stat-icon">🎯</span> Bid: {player.bid}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>

          <div class="table-zone">
            <div class="table">
              {#if $gameState.currentTrick.length > 0}
                {@const winningIndex = getWinningCardIndex()}
                <div class="trick-row">
                  {#each $gameState.currentTrick as ownedCard, index (ownedCard.card.id)}
                    <div
                      class="played-card {index === winningIndex ? 'winning-card' : ''}"
                      class:dimmed={index !== winningIndex}
                      class:led-loser={index === 0 && index !== winningIndex}
                      style="z-index: {index + 1};"
                      transition:fly={{ y: -50, duration: 400 }}
                    >
                      <Card {ownedCard} />
                      {#if index === winningIndex}
                        <div class="winning-indicator">👑</div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}

              {#if $gameState.currentTrick.length > 0 && $gameState.state === 'tricks'}
                {@const ledSuit = getLedSuit()}
                {#if ledSuit}
                  <div class="led-suit-indicator">
                    Led suit: <span
                      class="suit-name"
                      class:red-suit={ledSuit === 'hearts' || ledSuit === 'diamonds'}
                      >{ledSuit}</span
                    >
                  </div>
                {/if}
              {/if}

              {#if showWinner && winnerMessage}
                <div class="winner-banner">{winnerMessage}</div>
              {/if}
            </div>
          </div>

          {#if showTrickCollect}
            <div class="trick-collect {trickCollectTargetClass}" aria-hidden="true">
              {#each Array(Math.max(2, trickCollectCardCount)).fill(0).map((_, i) => i) as i (i)}
                {@const centerOffset = i - (Math.max(2, trickCollectCardCount) - 1) / 2}
                <div
                  class="trick-collect-card"
                  style="
                    --from-x: {centerOffset * 20}px;
                    --from-y: {Math.abs(centerOffset) * -8}px;
                    --from-r: {centerOffset * 9}deg;
                    --pile-x: {centerOffset * 1.6}px;
                    --pile-y: {i * 1.2}px;
                    --pile-r: {centerOffset * 1.2}deg;
                  "
                ></div>
              {/each}
            </div>
          {/if}
        </div>

        {#if $localPlayer}
          <div class="local-player-panel" class:turn-active={isLocalTurnToPlay}>
            <div class="hand hand-fanned local-hand" class:turn-highlight={isLocalTurnToPlay}>
              {#each getSortedHand($localPlayer.hand) as ownedCard, idx (ownedCard.card.id)}
                {@const len = $localPlayer.hand.length}
                <div
                  class="fanned-card"
                  style="
                    --card-offset: {idx - (len - 1) / 2};
                    --fan-lift: {Math.pow(Math.abs(idx - (len - 1) / 2), 2) * 1.6}px;
                    left: calc(50% - var(--hand-half, 35px) + var(--card-offset) * var(--hand-spread, 30px));
                    z-index: {idx};
                    bottom: 0;
                    transform-origin: bottom center;
                    transform: rotate(calc(var(--card-offset) * var(--hand-rotate, 14deg))) translateY(calc(var(--hand-base-y, -8px) - var(--fan-lift)));
                  "
                >
                  <Card {ownedCard} />
                </div>
              {/each}
            </div>
            <div
              class="local-player-meta"
              class:active-turn={isLocalTurn}
              class:recent-winner={turnPulsePlayerId === $localPlayer.playerId}
            >
              <img src={getPlayerAvatarUrl($localPlayer)} alt="Your Avatar" class="local-avatar" />
              <div class="local-name">{getAvatarData($localPlayer.selectedAvatar).name}</div>
              {#if !isBiddingPhase}
                <div class="player-hand-stats local-stats">
                  <div class="stat-line">
                    <span class="stat-icon">🎯</span> Bid: {typeof $localPlayer.bid === 'number' ? $localPlayer.bid : '—'}
                  </div>
                  <div class="stat-line" class:warning-stat={isTricksWarning($localPlayer)}>
                    <span class="stat-icon">🃏</span> Tricks: {$localPlayer.tricksWon}
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/if}
    </div>

    {#if $gameState?.state === 'round_end'}
      <div class="round-end-overlay">
        <div class="round-end-content">
          <h2>Round {$gameState.roundNumber} Complete!</h2>
          <div class="round-results">
            {#each $gameState.players as player (player.playerId)}
              {@const bid = player.bid ?? 0}
              {@const tricks = player.tricksWon}
              {@const isSuccess = bid === tricks}
              {@const score = isSuccess ? 1 : 0}
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
            {#if Object.values($gameState.scoreboard || {}).some((s) => s >= 5)}
              View Final Scores
            {:else}
              Start Next Round
            {/if}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  :global(html),
  :global(body),
  :global(#app) {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  :global(body.game-bg) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    min-height: 100dvh;
    width: 100%;
    overflow: hidden;
    background:
      radial-gradient(circle at 20% 15%, rgba(255, 255, 255, 0.08), transparent 35%),
      radial-gradient(circle at 80% 85%, rgba(0, 0, 0, 0.14), transparent 45%),
      linear-gradient(140deg, #0f7d44 0%, #0b6a3b 45%, #085832 100%) !important;
    transition: background 0.3s;
  }

  .gameboard {
    --top-bar-height: calc(3rem + env(safe-area-inset-top, 0));
    position: relative;
    width: 100%;
    height: 100dvh;
    max-width: 100%;
    max-height: 100dvh;
    overflow: hidden;
    touch-action: pan-y pinch-zoom;
    background:
      radial-gradient(120% 90% at 50% 40%, rgba(24, 122, 70, 0.55) 0%, rgba(9, 68, 39, 0.55) 100%),
      radial-gradient(circle at 15% 20%, rgba(255, 255, 255, 0.05), transparent 28%),
      radial-gradient(circle at 85% 80%, rgba(0, 0, 0, 0.18), transparent 35%),
      repeating-linear-gradient(
        25deg,
        rgba(255, 255, 255, 0.018) 0px,
        rgba(255, 255, 255, 0.018) 2px,
        rgba(0, 0, 0, 0.02) 2px,
        rgba(0, 0, 0, 0.02) 4px
      ),
      linear-gradient(155deg, #0f7f45 0%, #0b6b3b 50%, #085732 100%);
  }
  .gameboard::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-radial-gradient(
      circle at center,
      rgba(255, 255, 255, 0.015) 0px,
      rgba(255, 255, 255, 0.015) 1px,
      rgba(0, 0, 0, 0.015) 1px,
      rgba(0, 0, 0, 0.015) 2px
    );
    opacity: 0.55;
    z-index: 0;
  }
  .gameboard::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(65% 42% at 50% 58%, rgba(255, 255, 255, 0.08), transparent 75%),
      radial-gradient(130% 95% at 50% 50%, transparent 56%, rgba(0, 0, 0, 0.3) 100%);
    z-index: 0;
  }
  .gameboard-content::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background:
      radial-gradient(circle at 24% 42%, rgba(255, 255, 255, 0.045), transparent 13%),
      radial-gradient(circle at 76% 34%, rgba(255, 255, 255, 0.04), transparent 12%),
      radial-gradient(circle at 50% 67%, rgba(255, 255, 255, 0.038), transparent 18%),
      radial-gradient(circle at 18% 78%, rgba(0, 0, 0, 0.12), transparent 24%),
      radial-gradient(circle at 82% 82%, rgba(0, 0, 0, 0.1), transparent 20%);
    opacity: 0.85;
  }

  /* Top bar */
  .top-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.75rem;
    min-height: 2.75rem;
    z-index: 100;
    box-sizing: border-box;
  }
  .top-bar-fixed {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: rgba(10, 70, 38, 0.92);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    padding-top: calc(env(safe-area-inset-top, 0) + 0.35rem);
    backdrop-filter: blur(6px);
  }
  /* In the game phase, announcer on the left/center, scoreboard button on the right */
  .top-bar:not(.centered) {
    justify-content: space-between;
  }
  /* In bidding, the announcer is centred in the full bar */
  .top-bar.centered {
    justify-content: center;
  }
  .top-bar.centered .action-announcer {
    margin: 0 auto;
    max-width: min(92vw, 640px);
    width: auto;
  }

  .action-announcer {
    flex: 1 1 auto;
    min-width: 0;
    background: rgba(0, 0, 0, 0.55);
    color: #f7fbff;
    max-width: 100%;
    box-sizing: border-box;
    padding: 0.35rem 0.75rem;
    border-radius: 999px;
    font-size: clamp(0.85rem, 2.3vw, 1.15rem);
    font-weight: 600;
    text-align: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .scoreboard-toggle {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.22);
    color: #fff;
    cursor: pointer;
    transition: background 0.2s;
  }
  .scoreboard-toggle:hover {
    background: rgba(255, 255, 255, 0.4);
  }
  .scoreboard-icon {
    font-size: 1.2rem;
  }
  .top-bar-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex: 0 0 auto;
  }
  .settings-toggle {
    flex: 0 0 auto;
    width: 2.25rem;
    height: 2.25rem;
    border: none;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.22);
    color: #fff;
    font-size: 1.1rem;
    cursor: pointer;
    transition: background 0.2s;
  }
  .settings-toggle:hover {
    background: rgba(255, 255, 255, 0.4);
  }
  .settings-overlay {
    position: fixed;
    inset: 0;
    z-index: 205;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .settings-backdrop {
    position: absolute;
    inset: 0;
    border: none;
    background: rgba(0, 0, 0, 0.52);
    cursor: pointer;
  }
  .settings-panel {
    position: relative;
    z-index: 1;
    width: min(92vw, 340px);
    background: linear-gradient(180deg, #ffffff, #f6f8fb);
    border: 1px solid rgba(44, 62, 80, 0.14);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.26);
    padding: 0.9rem 1rem 1rem;
    color: #223344;
  }
  .settings-panel h3 {
    margin: 0 0 0.35rem;
    font-size: 1.05rem;
  }
  .settings-end-game-btn {
    border: 1px solid rgba(255, 255, 255, 0.34);
    background: rgba(140, 19, 19, 0.9);
    color: #fff;
    border-radius: 8px;
    padding: 0.55rem 0.7rem;
    width: 100%;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
  }
  .settings-end-game-btn:hover {
    background: rgba(163, 25, 25, 0.95);
    border-color: rgba(255, 170, 170, 0.5);
  }
  .settings-close-btn {
    margin-top: 0.5rem;
    width: 100%;
    border: 1px solid rgba(44, 62, 80, 0.2);
    background: #fff;
    color: #2c3e50;
    border-radius: 8px;
    padding: 0.5rem 0.7rem;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
  }

  .scoreboard-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .scoreboard-backdrop {
    position: absolute;
    inset: 0;
    z-index: 0;
    padding: 0;
    border: none;
    background: rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }
  .scoreboard-overlay-panel {
    position: relative;
    z-index: 1;
    max-height: 90vh;
    overflow-y: auto;
  }

  /* Gameboard content area: sits below the fixed top bar and fills remaining viewport */
  .gameboard-content {
    position: absolute;
    top: var(--top-bar-height);
    left: 0;
    right: 0;
    bottom: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ——— Non-bidding: opponents + table + local hand ——— */
  .middle {
    flex: 1 1 auto;
    min-height: 0;
    position: relative;
    display: block;
  }
  .opponents {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: clamp(110px, 32%, 240px);
    pointer-events: none;
    z-index: 2;
  }
  .opponents .opponent-seat {
    position: absolute;
    transform: translateX(-50%);
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: clamp(68px, 18vw, 130px);
  }
  .opponents-1 .seat-0 { left: 50%; top: 8%; }
  .opponents-2 .seat-0 { left: 28%; top: 9%; }
  .opponents-2 .seat-1 { left: 72%; top: 9%; }
  .opponents-3 .seat-0 { left: 18%; top: 11%; }
  .opponents-3 .seat-1 { left: 50%; top: 4%; }
  .opponents-3 .seat-2 { left: 82%; top: 11%; }
  .opponents-4 .seat-0 { left: 12%; top: 14%; }
  .opponents-4 .seat-1 { left: 36%; top: 5%; }
  .opponents-4 .seat-2 { left: 64%; top: 5%; }
  .opponents-4 .seat-3 { left: 88%; top: 14%; }
  .opponents-5 .seat-0 { left: 10%; top: 16%; }
  .opponents-5 .seat-1 { left: 28%; top: 7%; }
  .opponents-5 .seat-2 { left: 50%; top: 2%; }
  .opponents-5 .seat-3 { left: 72%; top: 7%; }
  .opponents-5 .seat-4 { left: 90%; top: 16%; }

  .opponent-avatar {
    width: clamp(42px, 9vw, 66px);
    height: clamp(42px, 9vw, 66px);
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    background: transparent;
    margin-bottom: 0.2rem;
    object-fit: contain;
  }
  .opponents-4 .opponent-avatar,
  .opponents-5 .opponent-avatar {
    width: clamp(34px, 7vw, 52px);
    height: clamp(34px, 7vw, 52px);
  }
  .opponent-name {
    font-size: clamp(0.65rem, 2vw, 0.95rem);
    font-weight: 600;
    color: #fff;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    margin-bottom: 0.1rem;
    text-align: center;
    line-height: 1.15;
    word-break: break-word;
  }
  .opponents-4 .opponent-name,
  .opponents-5 .opponent-name {
    font-size: clamp(0.6rem, 1.5vw, 0.8rem);
  }
  .opponent-seat.active-turn .opponent-avatar,
  .local-player-meta.active-turn .local-avatar {
    border-color: #ffd84f;
    box-shadow:
      0 0 0 3px rgba(255, 216, 79, 0.38),
      0 0 14px rgba(255, 216, 79, 0.55),
      0 2px 10px rgba(0, 0, 0, 0.3);
    animation: turnPulseRing 1.15s ease-in-out infinite;
  }
  .opponent-seat.active-turn .opponent-name,
  .local-player-meta.active-turn .local-name,
  .opponent-seat.active-turn .player-hand-stats,
  .local-player-meta.active-turn .player-hand-stats {
    color: #ffe889;
    text-shadow: 0 0 10px rgba(255, 216, 79, 0.5), 0 2px 6px rgba(0, 0, 0, 0.45);
  }
  .opponent-seat.recent-winner .opponent-avatar,
  .local-player-meta.recent-winner .local-avatar {
    animation: winnerPulse 0.9s ease-out 1;
  }

  .table-zone {
    position: absolute;
    top: clamp(110px, 32%, 240px);
    left: 0;
    right: 0;
    bottom: 0;
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
    min-width: clamp(260px, 70vw, 320px);
    max-width: 95vw;
    min-height: clamp(120px, 22vh, 180px);
    pointer-events: none;
    padding: clamp(0.4rem, 2vw, 1rem);
  }
  .trick-row {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 0.5rem;
  }
  .trick-row .played-card + .played-card {
    margin-left: -18px;
  }
  .played-card {
    position: relative;
    width: clamp(58px, 12vw, 80px);
    height: clamp(86px, 18vw, 120px);
  }
  .played-card.dimmed {
    opacity: 0.6;
    filter: none;
  }
  .played-card.led-loser {
    border: 2px solid #e74c3c;
    border-radius: 8px;
    box-shadow: 0 0 10px rgba(231, 76, 60, 0.45);
  }
  .played-card.winning-card {
    transform: translateY(-10px) scale(1.05);
    z-index: 10;
    box-shadow: 0 4px 20px rgba(255, 215, 0, 0.6);
    border: 3px solid gold;
    border-radius: 8px;
  }
  .played-card :global(.card.unplayable) {
    opacity: 1;
  }
  .winning-indicator {
    position: absolute;
    top: -15px;
    right: -15px;
    font-size: 2rem;
    z-index: 11;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
  }
  .led-suit-indicator {
    position: absolute;
    bottom: clamp(8px, 2vh, 14px);
    left: 50%;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.95);
    padding: clamp(0.3rem, 1vw, 0.45rem) clamp(0.6rem, 2vw, 0.9rem);
    border-radius: clamp(6px, 1.5vw, 8px);
    font-size: clamp(0.8rem, 2.2vw, 0.95rem);
    font-weight: 600;
    color: #2c3e50;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    z-index: 25;
    white-space: nowrap;
  }
  .led-suit-indicator .suit-name {
    text-transform: capitalize;
    color: #1f2f44;
  }
  .led-suit-indicator .suit-name.red-suit {
    color: #e74c3c;
  }
  .winner-banner {
    position: absolute;
    top: clamp(8px, 6%, 24px);
    right: clamp(8px, 2vw, 20px);
    left: auto;
    transform: none;
    background: rgba(255, 255, 255, 0.9);
    padding: clamp(0.6rem, 2vw, 1rem) clamp(1rem, 3vw, 2rem);
    border-radius: clamp(8px, 2vw, 12px);
    font-size: clamp(1rem, 3.5vw, 1.4rem);
    font-weight: bold;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
    z-index: 20;
    text-align: center;
  }
  .bid-banner {
    position: absolute;
    top: clamp(10px, 2.4vh, 22px);
    left: 50%;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.94);
    color: #1f2f44;
    border: 1px solid rgba(44, 62, 80, 0.16);
    border-radius: 12px;
    padding: 0.45rem 0.9rem;
    font-size: clamp(0.86rem, 2.2vw, 1.02rem);
    font-weight: 700;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
    z-index: 35;
    pointer-events: none;
    animation: bidBannerPop 0.22s ease-out;
  }
  @keyframes bidBannerPop {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-5px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
  }

  .player-hand-stats {
    font-size: clamp(0.7rem, 1.7vh, 0.9rem);
    color: #e8f5ec;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
    font-weight: 600;
    margin-top: 0.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    align-items: center;
    line-height: 1.1;
    padding: 0.18rem 0.45rem;
    border-radius: 10px;
    background: linear-gradient(180deg, rgba(9, 34, 21, 0.28), rgba(7, 24, 15, 0.22));
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    backdrop-filter: blur(2px);
  }
  .stat-line {
    white-space: nowrap;
  }
  .stat-icon {
    margin-right: 0.2rem;
  }
  .local-stats {
    color: #f4fbff;
  }

  /* Local player panel (bottom, hand + avatar to the right) */
  .local-player-panel {
    flex: 0 0 auto;
    display: flex;
    flex-direction: row;
    align-items: flex-end;
    justify-content: center;
    gap: clamp(0.4rem, 1.2vw, 0.8rem);
    width: 100%;
    padding: 0.25rem 0.6rem max(1rem, 3vh);
    box-sizing: border-box;
    z-index: 10;
    min-height: 0;
  }
  .local-player-meta {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    min-width: clamp(74px, 14vw, 130px);
    margin-bottom: clamp(0.2rem, 1vh, 0.45rem);
  }
  .local-avatar {
    width: clamp(56px, 11vw, 84px);
    height: clamp(56px, 11vw, 84px);
    border-radius: 50%;
    border: clamp(2px, 0.5vw, 3px) solid #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    margin-bottom: clamp(0.25rem, 1vh, 0.5rem);
    background: transparent;
    object-fit: contain;
  }
  .local-name {
    font-size: clamp(0.9rem, 2.6vw, 1.2rem);
    font-weight: 700;
    color: #fff;
    margin-bottom: clamp(0.25rem, 1vh, 0.5rem);
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    text-align: center;
    white-space: nowrap;
  }

  .hand {
    display: flex;
    gap: 0.5rem;
    margin: 0;
    justify-content: center;
    width: 100%;
    position: relative;
  }
  .hand-fanned {
    display: block;
    position: relative;
    height: clamp(96px, 20vh, 130px);
    min-width: clamp(220px, 58vw, 320px);
    max-width: 100%;
    width: fit-content;
    margin: 0 auto;
    pointer-events: auto;
  }
  .hand-fanned.turn-highlight {
    border: 2px solid rgba(11, 86, 52, 0.95);
    border-radius: 12px;
    padding: 0.35rem 0.45rem;
    background:
      repeating-linear-gradient(
        45deg,
        rgba(6, 56, 34, 0.24) 0px,
        rgba(6, 56, 34, 0.24) 3px,
        rgba(5, 44, 28, 0.26) 3px,
        rgba(5, 44, 28, 0.26) 6px
      ),
      linear-gradient(180deg, rgba(22, 106, 64, 0.3), rgba(8, 71, 42, 0.4));
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.14),
      0 0 0 3px rgba(17, 91, 56, 0.3),
      0 8px 18px rgba(0, 0, 0, 0.26);
    animation: localTurnGlow 1.2s ease-in-out infinite;
  }

  .trick-collect {
    position: absolute;
    left: 50%;
    top: 53%;
    width: 92px;
    height: 126px;
    transform: translate(-50%, -50%);
    z-index: 34;
    pointer-events: none;
    opacity: 0;
    animation: trickCollectTravel 1.25s cubic-bezier(0.2, 0.75, 0.2, 1) forwards;
    filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.3));
  }
  .trick-collect-card {
    position: absolute;
    width: 76px;
    height: 108px;
    border-radius: 8px;
    background: linear-gradient(180deg, #fff 0%, #f4f8fb 100%);
    border: 2px solid rgba(222, 234, 246, 0.95);
    box-shadow:
      0 0 0 2px rgba(255, 227, 118, 0.36),
      0 10px 18px rgba(0, 0, 0, 0.25),
      0 0 20px rgba(255, 227, 118, 0.45);
    left: 8px;
    top: 8px;
    animation: trickCollectCollapse 1.25s cubic-bezier(0.2, 0.75, 0.2, 1) forwards;
  }

  .trick-collect.to-local {
    --collect-x: 0px;
    --collect-y: 240px;
  }
  .trick-collect.to-1-seat-0 { --collect-x: 0px; --collect-y: -252px; }
  .trick-collect.to-2-seat-0 { --collect-x: -220px; --collect-y: -220px; }
  .trick-collect.to-2-seat-1 { --collect-x: 220px; --collect-y: -220px; }
  .trick-collect.to-3-seat-0 { --collect-x: -300px; --collect-y: -205px; }
  .trick-collect.to-3-seat-1 { --collect-x: 0px; --collect-y: -258px; }
  .trick-collect.to-3-seat-2 { --collect-x: 300px; --collect-y: -205px; }
  .trick-collect.to-4-seat-0 { --collect-x: -360px; --collect-y: -190px; }
  .trick-collect.to-4-seat-1 { --collect-x: -170px; --collect-y: -248px; }
  .trick-collect.to-4-seat-2 { --collect-x: 170px; --collect-y: -248px; }
  .trick-collect.to-4-seat-3 { --collect-x: 360px; --collect-y: -190px; }
  .trick-collect.to-5-seat-0 { --collect-x: -380px; --collect-y: -176px; }
  .trick-collect.to-5-seat-1 { --collect-x: -230px; --collect-y: -232px; }
  .trick-collect.to-5-seat-2 { --collect-x: 0px; --collect-y: -262px; }
  .trick-collect.to-5-seat-3 { --collect-x: 230px; --collect-y: -232px; }
  .trick-collect.to-5-seat-4 { --collect-x: 380px; --collect-y: -176px; }
  .trick-collect.to-center {
    --collect-x: 0px;
    --collect-y: -120px;
  }

  @keyframes trickCollectTravel {
    0% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1.06);
    }
    35% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1.1);
    }
    100% {
      opacity: 0;
      transform: translate(calc(-50% + var(--collect-x, 0px)), calc(-50% + var(--collect-y, -120px))) scale(0.38);
    }
  }
  @keyframes trickCollectCollapse {
    0% {
      transform: translate(var(--from-x, 0px), var(--from-y, 0px)) rotate(var(--from-r, 0deg));
    }
    40% {
      transform: translate(var(--pile-x, 0px), var(--pile-y, 0px)) rotate(var(--pile-r, 0deg));
    }
    100% {
      transform: translate(var(--pile-x, 0px), var(--pile-y, 0px)) rotate(var(--pile-r, 0deg));
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
  @keyframes localTurnGlow {
    0%,
    100% {
      box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.14),
        0 0 0 3px rgba(17, 91, 56, 0.3),
        0 8px 18px rgba(0, 0, 0, 0.26);
    }
    50% {
      box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.24),
        0 0 0 4px rgba(23, 114, 70, 0.45),
        0 0 16px rgba(55, 174, 108, 0.4),
        0 10px 20px rgba(0, 0, 0, 0.28);
    }
  }
  @keyframes winnerPulse {
    0% {
      transform: scale(1);
      box-shadow: 0 0 0 rgba(255, 226, 107, 0);
    }
    50% {
      transform: scale(1.08);
      box-shadow: 0 0 0 6px rgba(255, 226, 107, 0.26), 0 0 18px rgba(255, 226, 107, 0.55);
    }
    100% {
      transform: scale(1);
      box-shadow: 0 0 0 rgba(255, 226, 107, 0);
    }
  }

  .warning-stat {
    color: #ff2a2a;
    text-shadow:
      0 0 10px rgba(255, 30, 30, 0.9),
      0 0 22px rgba(255, 30, 30, 0.5),
      0 1px 3px rgba(0, 0, 0, 0.55);
    font-weight: 800;
    background: linear-gradient(180deg, rgba(105, 0, 0, 0.35), rgba(75, 0, 0, 0.22));
    border: 1px solid rgba(255, 80, 80, 0.68);
    border-radius: 6px;
    padding: 0.07rem 0.32rem;
    animation: warningPulse 1.2s ease-in-out infinite;
  }
  @keyframes warningPulse {
    0%,
    100% {
      transform: scale(1);
      box-shadow: 0 0 0 rgba(255, 42, 42, 0);
    }
    50% {
      transform: scale(1.04);
      box-shadow: 0 0 10px rgba(255, 42, 42, 0.55);
    }
  }
  .local-player-panel .hand-fanned {
    flex: 0 0 auto;
  }
  .local-hand {
    --hand-half: clamp(24px, 5vw, 36px);
    --hand-spread: clamp(22px, 4vw, 32px);
    --hand-rotate: 14deg;
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
  .fanned-card:hover {
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18), 0 0 0 2px rgba(255, 255, 255, 0.65);
    filter: brightness(1.04) saturate(1.08);
  }
  @media (hover: none) {
    .fanned-card:active {
      z-index: 100;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.16), 0 0 0 2px rgba(255, 255, 255, 0.55);
      filter: brightness(1.03) saturate(1.06);
    }
  }

  /* Round-end modal */
  .round-end-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 210;
  }
  .round-end-content {
    background: #fff;
    border-radius: 16px;
    padding: 1.5rem 1.75rem;
    max-width: 600px;
    width: 92%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }
  .round-end-content h2 {
    margin: 0 0 1rem;
    font-size: clamp(1.3rem, 4vw, 1.8rem);
    color: #2c3e50;
    text-align: center;
  }
  .player-result {
    padding: 0.7rem 0.9rem;
    margin: 0.35rem 0;
    border-radius: 8px;
    background: #f5f5f5;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
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
    font-weight: 700;
    font-size: 1rem;
    color: #2c3e50;
  }
  .player-result .result-details {
    font-size: 0.9rem;
    color: #555;
    display: flex;
    gap: 0.8rem;
    flex-wrap: wrap;
  }
  .player-result .bonus {
    color: #4caf50;
    font-weight: 700;
  }
  .player-result .failure-text {
    color: #f44336;
    font-weight: 700;
  }
  .next-round-button {
    width: 100%;
    padding: 0.75rem 1rem;
    min-height: 44px;
    font-size: 1.05rem;
    font-weight: 600;
    background-color: #004c8c;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.3s;
    margin-top: 0.75rem;
    touch-action: manipulation;
  }
  .next-round-button:hover {
    background-color: #00b7c2;
  }

  /* ——— Tablet (<= 1024px) ——— */
  @media (max-width: 1024px) {
    .opponents {
      height: clamp(104px, 30%, 210px);
    }
    .table-zone {
      top: clamp(104px, 30%, 210px);
    }
    .table {
      min-width: clamp(240px, 70vw, 300px);
      min-height: clamp(110px, 20vh, 160px);
    }
    .winner-banner {
      top: clamp(6px, 4%, 18px);
      right: clamp(6px, 2vw, 14px);
      padding: clamp(0.45rem, 1.4vw, 0.75rem) clamp(0.7rem, 2.2vw, 1.2rem);
      font-size: clamp(0.85rem, 2.4vw, 1.05rem);
      max-width: min(46vw, 260px);
      white-space: normal;
      text-align: center;
    }
  }

  /* ——— Phone (<= 768px) ——— */
  @media (max-width: 768px) {
    .gameboard {
      --top-bar-height: calc(2.6rem + env(safe-area-inset-top, 0));
    }
    .top-bar {
      min-height: 2.4rem;
      padding: 0.25rem 0.4rem;
    }
    .action-announcer {
      font-size: 0.85rem;
      padding: 0.3rem 0.6rem;
    }

    .opponents {
      height: clamp(94px, 28%, 170px);
    }
    .table-zone {
      top: clamp(94px, 28%, 170px);
    }
    .opponent-avatar {
      width: clamp(38px, 8vw, 54px);
      height: clamp(38px, 8vw, 54px);
    }
    .opponents-4 .opponent-avatar,
    .opponents-5 .opponent-avatar {
      width: 32px;
      height: 32px;
    }
    .opponent-name { font-size: 0.6rem; }

    .local-player-panel {
      padding: 0.25rem 0.4rem max(0.7rem, 2vh);
      gap: 0.35rem;
    }
    .local-player-meta {
      min-width: clamp(60px, 20vw, 100px);
    }
    .local-avatar {
      width: clamp(46px, 10vw, 66px);
      height: clamp(46px, 10vw, 66px);
    }
    .local-name {
      font-size: 0.88rem;
      margin-bottom: 0.15rem;
    }

    .hand-fanned {
      min-width: clamp(170px, 60vw, 240px);
      height: clamp(84px, 16vh, 110px);
    }
    .local-hand {
      --hand-half: 22px;
      --hand-spread: 19px;
      --hand-rotate: 12deg;
      --hand-base-y: -4px;
    }
    .played-card {
      width: clamp(48px, 10vw, 68px);
      height: clamp(72px, 14vw, 100px);
    }
    .winner-banner {
      top: clamp(6px, 3%, 14px);
      right: clamp(6px, 2vw, 10px);
      max-width: min(48vw, 210px);
      font-size: clamp(0.78rem, 2.6vw, 0.95rem);
    }
    .local-player-panel :global(.card) {
      width: 52px;
      height: 78px;
    }
  }

  /* ——— Very small phone (<= 430px) ——— */
  @media (max-width: 430px) {
    .gameboard {
      --top-bar-height: calc(2.4rem + env(safe-area-inset-top, 0));
    }
    .action-announcer { font-size: 0.78rem; }
    .local-player-panel {
      gap: 0.25rem;
      padding: 0.2rem 0.35rem max(0.5rem, 1.5vh);
    }
    .local-avatar { width: 42px; height: 42px; }
    .local-name { font-size: 0.8rem; }
    .hand-fanned {
      min-width: clamp(150px, 70vw, 210px);
      height: clamp(78px, 14vh, 98px);
    }
    .opponents {
      height: clamp(80px, 24%, 140px);
    }
    .table-zone {
      top: clamp(80px, 24%, 140px);
    }
    .winner-banner {
      max-width: min(55vw, 190px);
      font-size: clamp(0.72rem, 3vw, 0.88rem);
      padding: 0.35rem 0.6rem;
    }
  }

  /* ——— Landscape short viewport ——— */
  @media (orientation: landscape) and (max-height: 500px) {
    .gameboard {
      --top-bar-height: calc(2.2rem + env(safe-area-inset-top, 0));
    }
    .opponents {
      height: clamp(78px, 32%, 140px);
    }
    .table-zone {
      top: clamp(78px, 32%, 140px);
    }
    .local-player-panel {
      padding: 0.2rem 0.4rem 0.35rem;
    }
    .hand-fanned {
      height: clamp(64px, 22vh, 95px);
    }
  }
</style>
