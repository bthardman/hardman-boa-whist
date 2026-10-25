<script lang="ts">
  import { onMount, onDestroy, afterUpdate } from 'svelte';
  import { gameState, roomId, localPlayer, introDone } from '../store';
  import { get } from 'svelte/store';
  import { displayName, isSeated } from '../../shared/players';
  import { getPlayerAvatarUrl } from '../avatarUtils';
  import { AvatarChoice, MAX_PLAYERS } from '../../shared/types';
  import type { Player } from '../../shared/types';
  import { socket } from '../socket';
  import { getAvatarData, getPlayerName } from '../avatarData';
  import { registerErrorHandler } from '../utils/socketHandlers';
  import { soundEffects } from '../utils/soundEffects';
  import { showToast } from '../utils/toast';
  import SettingsSheet from './SettingsSheet.svelte';
  import BotsSheet from './BotsSheet.svelte';
  import GuestSheet from './GuestSheet.svelte';
  import StatsSheet from './StatsSheet.svelte';
  import Icon from './ui/Icon.svelte';

  const preferredAvatarOrder = ['Tony', 'Rowan', 'Brad', 'Carol', 'Derek', 'Angela', 'Vanessa', 'Afroditi'];
  const avatarChoices = (Object.values(AvatarChoice).filter((c) => c !== AvatarChoice.UNDEFINED) as AvatarChoice[]).sort(
    (a, b) => {
      const rank = (c: AvatarChoice) => {
        const i = preferredAvatarOrder.indexOf(getPlayerName(c));
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      return rank(a) - rank(b) || getPlayerName(a).localeCompare(getPlayerName(b));
    }
  );

  let settingsOpen = false;
  let guestOpen = false;
  let statsOpen = false;

  // ---------------------------------------------------------------------------
  // Intro: tap the logo -> logo burst with flying faces -> logo docks -> seats appear
  // ---------------------------------------------------------------------------
  type IntroStage = 'pending' | 'pending_shrink' | 'splash' | 'dock' | 'seats' | 'done';
  let introStage: IntroStage = get(introDone) ? 'done' : 'pending';
  const introTimers: ReturnType<typeof setTimeout>[] = [];
  let pendingShrinkFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** Safety net if animationend doesn't fire; ~one frame longer than the CSS shrink. */
  const PENDING_SHRINK_MS = 240;
  const TAP_LOGO_HINT_IDLE_MS = 5000;
  let tapHintIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let showPendingTapHint = false;
  let introFaceFrame: 1 | 2 = 1;
  let introFaceTimer: ReturnType<typeof setInterval> | null = null;

  const introBubbles = avatarChoices.flatMap((avatarChoice, idx) =>
    [0, 1].map((wave) => {
      const seed = idx * 3;
      const angle = (((seed * 137.508) % 360) + (wave ? 192 : 0)) * (Math.PI / 180);
      const distVw = (wave ? 50 : 58) + (seed % 6) * (wave ? 1.2 : 1.6);
      const distVh = (wave ? 42 : 48) + (seed % 5) * (wave ? 1.4 : 1.8);
      return {
        avatarChoice,
        tx: `${(Math.cos(angle) * distVw).toFixed(2)}vw`,
        ty: `${(Math.sin(angle) * distVh).toFixed(2)}vh`,
        duration: `${(4.1 + (seed % 5) * 0.22).toFixed(2)}s`,
        delay: wave ? '1s' : '0s',
        size: `${50 + (seed % 5) * 6}px`
      };
    })
  );

  $: introPlaying = introStage !== 'done';
  $: chromeHidden = introStage === 'pending' || introStage === 'pending_shrink' || introStage === 'splash';
  $: seatsHidden = chromeHidden || introStage === 'dock';

  function beginLobbyIntro() {
    if (introStage !== 'pending') return;
    clearTapHintTimer();
    showPendingTapHint = false;
    soundEffects.playGameStart();
    introStage = 'pending_shrink';
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    pendingShrinkFallbackTimer = setTimeout(finishPendingShrink, reduced ? 60 : PENDING_SHRINK_MS);
  }

  function finishPendingShrink() {
    if (introStage !== 'pending_shrink') return;
    if (pendingShrinkFallbackTimer) clearTimeout(pendingShrinkFallbackTimer);
    pendingShrinkFallbackTimer = null;
    introStage = 'splash';
    introTimers.push(setTimeout(() => (introStage = 'dock'), 3000));
    introTimers.push(setTimeout(() => (introStage = 'seats'), 3700));
    introTimers.push(
      setTimeout(() => {
        introStage = 'done';
        introDone.set(true);
      }, 4900)
    );
  }

  $: {
    if (introStage === 'splash' && !introFaceTimer) {
      introFaceTimer = setInterval(() => (introFaceFrame = introFaceFrame === 1 ? 2 : 1), 820);
    } else if (introStage !== 'splash' && introFaceTimer) {
      clearInterval(introFaceTimer);
      introFaceTimer = null;
    }
  }

  /** Shows "Tap the logo" only if nobody has tapped it after a few seconds. */
  let lastStageForHint: IntroStage | null = null;
  afterUpdate(() => {
    if (lastStageForHint === introStage) return;
    lastStageForHint = introStage;
    clearTapHintTimer();
    showPendingTapHint = false;
    if (introStage === 'pending') tapHintIdleTimer = setTimeout(() => (showPendingTapHint = true), TAP_LOGO_HINT_IDLE_MS);
  });

  function clearTapHintTimer() {
    if (tapHintIdleTimer !== null) clearTimeout(tapHintIdleTimer);
    tapHintIdleTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Seats
  // ---------------------------------------------------------------------------
  const preferredAvatarCookie = 'preferredAvatarChoice';
  let restoredPreferredAvatar = false;

  function setPreferredAvatarCookie(avatarChoice: AvatarChoice) {
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${preferredAvatarCookie}=${encodeURIComponent(avatarChoice)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  }

  function getPreferredAvatarFromCookie(): AvatarChoice | null {
    const prefix = `${preferredAvatarCookie}=`;
    const raw = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix));
    if (!raw) return null;
    const value = decodeURIComponent(raw.slice(prefix.length)) as AvatarChoice;
    return avatarChoices.includes(value) ? value : null;
  }

  // Sit back down as the person you last played as, if that seat is free (not for guests).
  $: if ($localPlayer && $gameState && !restoredPreferredAvatar) {
    restoredPreferredAvatar = true;
    const preferred = getPreferredAvatarFromCookie();
    const unseated = $localPlayer.selectedAvatar === AvatarChoice.UNDEFINED && !$localPlayer.guestName;
    if (preferred && unseated && !ownerOf(preferred) && !$gameState.practising?.includes(preferred)) {
      socket.emit('select_avatar', { roomId: $roomId, avatarChoice: preferred });
    }
  }

  $: players = $gameState?.players ?? [];
  $: seatedCount = players.filter(isSeated).length;
  $: mySeat = $localPlayer?.selectedAvatar ?? AvatarChoice.UNDEFINED;
  $: myGuestName = $localPlayer?.guestName;
  $: iAmSeated = !!$localPlayer && isSeated($localPlayer);
  $: guests = players.filter((p) => p.guestName);
  $: tableFull = seatedCount >= MAX_PLAYERS && !iAmSeated;
  $: anyPersonSeated = players.some((p) => !p.isBot && isSeated(p));
  $: canStart = seatedCount >= 2 && anyPersonSeated && iAmSeated;
  $: bots = players.filter((p) => p.isBot);
  $: difficultyLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[$gameState?.botDifficulty ?? 'medium'];
  let botsOpen = false;
  $: target = $gameState?.winningScore ?? 5;
  $: paceLabel = $gameState?.gameSpeed === 'slow' ? 'Relaxed pace' : $gameState?.gameSpeed === 'fast' ? 'Quick pace' : 'Normal pace';

  // Reads the store directly rather than the reactive `players` variable: this is also called from
  // the "restore my last avatar" block, which can run before `players` has been assigned.
  function ownerOf(avatarChoice: AvatarChoice) {
    return ($gameState?.players ?? []).find((p) => p.selectedAvatar === avatarChoice);
  }

  function tileState(avatarChoice: AvatarChoice, _deps: unknown): 'mine' | 'taken' | 'offline' | 'practising' | 'free' {
    const owner = ownerOf(avatarChoice);
    if (!owner) return $gameState?.practising?.includes(avatarChoice) ? 'practising' : 'free';
    if (owner.playerId === $localPlayer?.playerId) return 'mine';
    return owner.disconnected ? 'offline' : 'taken';
  }

  function toggleSeat(avatarChoice: AvatarChoice) {
    if (introPlaying || !$localPlayer) return;
    const state = tileState(avatarChoice, players);
    if (state === 'mine') {
      socket.emit('select_avatar', { roomId: $roomId, avatarChoice: AvatarChoice.UNDEFINED });
      return;
    }
    if (state === 'practising') {
      showToast(`${getPlayerName(avatarChoice)} is practising against the computer.`);
      return;
    }
    if (state !== 'free') {
      showToast(`${getPlayerName(avatarChoice)} is already taken.`);
      return;
    }
    if (tableFull) {
      showToast(`The table is full — ${MAX_PLAYERS} players max.`);
      return;
    }
    socket.emit('select_avatar', { roomId: $roomId, avatarChoice });
    setPreferredAvatarCookie(avatarChoice);
    soundEffects.playAvatarSelect();
  }

  function openGuestSheet() {
    if (introPlaying) return;
    if (tableFull) {
      showToast(`The table is full — ${MAX_PLAYERS} players max.`);
      return;
    }
    guestOpen = true;
  }

  function leaveGuestSeat() {
    socket.emit('select_avatar', { roomId: $roomId, avatarChoice: AvatarChoice.UNDEFINED });
  }

  function startGame() {
    if (introPlaying || !canStart || countdown) return;
    socket.emit('start_game', { roomId: $roomId });
  }

  // ---------------------------------------------------------------------------
  // Start countdown: 3, 2, 1 with everyone's faces. Anyone can cancel; the server
  // also cancels it if someone joins, leaves or changes seat.
  // ---------------------------------------------------------------------------
  $: countdown = $gameState?.startCountdown;
  let countdownId: number | null = null;
  let countdownStartedAt = 0;
  let countdownNow = 0;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  $: if (countdown && countdown.id !== countdownId) {
    countdownId = countdown.id;
    countdownStartedAt = Date.now(); // local clock, so phones with the wrong time still count properly
    countdownNow = countdownStartedAt;
    settingsOpen = guestOpen = statsOpen = false;
    soundEffects.playGameStart();
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => (countdownNow = Date.now()), 100);
  } else if (!countdown && countdownId !== null) {
    countdownId = null;
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
  }
  $: countdownLeft = countdown ? Math.max(1, Math.ceil((countdown.durationMs - (countdownNow - countdownStartedAt)) / 1000)) : 0;
  $: countdownPlayers = countdown ? countdown.playerIds.map((id) => players.find((p) => p.playerId === id)).filter((p): p is Player => !!p) : [];

  function cancelStart() {
    socket.emit('cancel_start', { roomId: $roomId });
  }

  $: startLabel = canStart
    ? `Start game with ${seatedCount} players`
    : !iAmSeated
      ? 'Tap your picture to join'
      : seatedCount === 1
        ? 'Add a player or a computer'
        : 'Waiting for players';

  const cleanups: Array<() => void> = [];
  onMount(() => {
    cleanups.push(registerErrorHandler('start_game_error', (m) => showToast(m, 'error')));
    cleanups.push(registerErrorHandler('avatar_selection_error', (m) => showToast(m, 'error')));
  });

  onDestroy(() => {
    cleanups.forEach((fn) => fn());
    clearTapHintTimer();
    if (pendingShrinkFallbackTimer) clearTimeout(pendingShrinkFallbackTimer);
    introTimers.forEach((t) => clearTimeout(t));
    if (introFaceTimer) clearInterval(introFaceTimer);
    if (countdownTimer) clearInterval(countdownTimer);
  });
