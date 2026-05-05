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
  import { soundEffects } from '../utils/soundEffects';

  let winnerMessage: string | null = null;
  let showWinner = false;
  let previousTrickLength = 0;
  let scoreboardOpen = false;
  let settingsOpen = false;
  let showTrickCollect = false;
  let trickCollectTargetClass = 'to-center';
  let trickCollectCardCount = 0;
  let trickCollectTimer: ReturnType<typeof setTimeout> | null = null;
  let trickResultSoundTimer: ReturnType<typeof setTimeout> | null = null;
  let turnPulsePlayerId: string | null = null;
  let showTurnReminder = false;
  let turnReminderTimer: ReturnType<typeof setTimeout> | null = null;
  let cardsVolume = 100;
  let jinglesVolume = 100;
  let gameSpeed: 'slow' | 'normal' | 'fast' = 'normal';
  let showBidAnnouncement = false;
  function speedMultiplier(): number {
    if (gameSpeed === 'slow') return 1.35;
    if (gameSpeed === 'fast') return 0.7;
    return 1;
  }

  function scaleMs(ms: number): number {
    return Math.max(120, Math.round(ms * speedMultiplier()));
  }

  $: trickCollectAnimationMs = scaleMs(1250);

  let bidAnnouncementText: string | null = null;
  let bidAnnouncementTimer: ReturnType<typeof setTimeout> | null = null;
  let previousBidMap: Record<string, number | undefined> = {};
  let previousState: string | null = null;
  let previousRoundNumber = 0;
  let previousLocalHandSize = 0;
  let previousIsBiddingLocal = false;
  let previousIsLocalTurnToPlay = false;

  $: isBiddingLocal =
    $gameState?.state === 'bidding' &&
    $gameState?.currentPlayer !== undefined &&
    !!$gameState.players[$gameState.currentPlayer] &&
    isLocalPlayer($gameState.players[$gameState.currentPlayer]);

  $: isBiddingPhase = $gameState?.state === 'bidding';
  $: gameSpeed = $gameState?.gameSpeed === 'slow' || $gameState?.gameSpeed === 'fast' ? $gameState.gameSpeed : 'normal';

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

  function getTrickLeaderName(): string | null {
    if (!$gameState || !$gameState.currentTrick.length) return null;
    const leaderId = $gameState.currentTrick[0].playerId;
    const leader = $gameState.players.find((p) => p.playerId === leaderId);
    if (!leader) return null;
    return getAvatarData(leader.selectedAvatar).name;
  }

  function getSuitSymbol(suit: string): string {
    if (suit === 'spades') return '♠';
    if (suit === 'hearts') return '♥';
    if (suit === 'diamonds') return '♦';
    if (suit === 'clubs') return '♣';
    return suit;
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
    // Avoid false "can't make it" while a trick is still being resolved.
    if ($gameState.currentTrick.length > 0) return false;
    // If even winning all remaining tricks cannot reach bid, mark red.
    const remainingTricks = Math.max(...$gameState.players.map((p) => p.hand.length), 0);
    return player.tricksWon + remainingTricks < player.bid;
  }

  onMount(() => {
    document.body.classList.add('game-bg');
    const storedCardsVolumeRaw = localStorage.getItem('cardsVolume');
    const storedJinglesVolumeRaw = localStorage.getItem('jinglesVolume');
    if (storedCardsVolumeRaw !== null) {
      const storedCardsVolume = Number(storedCardsVolumeRaw);
      if (Number.isFinite(storedCardsVolume)) cardsVolume = Math.max(0, Math.min(100, Math.round(storedCardsVolume)));
    }
    if (storedJinglesVolumeRaw !== null) {
      const storedJinglesVolume = Number(storedJinglesVolumeRaw);
      if (Number.isFinite(storedJinglesVolume)) jinglesVolume = Math.max(0, Math.min(100, Math.round(storedJinglesVolume)));
    }
    soundEffects.setCardsVolume(cardsVolume / 100);
    soundEffects.setJinglesVolume(jinglesVolume / 100);
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
    if (trickResultSoundTimer) {
      clearTimeout(trickResultSoundTimer);
      trickResultSoundTimer = null;
    }
    if (turnReminderTimer) {
      clearTimeout(turnReminderTimer);
      turnReminderTimer = null;
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

  $: isTrickResolving =
    !!$gameState &&
    $gameState.state === 'tricks' &&
    $gameState.currentTrick.length === $gameState.players.length &&
    $gameState.players.length > 0;

  $: isLocalTurn =
    !!$gameState &&
    !!$localPlayer &&
    ($gameState.state === 'bidding' || $gameState.state === 'tricks') &&
    !isTrickResolving &&
    currentPlayerId === $localPlayer.playerId;

  $: isLocalTurnToPlay = !!$gameState && !!$localPlayer && $gameState.state === 'tricks' && isLocalTurn;

  $: {
    if (isLocalTurnToPlay && !previousIsLocalTurnToPlay) {
      soundEffects.playYourGo();
    }
    previousIsLocalTurnToPlay = isLocalTurnToPlay;
  }

  $: if (isLocalTurnToPlay) {
    showTurnReminder = false;
    if (turnReminderTimer) clearTimeout(turnReminderTimer);
    turnReminderTimer = setTimeout(() => {
      if (isLocalTurnToPlay) {
        showTurnReminder = true;
        soundEffects.playYourTurn();
      }
    }, 20000);
  } else {
    showTurnReminder = false;
    if (turnReminderTimer) {
      clearTimeout(turnReminderTimer);
      turnReminderTimer = null;
    }
  }

  function setGameSpeed(speed: 'slow' | 'normal' | 'fast') {
    socket.emit('set_game_speed', { roomId: $roomId, gameSpeed: speed });
  }

  function setCardsVolume(next: number) {
    cardsVolume = Math.max(0, Math.min(100, next));
    localStorage.setItem('cardsVolume', String(cardsVolume));
    soundEffects.setCardsVolume(cardsVolume / 100);
  }

  function setJinglesVolume(next: number) {
    jinglesVolume = Math.max(0, Math.min(100, next));
    localStorage.setItem('jinglesVolume', String(jinglesVolume));
    soundEffects.setJinglesVolume(jinglesVolume / 100);
  }

  $: if ($gameState?.state === 'tricks') {
    const currentTrickLength = $gameState.currentTrick.length;
    const numPlayers = $gameState.players?.length || 0;
    // Play trick result as soon as all cards are on table (during resolve delay).
    if (previousTrickLength < numPlayers && currentTrickLength === numPlayers && numPlayers > 0) {
      const winner = $gameState.players[$gameState.currentPlayer];
      if (winner) {
        if (trickResultSoundTimer) {
          clearTimeout(trickResultSoundTimer);
          trickResultSoundTimer = null;
        }
        if ($localPlayer) {
          trickResultSoundTimer = setTimeout(() => {
            if (winner.playerId === $localPlayer!.playerId) {
              soundEffects.playTrickWin();
            } else {
              soundEffects.playTrickLose();
            }
            trickResultSoundTimer = null;
          }, 500);
        } else {
          trickResultSoundTimer = setTimeout(() => {
            soundEffects.playTrickWin();
            trickResultSoundTimer = null;
          }, 500);
        }
      }
    }
    // Trigger collect animation when a trick resolves (full trick -> cleared table).
    if (previousTrickLength === numPlayers && currentTrickLength === 0 && numPlayers > 0) {
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
      }, scaleMs(1650));
      setTimeout(() => {
        turnPulsePlayerId = null;
      }, scaleMs(1300));
      setTimeout(() => {
        showWinner = false;
        winnerMessage = null;
      }, scaleMs(2000));
    }
    previousTrickLength = currentTrickLength;
  } else {
    previousTrickLength = 0;
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
        }, scaleMs(1600));
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

  $: if ($gameState) {
    if ($gameState.state === 'bidding' && previousState !== 'bidding') {
      soundEffects.playRoundHandStart();
    }
    if (!previousIsBiddingLocal && isBiddingLocal) {
      soundEffects.playBidDisplay();
    }
    if (
      previousState === 'tricks' &&
      $gameState.state === 'round_end' &&
      previousRoundNumber > 0 &&
      $gameState.roundNumber >= previousRoundNumber
    ) {
      if ($localPlayer && typeof $localPlayer.bid === 'number') {
        if ($localPlayer.bid === $localPlayer.tricksWon) {
          soundEffects.playHandWin();
        } else {
          soundEffects.playHandLose();
        }
      } else {
        soundEffects.playRoundWin();
      }
    }
    previousState = $gameState.state;
    previousRoundNumber = $gameState.roundNumber;
    previousIsBiddingLocal = isBiddingLocal;
  }

  $: if ($localPlayer && $gameState?.state === 'tricks') {
    const currentSize = $localPlayer.hand.length;
    if (currentSize < previousLocalHandSize) {
      soundEffects.playCard();
    }
    previousLocalHandSize = currentSize;
  } else if ($localPlayer) {
    previousLocalHandSize = $localPlayer.hand.length;
  } else {
    previousLocalHandSize = 0;
  }

  $: localLedSuitToFollow =
    $gameState &&
    $gameState.state === 'tricks' &&
    isLocalTurnToPlay &&
    $gameState.currentTrick.length > 0
      ? $gameState.currentTrick[0].card.suit
      : null;
  $: localHasOnlyOnePlayableSuit =
    !!localLedSuitToFollow &&
    !!$localPlayer &&
    $localPlayer.hand.some((c) => c.card.suit === localLedSuitToFollow);

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
    if (isLocalTurnToPlay) return 'Your turn to play';
    const cp = $gameState.currentPlayer;
    if (cp === undefined || !$gameState.players[cp]) return '';
    const name = getAvatarData($gameState.players[cp].selectedAvatar).name;
    if ($gameState.state === 'bidding') return `${name} is selecting their bid...`;
    if ($gameState.state === 'tricks') return `${name}'s turn to play`;
    if ($gameState.state === 'round_end') return `Round ${$gameState.roundNumber} complete`;
    return '';
  })();

  $: roundEndRows = $gameState
    ? $gameState.players
        .map((player) => {
          const bid = player.bid ?? 0;
          const tricks = player.tricksWon;
          const isSuccess = bid === tricks;
          const playerIndex = $gameState.players.findIndex((p) => p.playerId === player.playerId);
          const totalScore = $gameState.scoreboard?.[playerIndex] ?? 0;
          return { player, bid, tricks, isSuccess, totalScore };
        })
        .sort((a, b) => b.totalScore - a.totalScore)
    : [];
