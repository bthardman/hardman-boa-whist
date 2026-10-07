<script lang="ts">
  import { gameState, localPlayer, roomId } from '../store';
  import { socket } from '../socket';
  import { getWinnerAvatarUrl, getPlayerAvatarUrl } from '../avatarUtils';
  import { displayName } from '../../shared/players';
  import { registerErrorHandler } from '../utils/socketHandlers';
  import { showToast } from '../utils/toast';
  import { onMount, onDestroy } from 'svelte';
  import { soundEffects } from '../utils/soundEffects';
  import Icon from './ui/Icon.svelte';

  let confirmMode: 'lobby' | 'rematch' | null = null;
  let stopListening: (() => void) | null = null;

  onMount(() => {
    soundEffects.playGameEnd();
    stopListening = registerErrorHandler('start_game_error', (message) => {
      confirmMode = null;
      showToast(message);
    });
  });
  onDestroy(() => stopListening?.());

  $: state = $gameState;
  $: winner = state?.winner;
  $: winnerName = winner ? displayName(winner) : '';
  $: youWon = !!winner && winner.playerId === $localPlayer?.playerId;
  $: standings = state
    ? state.players
        .map((player, index) => ({ player, score: state?.scoreboard?.[index] ?? 0 }))
        .sort((a, b) => b.score - a.score)
    : [];
  // Shared places for ties: 3, 2, 2, 0 -> 1st, 2nd, 2nd, 4th.
  $: places = standings.map((s) => standings.findIndex((o) => o.score === s.score) + 1);

  function confirm() {
    if (!state || !confirmMode) return;
    if (confirmMode === 'rematch') {
      soundEffects.playGameStart();
      socket.emit('rematch_game', { roomId: $roomId });
    } else {
      socket.emit('cancel_game', { roomId: $roomId });
    }
    confirmMode = null;
  }

  const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
</script>

<div class="winner-screen">
  <div class="content">
    {#if winner}
      <section class="hero" aria-labelledby="winner-title">
        <div class="crown"><Icon name="crown" size={44} /></div>
        <div class="portrait">
          <img class="avatar" src={getWinnerAvatarUrl(winner)} alt="" />
        </div>
        <h1 id="winner-title">{youWon ? 'You win!' : `${winnerName} wins!`}</h1>
        <p class="sub">After {state?.roundNumber} {state?.roundNumber === 1 ? 'round' : 'rounds'}</p>
      </section>
    {/if}

    <ol class="standings" aria-label="Final scores">
      {#each standings as { player, score }, i (player.playerId)}
        <li class:first={places[i] === 1} class:me={player.playerId === $localPlayer?.playerId}>
          <span class="place num">{ordinal(places[i])}</span>
          <img class="avatar" src={getPlayerAvatarUrl(player)} alt="" />
          <span class="name">{displayName(player)}</span>
          <span class="score num">{score}<span class="pts"> {score === 1 ? 'pt' : 'pts'}</span></span>
        </li>
      {/each}
    </ol>

    <div class="actions">
      <button class="btn btn-primary" type="button" on:click={() => (confirmMode = 'rematch')}>Play again</button>
      <button class="btn btn-ghost" type="button" on:click={() => (confirmMode = 'lobby')}>Back to lobby</button>
    </div>
  </div>

  {#if confirmMode}
    <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <button class="overlay-dismiss" type="button" aria-label="Cancel" on:click={() => (confirmMode = null)}></button>
      <div class="sheet confirm">
        <h3 id="confirm-title">{confirmMode === 'rematch' ? 'Play again?' : 'Back to the lobby?'}</h3>
        <p>
          {#if confirmMode === 'rematch'}
            A new game starts straight away with the same players. Scores go back to zero.
          {:else}
            Everyone returns to the lobby and scores go back to zero.
          {/if}
        </p>
        <div class="confirm-actions">
          <button class="btn btn-ghost" type="button" on:click={() => (confirmMode = null)}>Cancel</button>
          <button class="btn btn-primary" type="button" on:click={confirm}>
            {confirmMode === 'rematch' ? 'Deal a new game' : 'Go to lobby'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .winner-screen {
    height: 100dvh;
    overflow-y: auto;
    padding: max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
  }
  .content {
    width: min(100%, 460px);
    margin: 0 auto;
    display: grid;
    gap: 1.6rem;
  }
  .hero {
    display: grid;
    justify-items: center;
    text-align: center;
  }
  .crown {
    color: #ffd36b;
    margin-bottom: -10px;
    filter: drop-shadow(0 4px 10px rgba(255, 211, 107, 0.5));
    animation: crown-drop 700ms 200ms var(--ease-out) both;
  }
  .portrait {
    position: relative;
    width: clamp(150px, 42vw, 200px);
    aspect-ratio: 1;
    border-radius: 50%;
    animation: winner-pop 700ms var(--ease-out) both;
  }
  .portrait::before {
    content: '';
    position: absolute;
    inset: -14px;
    border-radius: 50%;
    background: conic-gradient(from 0deg, var(--ice), #ffd36b, var(--ice), #ffd36b, var(--ice));
    filter: blur(14px);
    opacity: 0.55;
    animation: halo 6s linear infinite;
  }
  .portrait .avatar {
    position: relative;
    width: 100%;
    height: 100%;
    border: 5px solid #ffd36b;
  }
  h1 {
    margin: 1rem 0 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(2.1rem, 8vw, 2.9rem);
    line-height: 1;
  }
  .sub {
    margin: 0.4rem 0 0;
    color: var(--on-felt-muted);
  }
  .standings {
    list-style: none;
    margin: 0;
    padding: 0.4rem;
    border-radius: var(--radius-lg);
    background: var(--paper);
    color: var(--ink);
    box-shadow: var(--shadow-sheet);
  }
  .standings li {
    display: grid;
    grid-template-columns: 2.6rem 40px 1fr auto;
    align-items: center;
    gap: 0.7rem;
    padding: 0.55rem 0.8rem 0.55rem 0.6rem;
    border-radius: 14px;
  }
  .standings li + li {
    border-top: 1px solid var(--paper-line);
  }
  .standings li.first {
    background: #fff6d8;
  }
  .standings li.first + li {
    border-top-color: transparent;
  }
  .place {
    font-size: 1.1rem;
    color: var(--ink-soft);
  }
  .first .place {
    color: #a87800;
  }
  .standings .avatar {
    width: 40px;
    height: 40px;
    border-width: 2px;
    border-color: white;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  }
  .name {
    font-weight: 600;
  }
  .me .name {
    font-weight: 800;
  }
  .score {
    font-size: 1.7rem;
    line-height: 1;
  }
  .pts {
    font-size: 0.55em;
    color: var(--ink-soft);
  }
  .actions {
    display: grid;
    gap: 10px;
  }
  .confirm p {
    margin: 0.6rem 0 1.2rem;
    color: var(--ink-soft);
  }
  .confirm-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .confirm-actions .btn {
    padding: 0 0.8rem;
    font-size: 1.1rem;
  }
  @keyframes winner-pop {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
  }
  @keyframes crown-drop {
    from {
      opacity: 0;
      transform: translateY(-30px) rotate(-12deg);
    }
  }
  @keyframes halo {
    to {
      transform: rotate(360deg);
    }
  }
</style>