</script>

<div class="lobby stage-{introStage}" style="--guest-row: {guests.length ? '3.6rem' : '0px'}">
  {#if introStage === 'pending' || introStage === 'pending_shrink'}
    <div class="intro-layer">
      <button
        type="button"
        class="intro-pending-hit"
        disabled={introStage === 'pending_shrink'}
        on:click={beginLobbyIntro}
        aria-label="Tap the logo to start"
      >
        <img
          src="/logo/logo.webp"
          alt="Hardman Boa-Whist"
          class="intro-pending-logo"
          class:shrink={introStage === 'pending_shrink'}
          on:animationend={finishPendingShrink}
        />
        <span class="tap-hint" class:visible={introStage === 'pending' && showPendingTapHint} aria-live="polite">
          Tap the logo to start
        </span>
      </button>
    </div>
  {/if}

  {#if introStage === 'splash'}
    <div class="intro-layer" aria-hidden="true">
      <div class="burst">
        {#each introBubbles as b}
          <div class="bubble" style="--tx: {b.tx}; --ty: {b.ty}; --dur: {b.duration}; --delay: {b.delay}; --size: {b.size}">
            <img src={introFaceFrame === 1 ? getAvatarData(b.avatarChoice).avatar1 : getAvatarData(b.avatarChoice).avatar2} alt="" />
          </div>
        {/each}
      </div>
      <img src="/logo/logo.webp" alt="" class="intro-logo" />
    </div>
  {/if}

  <div class="scroll">
    <header class="brand" class:hidden={chromeHidden}>
      <img src="/logo/logo.webp" alt="Hardman Boa-Whist" />
    </header>

    <main class="seats" class:hidden={seatsHidden} aria-labelledby="seats-title">
      <h1 id="seats-title">Who's playing?</h1>
      <p class="lede">
        {#if myGuestName}
          You're in as {myGuestName}.
        {:else if iAmSeated}
          You're in as {getPlayerName(mySeat)}. Tap your picture again to give up the seat.
        {:else}
          Tap your picture to take a seat.
          <!-- Once guests are seated, this moves to the end of their row (saves a line on small phones). -->
          {#if !guests.length}
            <button type="button" class="link" on:click={openGuestSheet}>Visiting? Join as a guest</button>
          {/if}
        {/if}
      </p>

      {#if $gameState}
        <ul class="grid">
          {#each avatarChoices as choice, i (choice)}
            {@const state = tileState(choice, players)}
            <li style="--i: {i}">
              <button
                type="button"
                class="tile {state}"
                class:unavailable={state === 'free' && tableFull}
                aria-pressed={state === 'mine'}
                aria-label="{getPlayerName(choice)}{state === 'mine' ? ', your seat' : state === 'free' ? ', available' : state === 'practising' ? ', practising' : ', taken'}"
                data-avatar={choice}
                data-no-button-sound="true"
                on:click={() => toggleSeat(choice)}
              >
                <span class="photo">
                  <img src={getAvatarData(choice).avatar1} alt="" loading="lazy" />
                  {#if state === 'mine'}
                    <span class="badge you">You</span>
                  {:else if state === 'taken'}
                    <span class="badge"><Icon name="check" size={14} /> In</span>
                  {:else if state === 'offline'}
                    <span class="badge away"><Icon name="wifi-off" size={13} /> Away</span>
                  {:else if state === 'practising'}
                    <span class="badge away">Practising</span>
                  {/if}
                </span>
                <span class="name">{getPlayerName(choice)}</span>
              </button>
            </li>
          {/each}
        </ul>

        {#if guests.length}
          <ul class="guests" aria-label="Guests">
            {#each guests as g (g.playerId)}
              {@const mine = g.playerId === $localPlayer?.playerId}
              <li class="guest-chip" class:mine class:away={g.disconnected}>
                <img src={getPlayerAvatarUrl(g)} alt="" />
                <span>{mine ? `${g.guestName} (you)` : g.guestName}</span>
                {#if mine}
                  <button type="button" class="leave" aria-label="Give up your seat" on:click={leaveGuestSeat}><Icon name="x" size={14} /></button>
                {:else if g.disconnected}
                  <Icon name="wifi-off" size={13} />
                {/if}
              </li>
            {/each}
            {#if !iAmSeated}
              <li>
                <button type="button" class="guest-chip add" on:click={openGuestSheet}><Icon name="plus" size={16} /> Join as a guest</button>
              </li>
            {/if}
          </ul>
        {/if}
      {/if}
    </main>

    {#if $gameState}
      <div class="controls" class:hidden={seatsHidden}>
        <button class="btn btn-ghost" type="button" disabled={introPlaying} on:click={() => (settingsOpen = true)}>
          <Icon name="settings" size={20} /> Settings
        </button>
        <button class="btn btn-ghost bots-btn" type="button" disabled={introPlaying} on:click={() => (botsOpen = true)}>
          <Icon name="robot" size={20} /> <span class="label-long">Computer players</span><span class="label-short">Computers</span>
          {#if bots.length}<span class="count num">{bots.length}</span>{/if}
        </button>
        <button class="btn btn-ghost" type="button" disabled={introPlaying} on:click={() => (statsOpen = true)}>
          <Icon name="trophy" size={20} /> Stats
        </button>
      </div>
    {/if}
  </div>

  {#if $gameState}
    <footer class="dock" class:hidden={seatsHidden}>
      <div class="rules">
        <span>First to {target} {target === 1 ? 'point' : 'points'}</span>
        <span>{paceLabel}</span>
        {#if bots.length}
          <span class="bots-pill">{bots.length} computer {bots.length === 1 ? 'player' : 'players'} · {difficultyLabel}</span>
        {/if}
      </div>
      <div class="dock-row">
        <button class="btn btn-primary start-button" type="button" data-no-button-sound="true" disabled={!canStart || introPlaying} on:click={startGame}>
          {startLabel}
        </button>
      </div>
    </footer>
  {/if}

  {#if countdown}
    <div class="countdown" role="dialog" aria-modal="true" aria-labelledby="countdown-title">
      <p class="countdown-label" id="countdown-title">Dealing in</p>
      {#key countdownLeft}
        <div class="countdown-number num" aria-live="assertive">{countdownLeft}</div>
      {/key}
      <ul class="countdown-players" aria-label="Players">
        {#each countdownPlayers as p, i (p.playerId)}
          <li style="--i: {i}">
            <img class="avatar" src={getPlayerAvatarUrl(p)} alt="" />
            <span>{p.playerId === $localPlayer?.playerId ? 'You' : displayName(p)}</span>
          </li>
        {/each}
      </ul>
      <button class="btn btn-ghost" type="button" on:click={cancelStart}>Cancel</button>
    </div>
  {/if}

  {#if settingsOpen}
    <SettingsSheet context="lobby" on:close={() => (settingsOpen = false)} />
  {/if}

  {#if botsOpen}
    <BotsSheet on:close={() => (botsOpen = false)} />
  {/if}

  {#if guestOpen}
    <GuestSheet on:close={() => (guestOpen = false)} />
  {/if}

  {#if statsOpen}
    <StatsSheet on:close={() => (statsOpen = false)} />
  {/if}
</div>

<style>
  .lobby {
    position: relative;
    height: 100dvh;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    overflow: hidden;
  }
  .scroll {
    overflow-y: auto;
    padding: max(16px, env(safe-area-inset-top)) 16px 16px;
  }

  /* ---------- Brand + seats ---------- */
  .brand {
    display: flex;
    justify-content: center;
    transition: opacity 0.55s ease, transform 0.55s var(--ease-out);
  }
  .brand img {
    width: clamp(180px, 42vw, 300px);
    height: auto;
    filter: drop-shadow(0 10px 24px rgba(3, 14, 24, 0.45));
  }
  .seats {
    width: min(100%, 760px);
    margin: clamp(0.75rem, 3vh, 2rem) auto 0;
    text-align: center;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(2.2rem, 7vw, 3.2rem);
    line-height: 1;
    letter-spacing: 0.005em;
    color: var(--on-felt);
  }
  .lede {
    margin: 0.5rem auto 1.4rem;
    max-width: 34ch;
    color: var(--on-felt-muted);
  }
  .link {
    padding: 0.15rem 0;
    border: 0;
    background: none;
    color: var(--ice);
    font-weight: 700;
    white-space: nowrap;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .grid {
    list-style: none;
    /* Keep both rows on screen on short phones and laptops, at any text size (and leave room for any guests). */
    width: min(100%, max(240px, calc((100dvh - 25rem - var(--guest-row) * 1.4) * 1.45)));
    margin: 0 auto;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: clamp(10px, 2.5vw, 20px);
  }
  .tile {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.45rem;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    touch-action: manipulation;
    color: var(--on-felt);
  }
  .photo {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 28%;
    background: linear-gradient(160deg, var(--felt-light), var(--felt-deep));
    box-shadow:
      inset 0 0 0 2px rgba(234, 244, 251, 0.12),
      0 8px 18px rgba(3, 14, 24, 0.35);
    transition: transform 180ms var(--ease-out), box-shadow 180ms, filter 180ms;
  }
  .photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }
  .tile:hover .photo {
    transform: translateY(-3px);
  }
  .tile:active .photo {
    transform: scale(0.96);
  }
  .tile.mine .photo {
    box-shadow:
      0 0 0 4px var(--ice),
      0 0 0 9px rgba(143, 221, 251, 0.25),
      0 12px 28px rgba(79, 195, 239, 0.4);
  }
  .tile.taken .photo,
  .tile.offline .photo {
    box-shadow:
      0 0 0 3px rgba(234, 244, 251, 0.75),
      0 8px 18px rgba(3, 14, 24, 0.35);
  }
  .tile.offline .photo img {
    filter: grayscale(1) brightness(0.7);
  }
  .tile.taken,
  .tile.offline {
    cursor: default;
  }
  .tile.unavailable .photo {
    filter: brightness(0.5) saturate(0.4);
  }
  .badge {
    position: absolute;
    left: 50%;
    bottom: -10px;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 0.95rem;
    line-height: 1.2;
    white-space: nowrap;
    box-shadow: var(--shadow-chip);
  }
  .badge.you {
    background: var(--ice);
  }
  .badge.away {
    background: #5d7186;
    color: var(--on-felt);
  }
  .grid li {
    container-type: inline-size;
  }
  .name {
    margin-top: 0.35rem;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(1.05rem, 3.6vw, 1.35rem);
    /* Never wider than the face, so names don't run together when the faces shrink to fit. */
    font-size: min(clamp(1.05rem, 3.6vw, 1.35rem), 28cqi);
    line-height: 1.1;
  }
  .tile.mine .name {
    color: var(--ice);
  }

  /* ---------- Guests ---------- */
  .guests {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
  .guest-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 40px;
    padding: 4px 12px 4px 4px;
    border-radius: 999px;
    background: rgba(4, 16, 27, 0.45);
    box-shadow: inset 0 0 0 1.5px rgba(234, 244, 251, 0.3);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.15rem;
    line-height: 1;
  }
  .guest-chip img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }
  .guest-chip.mine {
    padding-right: 4px;
    box-shadow: inset 0 0 0 2px var(--ice);
    color: var(--ice);
  }
  .guest-chip.away {
    color: var(--on-felt-muted);
  }
  .guest-chip.away img {
    filter: grayscale(1) brightness(0.7);
  }
  .guest-chip.add {
    padding: 4px 14px 4px 10px;
    border: 1.5px dashed rgba(143, 221, 251, 0.6);
    box-shadow: none;
    background: transparent;
    color: var(--ice);
    cursor: pointer;
  }
  .guest-chip.add:hover {
    background: rgba(143, 221, 251, 0.12);
  }
  .leave {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: rgba(143, 221, 251, 0.18);
    color: var(--ice);
    cursor: pointer;
  }
  .leave:hover {
    background: rgba(143, 221, 251, 0.32);
  }

  /* ---------- Dock ---------- */
  .dock {
    padding: 12px 16px max(16px, env(safe-area-inset-bottom));
    background: linear-gradient(to top, rgba(4, 16, 27, 0.75) 40%, rgba(4, 16, 27, 0));
    transition: opacity 0.6s ease, transform 0.6s var(--ease-out);
  }
  .rules {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.4rem 0.5rem;
    margin-bottom: 0.7rem;
    font-size: 0.88rem;
    color: var(--on-felt-muted);
  }
  .rules span {
    white-space: nowrap;
    padding: 0.15rem 0.65rem;
    border-radius: 999px;
    background: rgba(4, 16, 27, 0.45);
  }
  .dock-row {
    display: flex;
    gap: 10px;
    justify-content: center;
    width: min(100%, 460px);
    margin: 0 auto;
  }
  /* Settings and computer players: under the faces (portrait) or under the logo (landscape). */
  .controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin: clamp(1rem, 3vh, 1.6rem) auto 0;
    transition: opacity 0.6s ease, transform 0.6s var(--ease-out);
  }
  .controls .btn {
    min-height: 44px;
    padding: 0 1rem;
    font-size: 1.1rem;
    white-space: nowrap;
  }
  .bots-btn .count {
    display: grid;
    place-items: center;
    min-width: 22px;
    height: 22px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--ice);
    color: var(--ink);
    font-size: 0.85rem;
    line-height: 1;
  }
  .start-button {
    flex: 1;
  }

  /* ---------- Start countdown ---------- */
  .countdown {
    position: fixed;
    inset: 0;
    z-index: 400;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 1rem;
    padding: 24px;
    text-align: center;
    background: radial-gradient(80% 60% at 50% 45%, #1d4d70, #071827) var(--felt-deep);
    animation: countdown-in 260ms ease-out;
  }
  .countdown-label {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.6rem;
    color: var(--on-felt-muted);
  }
  .countdown-number {
    font-size: clamp(7rem, 30vw, 11rem);
    line-height: 0.85;
    color: var(--ice);
    text-shadow: 0 0 40px rgba(143, 221, 251, 0.45);
    animation: tick-pop 900ms var(--ease-out) both;
  }
  .countdown-players {
    list-style: none;
    margin: 0.5rem 0 1rem;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 14px;
    max-width: 560px;
  }
  .countdown-players li {
    display: grid;
    justify-items: center;
    gap: 0.3rem;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.15rem;
    animation: seat-in 420ms var(--ease-out) both;
    animation-delay: calc(var(--i) * 90ms);
  }
  .countdown-players .avatar {
    width: clamp(52px, 13vw, 96px);
    height: clamp(52px, 13vw, 96px);
    border-color: var(--ice);
  }
  .countdown .btn {
    min-width: 180px;
  }
  @keyframes countdown-in {
    from {
      opacity: 0;
    }
  }
  @keyframes tick-pop {
    0% {
      opacity: 0;
      transform: scale(1.6);
    }
    30% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0.85;
      transform: scale(0.94);
    }
  }

  /* ---------- Intro choreography ---------- */
  .hidden {
    opacity: 0;
    transform: translateY(24px) scale(0.985);
    pointer-events: none;
  }
  .brand.hidden {
    transform: translateY(50px) scale(0.86);
  }
  .stage-seats .grid li {
    animation: seat-in 520ms var(--ease-out) both;
    animation-delay: calc(var(--i) * 55ms);
  }
  @keyframes seat-in {
    from {
      opacity: 0;
      transform: translateY(18px) scale(0.9);
    }
  }
  .intro-layer {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .intro-pending-hit {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    border: 0;
    border-radius: 18px;
    background: transparent;
    cursor: pointer;
  }
  .intro-pending-hit:disabled {
    cursor: default;
  }
  .intro-pending-logo {
    width: clamp(220px, 50vw, 340px);
    height: auto;
    filter: drop-shadow(0 14px 30px rgba(3, 14, 24, 0.5));
  }
  .intro-pending-logo.shrink {
    animation: logo-shrink 0.16s cubic-bezier(0.32, 0, 0.2, 1) forwards;
  }
  .tap-hint {
    min-height: 1.6em;
    font-weight: 600;
    color: var(--on-felt-muted);
    opacity: 0;
    transition: opacity 0.4s;
  }
  .tap-hint.visible {
    opacity: 1;
    animation: hint-bob 1.6s ease-in-out infinite;
  }
  .burst {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .bubble {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--size);
    height: var(--size);
    margin: calc(var(--size) / -2) 0 0 calc(var(--size) / -2);
    animation: burst var(--dur) cubic-bezier(0.06, 0.82, 0.17, 1) var(--delay) infinite;
    opacity: 0;
  }
  .bubble img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid rgba(234, 244, 251, 0.8);
    box-shadow: 0 10px 20px rgba(3, 14, 24, 0.4);
  }
  .intro-logo {
    position: relative;
    z-index: 2;
    width: clamp(180px, 36vw, 320px);
    height: auto;
    filter: drop-shadow(0 14px 30px rgba(3, 14, 24, 0.5));
    animation: logo-grow 3s cubic-bezier(0.17, 0.9, 0.32, 1) forwards;
  }
  @keyframes logo-shrink {
    to {
      transform: scale(0.4);
    }
  }
  @keyframes logo-grow {
    0% {
      transform: scale(0.4);
    }
    64% {
      transform: scale(2.1);
    }
    100% {
      transform: scale(1);
    }
  }
  @keyframes burst {
    0% {
      transform: translate(0, 0) scale(0.35);
      opacity: 0;
    }
    5% {
      opacity: 1;
      transform: translate(0, 0) scale(0.95);
    }
    100% {
      transform: translate(var(--tx), var(--ty)) scale(1);
      opacity: 0.85;
    }
  }
  @keyframes hint-bob {
    50% {
      transform: translateY(-3px);
    }
  }

  @media (min-width: 760px) {
    .grid {
      gap: 24px 28px;
    }
  }
  .label-short {
    display: none;
  }
  /* Narrow phones: the three buttons on one row, with the short label for computer players
     (the button already shows how many there are). */
  @media (max-width: 520px) {
    .controls {
      flex-wrap: nowrap;
      gap: 8px;
    }
    .controls .btn {
      position: relative;
      min-height: 44px;
      padding: 0 0.7rem;
      gap: 0.3rem;
      font-size: 0.95rem;
    }
    .bots-btn .count {
      position: absolute;
      top: -7px;
      right: -7px;
    }
    .label-long,
    .bots-pill {
      display: none;
    }
    .label-short {
      display: inline;
    }
  }
  /* Short phones (e.g. iPhone SE): a smaller logo and tighter spacing, so the faces keep their size. */
  @media (orientation: portrait) and (max-height: 760px) {
    .brand img {
      width: 140px;
    }
    .seats {
      margin-top: 0.5rem;
    }
    h1 {
      font-size: 2rem;
    }
    .lede {
      margin-bottom: 0.8rem;
    }
    .guests {
      margin-top: 0.6rem;
    }
    .guest-chip {
      min-height: 36px;
      font-size: 1.05rem;
    }
    .guest-chip img {
      width: 28px;
      height: 28px;
    }
    .controls {
      margin-top: 0.9rem;
    }
  }

  /* Landscape (tablets and sideways phones): logo on the left, faces on the right, so everything fits without scrolling. */
  @media (orientation: landscape) and (min-width: 640px) {
    .scroll {
      display: grid;
      grid-template-columns: minmax(0, 34%) minmax(0, 620px);
      grid-template-areas:
        'brand seats'
        'controls seats';
      grid-template-rows: 1fr 1fr;
      justify-content: center;
      align-content: center;
      column-gap: clamp(24px, 5vw, 72px);
    }
    .brand {
      grid-area: brand;
      align-self: end;
    }
    .brand img {
      width: min(100%, 360px);
    }
    .controls {
      grid-area: controls;
      align-self: start;
      flex-direction: column;
      align-items: center;
      margin: clamp(0.8rem, 3vh, 1.6rem) 0 0;
    }
    .controls .btn {
      min-width: min(100%, 240px);
    }
    .seats {
      grid-area: seats;
      align-self: center;
      margin: 0;
    }
    h1 {
      font-size: clamp(2rem, 7vh, 3rem);
    }
    .lede {
      margin-bottom: clamp(0.8rem, 3vh, 1.4rem);
    }
    /* Two rows of faces sized to the height left over beside the dock and heading. */
    .grid {
      width: min(100%, calc((100dvh - 420px - var(--guest-row)) * 2));
      gap: clamp(10px, 2vh, 20px) clamp(12px, 2vw, 24px);
    }
    .rules {
      margin-bottom: 0.5rem;
    }
  }
  @media (max-height: 520px) and (orientation: landscape) {
    .brand img {
      width: 150px;
    }
    .grid {
      width: min(100%, 720px);
      grid-template-columns: repeat(8, minmax(0, 1fr));
    }
    h1 {
      font-size: 2rem;
    }
    .lede {
      margin-bottom: 0.8rem;
    }
  }
  /* Sideways phones: the three buttons side by side under the logo, icon above the label. */
  @media (orientation: landscape) and (max-height: 520px) {
    .controls {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      width: min(100%, 420px);
      margin-left: auto;
      margin-right: auto;
    }
    .controls .btn {
      position: relative;
      flex-direction: column;
      gap: 0.1rem;
      min-width: 0;
      min-height: 54px;
      padding: 0.35rem 0.3rem;
      border-radius: 16px;
      font-size: 1rem;
      line-height: 1.05;
    }
    .bots-btn .count {
      position: absolute;
      top: 4px;
      right: 4px;
    }
    .label-long {
      display: none;
    }
    .label-short {
      display: inline;
    }
  }
</style>