</script>

{#if $gameState}
  <div
    class="gameboard"
    class:modal-bidding={isBiddingLocal}
    class:bidding-phase={isBiddingPhase}
  >
    <!-- Fixed top bar: always present. Settings stays available in all phases. -->
    <header class="top-bar top-bar-fixed" class:centered={isBiddingPhase}>
      <div class="action-announcer" class:your-turn={isLocalTurn} role="status" aria-live="polite">
        {announcerText || '\u00A0'}
      </div>
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
        {#if !isBiddingPhase}
          <button
            type="button"
            class="scoreboard-toggle"
            aria-label="Toggle scoreboard"
            aria-expanded={scoreboardOpen}
            on:click={toggleScoreboard}
          >
            <span class="scoreboard-icon" aria-hidden="true">📊</span>
          </button>
        {/if}
      </div>
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
          <div class="ui-scale-group">
            <div class="ui-scale-label">Game Speed</div>
            <div class="ui-scale-options">
              <button type="button" class="ui-scale-btn" class:active={gameSpeed === 'slow'} on:click={() => setGameSpeed('slow')}>Slow</button>
              <button type="button" class="ui-scale-btn" class:active={gameSpeed === 'normal'} on:click={() => setGameSpeed('normal')}>Normal</button>
              <button type="button" class="ui-scale-btn" class:active={gameSpeed === 'fast'} on:click={() => setGameSpeed('fast')}>Fast</button>
            </div>
          </div>
          <div class="ui-scale-group">
            <div class="ui-scale-label">FX ({cardsVolume}%)</div>
            <div class="volume-options">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                bind:value={cardsVolume}
                on:input={() => setCardsVolume(cardsVolume)}
                aria-label="Cards volume"
              />
            </div>
          </div>
          <div class="ui-scale-group">
            <div class="ui-scale-label">Music ({jinglesVolume}%)</div>
            <div class="volume-options">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                bind:value={jinglesVolume}
                on:input={() => setJinglesVolume(jinglesVolume)}
                aria-label="Jingles volume"
              />
            </div>
          </div>
          <button type="button" class="settings-end-game-btn" on:click={cancelGame}>End Game</button>
          <button type="button" class="settings-close-btn" on:click={closeSettings}>Close</button>
        </div>
      </div>
    {/if}

    <div class="gameboard-content">
      {#if isBiddingPhase && showBidAnnouncement && bidAnnouncementText}
        <div class="bid-banner">{bidAnnouncementText}</div>
      {/if}
      {#if showTurnReminder}
        <div class="turn-reminder-banner">It's your turn to play</div>
      {/if}
      {#if isBiddingLocal}
        <BidModal
          gameState={$gameState}
          localPlayer={$localPlayer}
          {biddingSequence}
          forbiddenBid={getForbiddenBid()}
          sortHand={getSortedHand}
          on:bid={(e) => {
            soundEffects.playBidReceived();
            socket.emit('submit_bid', {
              roomId: $gameState.roomId,
              playerIndex: $gameState.currentPlayer,
              bid: e.detail.bid
            });
          }}
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
                      style="z-index: {isTrickResolving && index === winningIndex ? 120 : index + 1};"
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
                {#if isTrickResolving}
                  {@const winningIndex = getWinningCardIndex()}
                  {@const winnerCard = winningIndex >= 0 ? $gameState.currentTrick[winningIndex] : null}
                  {@const winnerPlayer = winnerCard ? $gameState.players.find((p) => p.playerId === winnerCard.playerId) : null}
                  {#if winnerCard && winnerPlayer}
                    <div class="led-suit-indicator">
                      {getAvatarData(winnerPlayer.selectedAvatar).name} wins with {winnerCard.card.value} <span
                        class="suit-name"
                        class:red-suit={winnerCard.card.suit === 'hearts' || winnerCard.card.suit === 'diamonds'}
                        >{getSuitSymbol(winnerCard.card.suit)}</span
                      >
                    </div>
                  {/if}
                {:else}
                  {@const ledSuit = getLedSuit()}
                  {#if ledSuit}
                    <div class="led-suit-indicator">
                      {getTrickLeaderName() || 'Leader'} led suit: <span
                        class="suit-name"
                        class:red-suit={ledSuit === 'hearts' || ledSuit === 'diamonds'}
                        >{ledSuit}</span
                      >
                    </div>
                  {/if}
                {/if}
              {/if}

              {#if showWinner && winnerMessage}
                <div class="winner-banner">{winnerMessage}</div>
              {/if}
            </div>
          </div>

          {#if showTrickCollect}
            <div
              class="trick-collect {trickCollectTargetClass}"
              style="--trick-collect-duration: {trickCollectAnimationMs}ms;"
              aria-hidden="true"
            >
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
            <div
              class="local-player-meta"
              class:active-turn={isLocalTurn}
              class:recent-winner={turnPulsePlayerId === $localPlayer.playerId}
            >
              <img src={getPlayerAvatarUrl($localPlayer)} alt="Your Avatar" class="local-avatar" />
              {#if !isBiddingPhase}
                <div class="player-hand-stats local-stats local-inline-stats">
                  <div class="stat-line">
                    <span class="stat-icon">🎯</span> Bid: {typeof $localPlayer.bid === 'number' ? $localPlayer.bid : '—'}
                  </div>
                  <div class="stat-line" class:warning-stat={isTricksWarning($localPlayer)}>
                    <span class="stat-icon">🃏</span> Tricks: {$localPlayer.tricksWon}
                  </div>
                </div>
              {/if}
            </div>
            <div class="hand hand-fanned local-hand" class:turn-highlight={isLocalTurnToPlay}>
              {#each getSortedHand($localPlayer.hand) as ownedCard, idx (ownedCard.card.id)}
                {@const len = $localPlayer.hand.length}
                {@const isFollowSuitCard = !!localLedSuitToFollow && ownedCard.card.suit === localLedSuitToFollow}
                <div
                  class="fanned-card"
                  class:follow-suit-front={localHasOnlyOnePlayableSuit && isFollowSuitCard}
                  style="
                    --card-offset: {idx - (len - 1) / 2};
                    --fan-lift: {Math.pow(Math.abs(idx - (len - 1) / 2), 2) * 1.6}px;
                    left: calc(50% - var(--hand-half, 35px) + var(--card-offset) * var(--hand-spread, 30px));
                    z-index: {localHasOnlyOnePlayableSuit && isFollowSuitCard ? idx + 120 : idx};
                    bottom: 0;
                    transform-origin: bottom center;
                    transform: rotate(calc(var(--card-offset) * var(--hand-rotate, 14deg))) translateY(calc(var(--hand-base-y, -8px) - var(--fan-lift)));
                  "
                >
                  <Card {ownedCard} />
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    </div>

    {#if $gameState?.state === 'round_end'}
      <div class="round-end-overlay">
        <div class="round-end-content">
          <h2>Round {$gameState.roundNumber} Complete!</h2>
          <div class="hand-end-summary">
            <div class="hand-end-header">
              <span>Player</span>
              <span>Bid</span>
              <span>Tricks</span>
              <span>Total points</span>
            </div>
            {#each roundEndRows as row (row.player.playerId)}
              <div class="hand-end-row" class:success={row.isSuccess} class:failure={!row.isSuccess}>
                <span class="hand-end-player">
                  <img src={row.player.inGameAvatar || getPlayerAvatarUrl(row.player)} alt="" class="hand-end-avatar" />
                  {getAvatarData(row.player.selectedAvatar).name}
                </span>
                <span class="hand-end-num">{row.bid}</span>
                <span class="hand-end-num">{row.tricks}</span>
                <span class="hand-end-total">{row.totalScore}</span>
              </div>
            {/each}
          </div>
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
    justify-content: flex-start;
    padding-right: 3.35rem;
  }
  .top-bar.centered .top-bar-actions {
    position: absolute;
    right: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
  }
  .top-bar.centered .action-announcer {
    margin: 0 auto;
    max-width: min(86vw, 640px);
    width: 100%;
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
  .action-announcer.your-turn {
    background: linear-gradient(180deg, #ffe68a 0%, #ffd347 100%);
    color: #2d2a1f;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55);
    box-shadow: 0 3px 12px rgba(255, 211, 71, 0.42);
    border: 1px solid rgba(191, 144, 0, 0.45);
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
  .ui-scale-group {
    margin-bottom: 0.7rem;
  }
  .ui-scale-label {
    font-size: 0.8rem;
    color: #5f7183;
    margin-bottom: 0.3rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .ui-scale-options {
    display: flex;
    gap: 0.35rem;
  }
  .volume-options {
    display: flex;
    align-items: center;
  }
  .volume-options input[type='range'] {
    width: 100%;
    accent-color: #004c8c;
    cursor: pointer;
  }
  .ui-scale-btn {
    flex: 1;
    border: 1px solid rgba(44, 62, 80, 0.22);
    background: #fff;
    color: #2c3e50;
    border-radius: 8px;
    padding: 0.35rem 0.45rem;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
  }
  .ui-scale-btn.active {
    background: #004c8c;
    color: #fff;
    border-color: #004c8c;
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
    margin-left: clamp(-6px, -1vw, -2px);
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
  }
  .played-card.winning-card :global(.card) {
    box-shadow:
      0 6px 18px rgba(255, 215, 0, 0.45),
      0 0 0 3px rgba(255, 215, 0, 0.92);
    border-color: rgba(255, 215, 0, 0.95);
    border-radius: clamp(4px, 1vw, 6px);
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
    bottom: clamp(-6px, 0.8vh, 6px);
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
    bottom: clamp(-42px, -2.6vh, -18px);
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.9);
    padding: clamp(0.38rem, 1.2vw, 0.5rem) clamp(0.7rem, 2.2vw, 0.95rem);
    border-radius: clamp(8px, 2vw, 12px);
    font-size: clamp(0.82rem, 2.1vw, 0.95rem);
    font-weight: 700;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
    z-index: 25;
    text-align: center;
    white-space: nowrap;
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
  .turn-reminder-banner {
    position: absolute;
    bottom: clamp(210px, 37vh, 300px);
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(165deg, #ffe9a9 0%, #ffd66a 100%);
    color: #2d2a1f;
    border: 1px solid rgba(183, 132, 15, 0.55);
    border-radius: 10px;
    padding: 0.42rem 0.86rem;
    font-size: clamp(0.82rem, 2.2vw, 0.98rem);
    font-weight: 700;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.62),
      0 9px 20px rgba(255, 207, 92, 0.34);
    z-index: 36;
    pointer-events: none;
    animation: bidBannerPop 0.22s ease-out;
    max-width: min(84vw, 340px);
    text-align: center;
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
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: clamp(0.25rem, 0.8vh, 0.55rem);
    width: 100%;
    max-width: 100vw;
    padding: 0.25rem 0.35rem max(1rem, 3vh);
    box-sizing: border-box;
    z-index: 10;
    min-height: 0;
  }
  .local-player-meta {
    position: relative;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    align-self: center;
    gap: clamp(0.35rem, 1vw, 0.6rem);
    min-width: 0;
    margin-bottom: 0;
    margin-top: 0.1rem;
    margin-bottom: clamp(0.32rem, 0.9vh, 0.52rem);
    padding-right: 0;
  }
  .local-avatar {
    width: clamp(46px, 9vw, 66px);
    height: clamp(46px, 9vw, 66px);
    border-radius: 50%;
    border: clamp(2px, 0.5vw, 3px) solid #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    margin-bottom: 0;
    background: transparent;
    object-fit: contain;
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
    max-width: calc(100vw - 0.7rem);
    width: 100%;
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
    animation: trickCollectTravel var(--trick-collect-duration, 1250ms) cubic-bezier(0.2, 0.75, 0.2, 1) forwards;
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
    animation: trickCollectCollapse var(--trick-collect-duration, 1250ms) cubic-bezier(0.2, 0.75, 0.2, 1) forwards;
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
    width: 100%;
    min-width: 0;
    max-width: calc(100vw - 1.2rem);
  }
  .local-hand {
    --hand-half: clamp(30px, 6vw, 46px);
    --hand-spread: clamp(34px, 5.4vw, 46px);
    --hand-rotate: 11deg;
    --hand-base-y: -8px;
  }
  .local-inline-stats {
    margin-top: 0;
    align-items: flex-start;
    padding: 0.22rem 0.52rem;
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
  .fanned-card.follow-suit-front {
    filter: saturate(1.08) brightness(1.02);
  }
  .local-player-panel :global(.card) {
    width: clamp(56px, 11.8vw, 76px);
    height: clamp(84px, 17.8vw, 114px);
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
    max-width: 680px;
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

  .hand-end-summary {
    margin-top: 0.35rem;
    margin-bottom: 0.75rem;
    border: 1px solid rgba(136, 164, 201, 0.3);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.74);
    padding: 0.6rem 0.55rem;
  }
  .hand-end-header,
  .hand-end-row {
    display: grid;
    grid-template-columns: minmax(112px, 1.8fr) minmax(36px, 0.6fr) minmax(48px, 0.72fr) minmax(70px, 0.9fr);
    gap: 0.35rem;
    align-items: center;
  }
  .hand-end-header {
    color: #5f748d;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 0.2rem 0.42rem 0.35rem;
    border-bottom: 1px solid rgba(120, 146, 177, 0.24);
    margin-bottom: 0.25rem;
  }
  .hand-end-header span:not(:first-child) {
    text-align: center;
  }
  .hand-end-row {
    padding: 0.44rem 0.42rem;
    border-radius: 10px;
    border: 1px solid rgba(120, 146, 177, 0.16);
    margin-bottom: 0.26rem;
    background: rgba(255, 255, 255, 0.72);
  }
  .hand-end-row.success {
    background: linear-gradient(165deg, rgba(226, 248, 233, 0.9), rgba(213, 243, 223, 0.84));
    border-color: rgba(79, 174, 109, 0.32);
  }
  .hand-end-row.failure {
    background: linear-gradient(165deg, rgba(255, 234, 237, 0.9), rgba(255, 220, 224, 0.82));
    border-color: rgba(227, 77, 96, 0.34);
  }
  .hand-end-player {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    min-width: 0;
    font-weight: 700;
    color: #2c4058;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hand-end-avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid rgba(68, 96, 132, 0.24);
    object-fit: contain;
    flex: 0 0 auto;
  }
  .hand-end-num,
  .hand-end-total {
    text-align: center;
    font-weight: 800;
    color: #2a4563;
  }

  @media (max-width: 600px) {
    .hand-end-header,
    .hand-end-row {
      grid-template-columns: minmax(92px, 1.7fr) minmax(32px, 0.58fr) minmax(42px, 0.68fr) minmax(66px, 0.86fr);
      gap: 0.26rem;
    }
    .hand-end-header {
      font-size: 0.66rem;
    }
    .hand-end-row {
      font-size: 0.88rem;
      padding: 0.38rem 0.28rem;
    }
    .hand-end-avatar {
      width: 20px;
      height: 20px;
    }
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
      bottom: clamp(-34px, -2vh, -14px);
      padding: 0.34rem 0.64rem;
      font-size: clamp(0.76rem, 2.2vw, 0.9rem);
      max-width: min(78vw, 300px);
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
      padding: 0.25rem 0.55rem max(0.7rem, 2vh);
      gap: 0.35rem;
    }
    .local-player-meta {
      align-self: center;
      padding-right: 0.1rem;
      gap: 0.35rem;
    }
    .local-avatar {
      width: clamp(46px, 10vw, 66px);
      height: clamp(46px, 10vw, 66px);
    }
    .hand-fanned {
      min-width: 0;
      max-width: calc(100vw - 1.1rem);
      height: clamp(84px, 16vh, 110px);
    }
    .played-card {
      width: clamp(48px, 10vw, 68px);
      height: clamp(72px, 14vw, 100px);
    }
    .winner-banner {
      bottom: clamp(-30px, -1.8vh, -10px);
      max-width: min(84vw, 280px);
      font-size: clamp(0.72rem, 2.4vw, 0.86rem);
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
      padding: 0.2rem 0.2rem max(0.5rem, 1.5vh);
    }
    .local-avatar { width: 42px; height: 42px; }
    .hand-fanned {
      min-width: 0;
      max-width: calc(100vw - 1.2rem);
      height: clamp(78px, 14vh, 98px);
    }
    .opponents {
      height: clamp(80px, 24%, 140px);
    }
    .table-zone {
      top: clamp(80px, 24%, 140px);
    }
    .winner-banner {
      max-width: min(88vw, 260px);
      font-size: clamp(0.7rem, 2.9vw, 0.82rem);
      padding: 0.3rem 0.55rem;
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

  .gameboard {
    background:
      radial-gradient(120% 90% at 50% 42%, rgba(30, 150, 97, 0.5), rgba(9, 66, 42, 0.55) 60%),
      linear-gradient(150deg, #0a5134 0%, #0a3f2c 52%, #072f24 100%);
  }

  .top-bar-fixed {
    background: linear-gradient(165deg, rgba(7, 40, 30, 0.86), rgba(8, 53, 38, 0.82));
    border-bottom: 1px solid rgba(176, 231, 206, 0.22);
    box-shadow: 0 10px 24px rgba(3, 14, 11, 0.4);
    backdrop-filter: blur(12px);
  }

  .action-announcer {
    background: linear-gradient(170deg, rgba(5, 27, 20, 0.72), rgba(9, 43, 32, 0.72));
    border: 1px solid rgba(176, 231, 206, 0.22);
    border-radius: 999px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      0 8px 20px rgba(0, 0, 0, 0.3);
  }

  .action-announcer.your-turn {
    background: linear-gradient(165deg, #ffe9a9 0%, #ffd66a 100%);
    border-color: rgba(183, 132, 15, 0.55);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.65),
      0 9px 20px rgba(255, 207, 92, 0.38);
  }

  .settings-toggle,
  .scoreboard-toggle {
    border-radius: 11px;
    border: 1px solid rgba(185, 238, 214, 0.25);
    background: linear-gradient(160deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.1));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.28),
      0 7px 16px rgba(0, 0, 0, 0.25);
    transition:
      transform 130ms ease,
      background 180ms ease,
      box-shadow 180ms ease;
  }

  .settings-toggle:hover,
  .scoreboard-toggle:hover {
    transform: translateY(-1px);
    background: linear-gradient(160deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.17));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.35),
      0 10px 20px rgba(0, 0, 0, 0.28);
  }

  .settings-panel,
  .scoreboard-overlay-panel,
  .round-end-content {
    border-radius: 18px;
    border: 1px solid rgba(147, 172, 208, 0.35);
    background:
      radial-gradient(120% 100% at 12% -20%, rgba(255, 255, 255, 0.86), rgba(255, 255, 255, 0) 56%),
      linear-gradient(160deg, rgba(247, 250, 255, 0.94), rgba(233, 240, 249, 0.92));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.9),
      0 20px 40px rgba(12, 31, 56, 0.28);
    backdrop-filter: blur(10px);
  }

  .opponent-seat .opponent-name,
  .local-name {
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .player-hand-stats {
    background: linear-gradient(170deg, rgba(8, 33, 24, 0.56), rgba(9, 27, 21, 0.48));
    border: 1px solid rgba(190, 241, 218, 0.2);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 8px 16px rgba(0, 0, 0, 0.25);
  }

  .opponent-avatar,
  .local-avatar {
    box-shadow:
      0 12px 20px rgba(4, 20, 13, 0.33),
      0 0 0 1px rgba(255, 255, 255, 0.24);
  }

  .table {
    background:
      radial-gradient(130% 100% at 50% 35%, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0) 64%),
      linear-gradient(170deg, rgba(7, 37, 26, 0.4), rgba(4, 23, 16, 0.46));
    border-radius: 18px;
    border: 1px solid rgba(170, 230, 203, 0.18);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.1),
      0 16px 30px rgba(0, 0, 0, 0.28);
  }

  .led-suit-indicator,
  .winner-banner,
  .bid-banner,
  .turn-reminder-banner {
    border-radius: 12px;
    border: 1px solid rgba(133, 162, 199, 0.34);
    box-shadow: 0 10px 22px rgba(13, 35, 59, 0.24);
  }

  .hand-fanned.turn-highlight {
    border: 1px solid rgba(164, 243, 202, 0.46);
    background:
      radial-gradient(90% 95% at 50% 85%, rgba(123, 221, 170, 0.27), rgba(14, 66, 43, 0.18) 70%),
      linear-gradient(180deg, rgba(18, 94, 60, 0.3), rgba(10, 62, 39, 0.42));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.16),
      0 0 0 2px rgba(50, 143, 100, 0.36),
      0 14px 25px rgba(0, 0, 0, 0.28);
  }

  .fanned-card {
    border-radius: 10px;
  }

  .fanned-card:hover {
    box-shadow:
      0 9px 16px rgba(0, 0, 0, 0.25),
      0 0 0 2px rgba(255, 255, 255, 0.68);
  }

  .next-round-button,
  .settings-close-btn,
  .settings-end-game-btn,
  .ui-scale-btn {
    transition:
      transform 120ms ease,
      box-shadow 180ms ease,
      background 180ms ease,
      border-color 180ms ease;
  }

  .next-round-button {
    background: linear-gradient(165deg, #286ee7 0%, #1f58c7 100%);
    box-shadow: 0 10px 22px rgba(24, 81, 186, 0.34);
  }

  .next-round-button:hover {
    background: linear-gradient(165deg, #2f76f1 0%, #245fce 100%);
    transform: translateY(-1px);
  }
</style>
