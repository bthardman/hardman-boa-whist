<script lang="ts">
  import { gameState, localPlayer, localPlayerIndex, roomId } from '../store';
  import { onMount, onDestroy, tick } from 'svelte';
  import { fly, fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import type { Player } from '../../shared/types';
  import Card from './Card.svelte';
  import Seat from './Seat.svelte';
  import BidModal from './BidModal.svelte';
  import Scoreboard from './Scoreboard.svelte';
  import SettingsSheet from './SettingsSheet.svelte';
  import Icon from './ui/Icon.svelte';
  import { socket } from '../socket';
  import { getAvatarData } from '../avatarData';
  import { getPlayerAvatarUrl } from '../avatarUtils';
  import { startAvatarSwap, stopAllAvatarSwaps } from '../utils/avatarManager';
  import {
    SUIT_SYMBOL,
    TRICKS_PER_ROUND,
    bidInTrouble,
    calculateTrickWinner,
    getForbiddenBid,
    isRedSuit,
    sortHand,
    totalBids
  } from '../utils/gameUtils';
  import { soundEffects } from '../utils/soundEffects';
  import { turnFlash, textSize } from '../utils/prefs';

  const ROUND_SUMMARY_MS = 15000;
  const TURN_REMINDER_MS = 20000;

  let scoreboardOpen = false;
  let settingsOpen = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  /** setTimeout that is cleared automatically when the board unmounts. */
  function later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  }

  // ---- Game pace (mirrors the server's timing so animations line up) ----
  $: gameSpeed = $gameState?.gameSpeed ?? 'normal';
  function scaleMs(ms: number): number {
    const m = gameSpeed === 'slow' ? 1.35 : gameSpeed === 'fast' ? 0.7 : 1;
    return Math.max(120, Math.round(ms * m));
  }

  // ---- Derived game facts ----
  $: state = $gameState;
  $: players = state?.players ?? [];
  $: phase = state?.state;
  $: isBiddingPhase = phase === 'bidding';
  $: currentPlayer = state ? players[state.currentPlayer] : undefined;
  $: isTrickResolving = phase === 'tricks' && players.length > 0 && (state?.currentTrick.length ?? 0) === players.length;
  $: isLocalTurn =
    !!$localPlayer &&
    (phase === 'bidding' || phase === 'tricks') &&
    !isTrickResolving &&
    currentPlayer?.playerId === $localPlayer.playerId;
  $: isBiddingLocal = isBiddingPhase && isLocalTurn;
  $: isLocalTurnToPlay = phase === 'tricks' && isLocalTurn;
  $: opponents = (() => {
    const n = players.length;
    if (n <= 1 || $localPlayerIndex < 0) return players.filter((p) => p.playerId !== $localPlayer?.playerId);
    // Clockwise from the player after you, so the table reads in play order left to right.
    return Array.from({ length: n - 1 }, (_, i) => players[($localPlayerIndex + 1 + i) % n]);
  })();
  $: trick = state?.currentTrick ?? [];
  $: winningIndex = calculateTrickWinner(trick);
  $: ledSuit = trick[0]?.card.suit ?? null;
  $: hand = $localPlayer ? sortHand($localPlayer.hand) : [];
  $: mustFollow = isLocalTurnToPlay && !!ledSuit && hand.some((c) => c.card.suit === ledSuit);

  function nameOf(player: Player | undefined): string {
    return player ? getAvatarData(player.selectedAvatar)?.name ?? 'Player' : 'Player';
  }
  function playerById(id: string): Player | undefined {
    return players.find((p) => p.playerId === id);
  }

  $: statusText = (() => {
    if (!state) return '';
    if (isBiddingLocal) return 'Your turn to bid';
    if (isLocalTurnToPlay) return mustFollow ? `Your turn: follow ${ledSuit}` : trick.length ? 'Your turn to play' : 'Your turn to lead';
    if (isTrickResolving) {
      const w = trick[winningIndex];
      return w ? `${nameOf(playerById(w.playerId))} takes the trick` : '';
    }
    if (phase === 'bidding') return `${nameOf(currentPlayer)} is choosing a bid`;
    if (phase === 'tricks') return trick.length ? `${nameOf(currentPlayer)} to play` : `${nameOf(currentPlayer)} to lead`;
    if (phase === 'round_end') return `Round ${state.roundNumber} finished`;
    return '';
  })();

  // ---- Hand layout: size and fan the cards to fit the space available ----
  let handWidth = 360;
  let viewportH = 800;
  let viewportW = 1024;
  $: isTablet = viewportW >= 700 && viewportH >= 700;
  $: cardW = Math.round(Math.max(58, Math.min(isTablet ? 132 : 108, handWidth / 4.6, viewportH * 0.15)));
  // Short "1/2" tallies only when seats are squeezed; otherwise spell out "Won 1 of 2".
  $: textScale = $textSize === 'largest' ? 1.3 : $textSize === 'large' ? 1.15 : 1;
  // Short landscape tablets put each opponent's details beside their avatar (see the CSS), so seats are wider.
  $: isShortLandscape = viewportW > viewportH && viewportW >= 700 && viewportH >= 521 && viewportH < 700;
  $: seatWidth = isShortLandscape ? 190 : isTablet ? 150 : 95;
  $: compactSeats = opponents.length * seatWidth * textScale > viewportW;
  $: spread = hand.length > 1 ? Math.min(cardW * 0.72, (handWidth - cardW - 36) / (hand.length - 1)) : 0;

  // ---- Screen-edge flash when your turn starts ----
  let flashKey = 0;
  function triggerTurnFlash() {
    if (!$turnFlash) return;
    flashKey += 1;
    const k = flashKey;
    later(() => {
      if (flashKey === k) flashKey = 0;
    }, scaleMs(1000));
  }

  // ---- Your-turn sound, flash and 20s reminder ----
  let prevLocalTurnToPlay = false;
  let showTurnReminder = false;
  let reminderTimer: ReturnType<typeof setTimeout> | null = null;
  $: {
    if (isLocalTurnToPlay && !prevLocalTurnToPlay) {
      soundEffects.playYourGo();
      triggerTurnFlash();
      showTurnReminder = false;
      if (reminderTimer) clearTimeout(reminderTimer);
      reminderTimer = later(() => {
        showTurnReminder = true;
        soundEffects.playYourTurn();
      }, TURN_REMINDER_MS);
    }
    if (!isLocalTurnToPlay && prevLocalTurnToPlay) {
      showTurnReminder = false;
      if (reminderTimer) clearTimeout(reminderTimer);
      reminderTimer = null;
    }
    prevLocalTurnToPlay = isLocalTurnToPlay;
  }

  // ---- Bid announcements ("Carol bid 2") ----
  let announcement: string | null = null;
  let announcementTimer: ReturnType<typeof setTimeout> | null = null;
  let prevBids: Record<string, number | undefined> = {};
  $: if (state) {
    if (phase === 'bidding') {
      const newlyBid = players.find((p) => typeof p.bid === 'number' && typeof prevBids[p.playerId] !== 'number');
      if (newlyBid && newlyBid.playerId !== $localPlayer?.playerId) {
        announcement = `${nameOf(newlyBid)} bid ${newlyBid.bid}`;
        if (announcementTimer) clearTimeout(announcementTimer);
        announcementTimer = later(() => (announcement = null), scaleMs(1800));
      }
      prevBids = Object.fromEntries(players.map((p) => [p.playerId, p.bid]));
    } else {
      prevBids = {};
      announcement = null;
    }
  }

  // ---- Phase-change sounds ----
  let prevPhase: string | undefined;
  let prevBiddingLocal = false;
  $: if (state) {
    if (phase === 'bidding' && prevPhase !== 'bidding') soundEffects.playRoundHandStart();
    if (isBiddingLocal && !prevBiddingLocal) {
      soundEffects.playBidDisplay();
      triggerTurnFlash();
    }
    if (prevPhase === 'tricks' && phase === 'round_end' && $localPlayer) {
      if (typeof $localPlayer.bid === 'number' && $localPlayer.bid === $localPlayer.tricksWon) soundEffects.playHandWin();
      else soundEffects.playHandLose();
    }
    prevPhase = phase;
    prevBiddingLocal = isBiddingLocal;
  }

  // ---- Card played sound (any player) ----
  let prevTrickLength = 0;
  let prevRound = 0;
  $: if (state) {
    const len = trick.length;
    if (phase === 'tricks' && len > prevTrickLength && state.roundNumber === prevRound) soundEffects.playCard();
    prevTrickLength = phase === 'tricks' ? len : 0;
    prevRound = state.roundNumber;
  }

  // ---- Trick result: sound when the last card lands, then sweep the cards to the winner ----
  let resolvedKey = '';
  let trickWinnerId: string | null = null;
  let collect: { fromX: number; fromY: number; toX: number; toY: number; count: number } | null = null;
  let tableEl: HTMLElement;
  let boardEl: HTMLElement;

  $: if (isTrickResolving && state) {
    const key = `${state.roundNumber}-${state.players.map((p) => p.hand.length).join('')}`;
    if (key !== resolvedKey) {
      resolvedKey = key;
      const winnerCard = trick[winningIndex];
      trickWinnerId = winnerCard?.playerId ?? null;
      const youWon = trickWinnerId === $localPlayer?.playerId;
      later(() => (youWon ? soundEffects.playTrickWin() : soundEffects.playTrickLose()), 500);
    }
  }

  // A new round starts with nobody highlighted.
  $: if (phase !== 'tricks' && trickWinnerId && !collect) trickWinnerId = null;

  // When the table clears after a full trick, animate a little pile to the winner's seat.
  let wasResolving = false;
  $: {
    if (wasResolving && !isTrickResolving && phase === 'tricks' && trickWinnerId) void sweepTrickTo(trickWinnerId, players.length);
    wasResolving = isTrickResolving;
  }

  async function sweepTrickTo(winnerId: string, count: number) {
    await tick();
    const seatEl = boardEl?.querySelector(`[data-seat-id="${winnerId}"] .portrait`);
    if (!seatEl || !tableEl) return;
    const from = tableEl.getBoundingClientRect();
    const to = seatEl.getBoundingClientRect();
    collect = {
      fromX: from.left + from.width / 2,
      fromY: from.top + from.height / 2,
      toX: to.left + to.width / 2,
      toY: to.top + to.height / 2,
      count
    };
    const highlightId = winnerId;
    later(() => {
      collect = null;
    }, scaleMs(900));
    later(() => {
      if (trickWinnerId === highlightId) trickWinnerId = null;
    }, scaleMs(1600));
  }

  // ---- Round summary countdown ----
  let summaryEndsAt = 0;
  let now = Date.now();
  let clock: ReturnType<typeof setInterval> | null = null;
  $: if (phase === 'round_end' && !summaryEndsAt) {
    summaryEndsAt = Date.now() + scaleMs(ROUND_SUMMARY_MS);
    clock = setInterval(() => (now = Date.now()), 250);
  } else if (phase !== 'round_end' && summaryEndsAt) {
    summaryEndsAt = 0;
    if (clock) clearInterval(clock);
    clock = null;
  }
  $: secondsLeft = Math.max(0, Math.ceil((summaryEndsAt - now) / 1000));
  $: roundRows = state
    ? players
        .map((player, index) => ({
          player,
          bid: player.bid ?? 0,
          won: player.tricksWon,
          made: (player.bid ?? 0) === player.tricksWon,
          total: state?.scoreboard?.[index] ?? 0
        }))
        .sort((a, b) => b.total - a.total)
    : [];

  // ---- Offline player: their turn is played automatically, or anyone can do it now ----
  $: absentPlayer =
    (phase === 'bidding' || phase === 'tricks') && !isTrickResolving && currentPlayer?.disconnected && currentPlayer.playerId !== $localPlayer?.playerId
      ? currentPlayer
      : undefined;
  let absentClock: ReturnType<typeof setInterval> | null = null;
  let absentNow = Date.now();
  $: if (absentPlayer && !absentClock) {
    absentClock = setInterval(() => (absentNow = Date.now()), 500);
  } else if (!absentPlayer && absentClock) {
    clearInterval(absentClock);
    absentClock = null;
  }
  $: absentSeconds = state?.absentTurnDeadline ? Math.max(0, Math.ceil((state.absentTurnDeadline - absentNow) / 1000)) : null;

  function playForAbsent() {
    socket.emit('play_for_absent', { roomId: $roomId });
  }

  function dealNextRound() {
    socket.emit('next_round', { roomId: $roomId });
  }

  function submitBid(bid: number) {
    soundEffects.playBidReceived();
    socket.emit('submit_bid', { roomId: $roomId, bid });
  }

  onMount(() => {
    players.forEach((player) => startAvatarSwap(player));
  });

  onDestroy(() => {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    if (clock) clearInterval(clock);
    if (absentClock) clearInterval(absentClock);
    stopAllAvatarSwaps();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') scoreboardOpen = false;
  }
</script>

<svelte:window bind:innerHeight={viewportH} bind:innerWidth={viewportW} on:keydown={onKeydown} />

{#if state}
  <div class="board" class:my-turn={isLocalTurn} bind:this={boardEl}>
    {#key flashKey}
      {#if flashKey > 0}
        <div class="turn-flash" style="--flash-ms: {scaleMs(1000)}ms" aria-hidden="true"></div>
      {/if}
    {/key}

    <header class="topbar">
      <div class="round">
        <span class="round-label num">Round {state.roundNumber}</span>
        <span class="round-meta">
          <span class="round-target">First to {state.winningScore ?? 5}</span>
          <span class="trumps" title="Hearts are always trumps"><span class="red-suit" aria-hidden="true">♥</span> trumps</span>
        </span>
      </div>
      <!-- Turn status lives in the shared top bar so it never looks attached to a player's seat. -->
      <div class="status" class:mine={isLocalTurn} role="status" aria-live="polite">
        {#key statusText}
          <span in:fade={{ duration: 160 }}>{statusText || '\u00A0'}</span>
        {/key}
      </div>
      <div class="actions">
        <button class="icon-btn" type="button" aria-label="Scores" on:click={() => (scoreboardOpen = true)}>
          <Icon name="scores" />
        </button>
        <button class="icon-btn" type="button" aria-label="Settings" on:click={() => (settingsOpen = true)}>
          <Icon name="settings" />
        </button>
      </div>
    </header>

    <section class="opponents" style="--n: {opponents.length}" aria-label="Other players">
      {#each opponents as player (player.playerId)}
        <Seat
          {player}
          active={(isBiddingPhase || phase === 'tricks') && !isTrickResolving && currentPlayer?.playerId === player.playerId}
          justWon={trickWinnerId === player.playerId && !isTrickResolving}
          trouble={bidInTrouble(state, player)}
          showTricks={!isBiddingPhase}
          compact={compactSeats}
        />
      {/each}
    </section>

    <section class="table-zone">
      {#if isBiddingLocal && $localPlayer}
        <div class="bid-wrap" in:scale={{ start: 0.94, duration: 220, easing: backOut }}>
          <BidModal players={players} localPlayerId={$localPlayer.playerId} forbiddenBid={getForbiddenBid(state)} on:bid={(e) => submitBid(e.detail.bid)} />
        </div>
      {:else}
        <div class="felt" bind:this={tableEl}>
          {#if trick.length}
            <div class="trick" style="--n: {trick.length}; --card-w: {Math.min(cardW, 96)}px">
              {#each trick as played, i (played.card.id)}
                {@const owner = playerById(played.playerId)}
                <div
                  class="played"
                  class:winning={i === winningIndex}
                  class:losing={isTrickResolving && i !== winningIndex}
                  in:fly={{ y: played.playerId === $localPlayer?.playerId ? 80 : -80, duration: 280 }}
                >
                  <Card ownedCard={played} />
                  {#if owner}
                    <img class="owner avatar" src={getPlayerAvatarUrl(owner)} alt={nameOf(owner)} title={nameOf(owner)} />
                  {/if}
                </div>
              {/each}
            </div>
            <p class="caption">
              {#if isTrickResolving}
                {@const w = trick[winningIndex]}
                {nameOf(playerById(w.playerId))} wins with
                <strong class:red-suit={isRedSuit(w.card.suit)}>{w.card.value}{SUIT_SYMBOL[w.card.suit]}</strong>
              {:else if ledSuit}
                {nameOf(playerById(trick[0].playerId))} led
                <strong class:red-suit={isRedSuit(ledSuit)}>{SUIT_SYMBOL[ledSuit]} {ledSuit}</strong>
              {/if}
            </p>
          {:else if isBiddingPhase}
            <div class="table-note">
              <span class="big num">{totalBids(players)}<span class="of">/{TRICKS_PER_ROUND}</span></span>
              <span>tricks bid so far</span>
            </div>
          {:else if phase === 'tricks'}
            <div class="table-note quiet">
              <span>{TRICKS_PER_ROUND - Math.max(0, ...players.map((p) => p.hand.length))} of {TRICKS_PER_ROUND} tricks played</span>
            </div>
          {/if}
        </div>
      {/if}

      {#if absentPlayer}
        <div class="absent-note" transition:fly={{ y: -10, duration: 200 }} role="status">
          <span>
            {nameOf(absentPlayer)} has lost connection.
            {#if absentSeconds !== null}Their turn plays itself in <span class="num">{absentSeconds}</span>s.{/if}
          </span>
          <button class="btn btn-primary" type="button" on:click={playForAbsent}>Play for {nameOf(absentPlayer)} now</button>
        </div>
      {:else if announcement}
        <div class="pill-note" transition:fly={{ y: -10, duration: 200 }}>{announcement}</div>
      {/if}
      {#if showTurnReminder}
        <!-- In the layout flow (not floating) so it squeezes the table instead of covering the trick. -->
        <div class="pill-note urgent inline" transition:fly={{ y: 10, duration: 200 }}>Still your turn: tap a card to play it</div>
      {/if}
    </section>

    {#if $localPlayer}
      <section class="my-area" class:turn={isLocalTurnToPlay} aria-label="Your hand">
        <div class="me-seat">
          <Seat
            player={$localPlayer}
            isYou
            layout="row"
            active={isLocalTurn}
            justWon={trickWinnerId === $localPlayer.playerId && !isTrickResolving}
            trouble={bidInTrouble(state, $localPlayer)}
            showTricks={!isBiddingPhase}
          />
        </div>
        <div class="hand" bind:clientWidth={handWidth} style="--card-w: {cardW}px; height: {Math.round(cardW * 1.455 + 26)}px">
          {#each hand as owned, i (owned.card.id)}
            {@const offset = i - (hand.length - 1) / 2}
            <div
              class="fan"
              style="--x: {offset * spread}px; --r: {offset * 2.2}deg; --lift: {Math.abs(offset) * 1.5}px; z-index: {i + 1}"
              out:fly={{ y: -120, duration: 260 }}
            >
              <Card ownedCard={owned} interactive />
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if collect}
      <div class="collect" aria-hidden="true" style="--dur: {scaleMs(800)}ms; --dx: {collect.toX - collect.fromX}px; --dy: {collect.toY - collect.fromY}px; left: {collect.fromX}px; top: {collect.fromY}px">
        {#each Array.from({ length: collect.count }) as _, i}
          <img src="/cards/back.svg" alt="" style="--i: {i - (collect.count - 1) / 2}" />
        {/each}
      </div>
    {/if}

    {#if phase === 'round_end'}
      <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="round-title">
        <div class="sheet summary">
          <h2 id="round-title">Round {state.roundNumber} scores</h2>
          <p class="summary-sub">Hit your bid exactly to score a point.</p>
          <table>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Bid</th>
                <th scope="col">Won</th>
                <th scope="col"><span class="visually-hidden">Result</span></th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {#each roundRows as row (row.player.playerId)}
                <tr class:made={row.made} class:me={row.player.playerId === $localPlayer?.playerId}>
                  <td class="who">
                    <img class="avatar" src={getPlayerAvatarUrl(row.player)} alt="" />
                    {nameOf(row.player)}
                  </td>
                  <td class="num">{row.bid}</td>
                  <td class="num">{row.won}</td>
                  <td class="result">
                    {#if row.made}
                      <span class="tag made"><Icon name="check" size={14} /> +1</span>
                    {:else}
                      <span class="tag missed">Missed</span>
                    {/if}
                  </td>
                  <td class="num total">{row.total}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <div class="summary-actions">
            <button class="btn btn-primary btn-block" type="button" on:click={dealNextRound}>Deal round {state.roundNumber + 1}</button>
            <p class="countdown" aria-live="off">Dealing automatically in <span class="num">{secondsLeft}</span>s</p>
          </div>
        </div>
      </div>
    {/if}

    {#if scoreboardOpen}
      <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="scores-title">
        <button class="overlay-dismiss" type="button" aria-label="Close scores" on:click={() => (scoreboardOpen = false)}></button>
        <div class="sheet">
          <div class="sheet-head">
            <h3 id="scores-title">Scores</h3>
            <button class="close" type="button" aria-label="Close scores" on:click={() => (scoreboardOpen = false)}><Icon name="close" /></button>
          </div>
          <Scoreboard />
        </div>
      </div>
    {/if}

    {#if settingsOpen}
      <SettingsSheet context="game" on:close={() => (settingsOpen = false)} />
    {/if}
  </div>
{/if}

<style>
  .board {
    position: relative;
    height: 100dvh;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);
    overflow: hidden;
  }

  /* ---------- Top bar ---------- */
  .topbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
    padding: 10px 16px 4px;
  }
  .round {
    display: flex;
    flex-direction: column;
    line-height: 1.05;
  }
  .round-label {
    font-size: 1.35rem;
  }
  .round-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.6rem;
    font-size: 0.82rem;
    color: var(--on-felt-muted);
  }
  .trumps {
    white-space: nowrap;
  }
  .trumps .red-suit {
    font-size: 1.15em;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  /* ---------- Opponents ---------- */
  .opponents {
    --seat-avatar: clamp(48px, min(12vw, 10vh), 84px);
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    justify-items: center;
    gap: 6px;
    width: min(100%, calc(var(--n) * 150px));
    margin: 0 auto;
    padding: 10px 12px 0;
  }

  /* ---------- Table ---------- */
  .table-zone {
    position: relative;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    justify-items: center;
    align-items: center;
    padding: 10px 16px;
    min-height: 0;
  }
  .status {
    justify-self: center;
    min-width: 0;
    max-width: 100%;
    text-align: center;
    padding: 0.4rem 1.1rem;
    border-radius: 999px;
    background: rgba(4, 16, 27, 0.5);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(1.15rem, 3.6vw, 1.45rem);
    line-height: 1.2;
    color: var(--on-felt);
    /* Wraps to two lines rather than cutting off (large text sizes, narrow phones). */
    white-space: normal;
    transition: background-color 200ms, color 200ms;
  }
  .status:not(.mine) {
    border-radius: 1rem;
  }
  .status.mine {
    background: var(--ice);
    color: var(--ink);
    box-shadow: 0 0 0 4px rgba(143, 221, 251, 0.2), 0 8px 24px rgba(79, 195, 239, 0.35);
  }
  .felt {
    position: relative;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 0.6rem;
    width: min(100%, 640px);
    height: 100%;
    min-height: 150px;
    max-height: 340px;
    border-radius: 999px;
    background: radial-gradient(closest-side, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.015) 70%, transparent);
    box-shadow: inset 0 0 0 1.5px rgba(143, 221, 251, 0.12);
  }
  .bid-wrap {
    width: 100%;
    max-height: 100%;
    display: grid;
    place-items: center;
    align-self: center;
    /* On short screens the panel scrolls rather than spilling over the seats and hand. */
    overflow-y: auto;
  }
  .trick {
    display: flex;
    justify-content: center;
    padding-bottom: 14px;
  }
  .played {
    position: relative;
    margin-left: calc(var(--card-w) * -0.28);
    transition: transform 240ms var(--ease-out), filter 240ms;
  }
  .played:first-child {
    margin-left: 0;
  }
  .played.winning {
    z-index: 5;
    transform: translateY(-10px);
  }
  .played.winning :global(.card) {
    box-shadow:
      0 0 0 3px #ffd36b,
      0 12px 24px rgba(3, 14, 24, 0.5);
  }
  .played.losing {
    filter: brightness(0.6) saturate(0.7);
  }
  .owner {
    position: absolute;
    left: 50%;
    bottom: -12px;
    width: 28px;
    height: 28px;
    transform: translateX(-50%);
    border-width: 2px;
  }
  .caption {
    margin: 0;
    color: var(--on-felt-muted);
    font-size: 0.95rem;
  }
  .caption strong {
    color: var(--on-felt);
    font-family: var(--font-display);
    font-size: 1.15em;
  }
  .caption strong.red-suit {
    color: #ff8191;
  }
  .table-note {
    display: flex;
    flex-direction: column;
    align-items: center;
    color: var(--on-felt-muted);
  }
  .table-note .big {
    font-size: clamp(3rem, 12vw, 4.5rem);
    line-height: 1;
    color: var(--on-felt);
  }
  .table-note .of {
    color: var(--on-felt-muted);
    font-size: 0.55em;
  }
  .table-note.quiet {
    font-size: 0.95rem;
  }
  .pill-note {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    padding: 0.45rem 1rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 600;
    white-space: nowrap;
    box-shadow: var(--shadow-chip);
  }
  .pill-note.urgent {
    background: var(--ice);
  }
  .pill-note.inline {
    position: static;
    transform: none;
    margin-top: 6px;
  }
  .absent-note {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 25;
    display: grid;
    justify-items: center;
    gap: 0.5rem;
    width: min(92%, 380px);
    padding: 0.8rem 1rem;
    border-radius: var(--radius-md);
    background: var(--paper);
    color: var(--ink);
    text-align: center;
    box-shadow: var(--shadow-sheet);
  }
  .absent-note .btn {
    min-height: 42px;
    font-size: 1.1rem;
  }

  /* ---------- Your seat + hand ---------- */
  .my-area {
    --seat-avatar: clamp(44px, 7vh, 60px);
    display: grid;
    justify-items: center;
    gap: 4px;
    padding: 0 12px max(10px, env(safe-area-inset-bottom));
    background: linear-gradient(to top, rgba(4, 16, 27, 0.55), transparent);
  }
  .me-seat {
    justify-self: center;
  }
  .hand {
    position: relative;
    width: min(100%, 760px);
  }
  .fan {
    position: absolute;
    left: 50%;
    bottom: 6px;
    margin-left: calc(var(--card-w) / -2);
    transform-origin: 50% 120%;
    transform: translateX(var(--x)) translateY(calc(var(--lift) * -1)) rotate(var(--r));
  }
  .my-area.turn .hand {
    filter: drop-shadow(0 0 18px rgba(143, 221, 251, 0.25));
  }

  /* ---------- Trick sweep ---------- */
  .collect {
    position: fixed;
    z-index: 50;
    width: 0;
    height: 0;
    pointer-events: none;
    animation: sweep var(--dur) cubic-bezier(0.5, 0, 0.3, 1) forwards;
  }
  .collect img {
    position: absolute;
    width: 52px;
    left: -26px;
    top: -36px;
    border-radius: 4px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
    transform: translateX(calc(var(--i) * 3px)) rotate(calc(var(--i) * 4deg));
  }
  @keyframes sweep {
    0% {
      transform: translate(0, 0) scale(1);
      opacity: 1;
    }
    85% {
      opacity: 1;
    }
    100% {
      transform: translate(var(--dx), var(--dy)) scale(0.4);
      opacity: 0;
    }
  }

  /* ---------- Turn flash ---------- */
  .turn-flash {
    position: fixed;
    inset: 0;
    z-index: 150;
    pointer-events: none;
    animation: flash var(--flash-ms, 1000ms) ease-out forwards;
  }
  @keyframes flash {
    0%,
    100% {
      box-shadow: inset 0 0 0 0 transparent;
    }
    15% {
      box-shadow:
        inset 0 0 0 6px var(--ice),
        inset 0 0 60px rgba(143, 221, 251, 0.35);
    }
  }

  /* ---------- Sheets ---------- */
  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .close {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .close:hover {
    background: var(--paper-line);
  }
  .summary {
    width: min(100%, 480px);
  }
  .summary-sub {
    margin: 0.35rem 0 0.9rem;
    color: var(--ink-soft);
  }
  .summary table {
    width: 100%;
    border-collapse: collapse;
  }
  .summary th {
    padding: 0.3rem 0.4rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--ink-soft);
    text-align: center;
    border-bottom: 1px solid var(--paper-line);
  }
  .summary th:first-child {
    text-align: left;
  }
  .summary td {
    padding: 0.45rem 0.4rem;
    text-align: center;
    border-bottom: 1px solid var(--paper-line);
  }
  .summary td.num {
    font-size: 1.25rem;
  }
  .summary td.total {
    font-size: 1.6rem;
    font-weight: 800;
  }
  .summary tr.me .who {
    font-weight: 700;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    text-align: left !important;
    white-space: nowrap;
  }
  .who .avatar {
    width: 34px;
    height: 34px;
    border-width: 2px;
    border-color: white;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .tag.made {
    background: var(--made-soft);
    color: #17724f;
  }
  .tag.missed {
    background: var(--heart-soft);
    color: #a5202f;
  }
  .summary-actions {
    margin-top: 1.2rem;
  }
  .countdown {
    margin: 0.6rem 0 0;
    text-align: center;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }

  /* ---------- Tablets (iPad and up): bigger seats, names and numbers ---------- */
  @media (min-width: 700px) and (min-height: 700px) {
    .topbar {
      padding: 16px 24px 4px;
    }
    .round-label {
      font-size: 1.7rem;
    }
    .round-meta {
      font-size: 1rem;
    }
    .status {
      font-size: 1.7rem;
      padding: 0.5rem 1.4rem;
    }
    .opponents {
      --seat-avatar: clamp(84px, 10vh, 112px);
      --seat-name: 1.45rem;
      --seat-tally: 1.35rem;
      width: min(100%, calc(var(--n) * 200px));
      padding-top: 18px;
    }
    .my-area {
      --seat-avatar: 80px;
      --seat-name: 1.45rem;
      --seat-tally: 1.35rem;
    }
    .caption {
      font-size: 1.15rem;
    }
    .felt {
      max-height: 440px;
    }
    .owner {
      width: 36px;
      height: 36px;
      bottom: -16px;
    }
  }

  /* ---------- Landscape tablets: your seat sits beside the hand, not above it ---------- */
  @media (orientation: landscape) and (min-width: 700px) and (min-height: 521px) {
    .my-area {
      --seat-avatar: clamp(56px, 10vh, 80px);
      grid-template-columns: minmax(0, 1fr) minmax(0, 640px) minmax(0, 1fr);
      align-items: center;
      column-gap: 12px;
    }
    .me-seat {
      grid-column: 1;
      grid-row: 1;
      justify-self: end;
    }
    .me-seat :global(.seat.row) {
      flex-direction: column;
      text-align: center;
      gap: 0.35rem;
    }
    .me-seat :global(.seat.row .meta) {
      align-items: center;
    }
    .hand {
      grid-column: 2;
      grid-row: 1;
      width: 100%;
    }
  }
  /* Shorter landscape tablets (e.g. 16:10 Android): opponents' details beside their avatar to save height. */
  @media (orientation: landscape) and (min-width: 700px) and (min-height: 521px) and (max-height: 699px) {
    .opponents {
      --seat-avatar: 52px;
      width: min(100%, calc(var(--n) * 260px));
      padding-top: 4px;
    }
    .opponents :global(.seat) {
      flex-direction: row;
      gap: 0.6rem;
      text-align: left;
    }
    .opponents :global(.seat .meta) {
      align-items: flex-start;
    }
    .table-zone {
      padding: 6px 16px;
    }
  }

  /* ---------- Small / landscape phones ---------- */
  @media (max-width: 520px) {
    .topbar {
      padding: 8px 12px 0;
    }
    .topbar {
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 0.5rem;
    }
    .round-label {
      font-size: 1.15rem;
    }
    .round-target {
      display: none;
    }
    .status {
      padding: 0.35rem 0.8rem;
      font-size: 1.05rem;
    }
    .opponents {
      padding-top: 6px;
    }
    .opponents :global(.seat) {
      --seat-name: 0.95rem;
    }
  }
  @media (max-height: 520px) and (orientation: landscape) {
    .board {
      grid-template-columns: 1fr auto;
      grid-template-rows: auto auto minmax(0, 1fr);
    }
    .topbar,
    .opponents {
      grid-column: 1 / -1;
    }
    .opponents {
      --seat-avatar: 40px;
      padding-top: 0;
    }
    .opponents :global(.seat) {
      flex-direction: row;
      gap: 0.4rem;
    }
    .table-zone {
      padding: 4px 12px;
    }
    .felt {
      max-height: 200px;
    }
    .my-area {
      background: none;
      align-content: end;
      width: min(52vw, 460px);
    }
  }
</style>
