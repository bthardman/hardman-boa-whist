<script lang="ts">
  import { gameState, localPlayer } from '../store';
  import { getAvatarData } from '../avatarData';
  import type { Player } from '../../shared/types';

  /** When true, use compact styling for in-game overlay (e.g. top-right panel). */
  export let compact = false;
  export let showHeader = true;
  export let showThisHand = true;
  // Derive bidding sequence from firstPlayer so bids display in the order asked
  $: biddingSequence = $gameState
    ? (() => {
        const players = $gameState.players || [];
        const n = players.length;
        const start = $gameState.firstPlayer ?? 0;
        const seq: Player[] = [];
        for (let i = 0; i < n; i++) seq.push(players[(start + i) % n]);
        return seq;
      })()
    : [];

  function isTricksWarning(player: Player): boolean {
    if (!$gameState || $gameState.state !== 'tricks') return false;
    if (typeof player.bid !== 'number') return false;
    if (player.tricksWon > player.bid) return true;
    if ($gameState.currentTrick.length > 0) return false;
    return player.tricksWon + player.hand.length < player.bid;
  }
</script>

{#if $gameState && $gameState.roundNumber > 0}
<div class="scoreboard" class:compact>
  {#if showHeader}
    <h2>Scoreboard</h2>
    <div class="round-info">Round {$gameState.roundNumber}</div>
    <div class="target-info">👑 First to {$gameState.winningScore ?? 5}</div>
  {/if}

  <!-- Overall game scores (points) -->
  <section class="section game-scores">
    <h3 class="section-title">Game score</h3>
    <ul class="score-list">
      {#each $gameState.players as player, index}
        {@const score = $gameState.scoreboard[index] ?? 0}
        {@const isLeading = Math.max(...Object.values($gameState.scoreboard || {})) === score && score > 0}
        <li class:leading={isLeading}>
          <span class="player-name">
            <img src={player.inGameAvatar || getAvatarData(player.selectedAvatar).avatar1} alt="" class="score-avatar" />
            {getAvatarData(player.selectedAvatar).name}
            {#if $localPlayer && player.playerId === $localPlayer.playerId}
              <span class="you-tag"> (you)</span>
            {/if}
          </span>
          <span class="score">{score}</span>
          {#if isLeading && Object.values($gameState.scoreboard || {}).filter(s => s === score).length === 1}
            <span class="leader-badge">👑</span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <!-- This hand: bids and tricks -->
  {#if showThisHand && ($gameState.state === 'bidding' || $gameState.state === 'tricks' || $gameState.state === 'round_end')}
    <section class="section this-hand">
      <h3 class="section-title">This hand</h3>
      <div class="hand-table">
        <div class="hand-row header">
          <span class="col-name">Player</span>
          <span class="col-bid">Bid</span>
          <span class="col-tricks">Tricks</span>
        </div>
        {#each biddingSequence as player}
          <div class="hand-row" class:you={$localPlayer && player.playerId === $localPlayer.playerId}>
            <span class="col-name">
              <img src={player.inGameAvatar || getAvatarData(player.selectedAvatar).avatar1} alt="" class="score-avatar" />
              {getAvatarData(player.selectedAvatar).name}{#if $localPlayer && player.playerId === $localPlayer.playerId}<span class="you-tag"> (you)</span>{/if}
            </span>
            <span class="col-bid">
              <span class="cell-value">{typeof player.bid === 'number' ? player.bid : '—'}</span>
            </span>
            <span class="col-tricks" class:warning={isTricksWarning(player)}>
              <span class="cell-value" class:warning-value={isTricksWarning(player)}>{player.tricksWon}</span>
            </span>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
{/if}

<style>
  .scoreboard {
    background:
      radial-gradient(120% 100% at 10% -20%, rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0) 58%),
      linear-gradient(165deg, rgba(248, 251, 255, 0.95), rgba(233, 240, 249, 0.94));
    border: 1px solid rgba(128, 155, 191, 0.34);
    border-radius: 20px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.9),
      0 24px 42px rgba(11, 31, 56, 0.26);
    padding: 1.35rem 1.35rem 1.15rem;
    margin: 1rem auto;
    max-width: 420px;
    text-align: center;
    color: #223344;
    backdrop-filter: blur(10px);
  }

  .scoreboard:not(.compact) {
    background:
      radial-gradient(140% 120% at 15% -25%, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0) 58%),
      linear-gradient(165deg, rgba(243, 248, 255, 0.96), rgba(228, 236, 247, 0.94));
    border-color: rgba(124, 154, 194, 0.34);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.92),
      0 24px 42px rgba(10, 30, 56, 0.28);
    padding: 1.1rem 1rem 0.95rem;
    max-width: 460px;
  }

  .scoreboard.compact {
    margin: 0;
    padding: 0.65rem 0.8rem;
    max-width: 260px;
    border-radius: 12px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
  }

  @media (max-width: 768px) {
    .scoreboard.compact {
      max-width: 150px;
      padding: 0.4rem 0.5rem;
    }
    .scoreboard.compact h2 {
      font-size: 0.9rem;
    }
    .scoreboard.compact .round-info {
      font-size: 0.75rem;
    }
    .scoreboard.compact .section-title {
      font-size: 0.7rem;
    }
    .scoreboard.compact .score-list li {
      font-size: 0.8rem;
      padding: 0.2rem 0.35rem;
    }
    .scoreboard.compact .hand-row {
      font-size: 0.75rem;
      padding: 0.2rem 0.3rem;
    }
  }

  @media (max-width: 430px) {
    .scoreboard.compact {
      max-width: 130px;
      padding: 0.35rem 0.4rem;
    }
    .scoreboard.compact h2 {
      font-size: 0.8rem;
    }
    .scoreboard.compact .score-list li {
      font-size: 0.75rem;
    }
    .scoreboard.compact .hand-row {
      font-size: 0.7rem;
    }
  }

  .scoreboard h2 {
    margin: 0 0 0.3rem 0;
    font-size: clamp(1.6rem, 4.3vw, 2rem);
    line-height: 1.05;
    color: #23405f;
    letter-spacing: 0.01em;
  }

  .scoreboard.compact h2 {
    font-size: 1.1rem;
    margin-bottom: 0.25rem;
  }

  .scoreboard .round-info {
    font-size: clamp(1.2rem, 3.1vw, 1.5rem);
    color: #5e6f82;
    margin-bottom: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .scoreboard.compact .round-info {
    margin-bottom: 0.5rem;
    font-size: 0.85rem;
  }

  .scoreboard .target-info {
    font-size: 0.95rem;
    color: #667b92;
    margin-bottom: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .scoreboard.compact .target-info {
    margin-bottom: 0.5rem;
    font-size: 0.74rem;
  }

  .section {
    margin-bottom: 0.9rem;
    padding: 0.7rem 0.65rem;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.62);
    border: 1px solid rgba(129, 158, 195, 0.2);
  }

  .scoreboard.compact .section {
    margin-bottom: 0.5rem;
  }

  .section-title {
    font-size: clamp(1rem, 2.8vw, 1.14rem);
    color: #66798f;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 0.55rem 0;
    font-weight: 700;
  }

  .score-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .score-list li {
    font-size: 1.02rem;
    margin: 0.35rem 0;
    color: #2d3f53;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.55rem 0.62rem;
    border-radius: 10px;
    border: 1px solid rgba(148, 170, 196, 0.16);
    background: rgba(255, 255, 255, 0.45);
    transition: background-color 0.2s, border-color 0.2s, box-shadow 0.2s;
  }

  .scoreboard.compact .score-list li {
    font-size: 0.95rem;
    margin: 0.25rem 0;
    padding: 0.35rem 0.5rem;
  }

  .score-list li.leading {
    background: linear-gradient(90deg, #fff8dd 0%, #ffefc2 100%);
    border-color: #ecd488;
    font-weight: 600;
    box-shadow: 0 8px 16px rgba(224, 184, 92, 0.18);
  }

  .hand-row.you {
    background: linear-gradient(165deg, rgba(224, 239, 255, 0.88), rgba(208, 230, 251, 0.78));
    border-color: rgba(80, 137, 190, 0.35);
    font-weight: 700;
  }

  .player-name {
    flex: 1;
    text-align: left;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.98rem;
    color: #2d3f53;
  }

  .score {
    font-weight: 800;
    min-width: 50px;
    text-align: right;
    color: #273c56;
    font-size: 1rem;
  }

  .leader-badge {
    margin-left: 0.35rem;
    font-size: 1rem;
  }

  .hand-table {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    text-align: left;
    border-top: 1px solid rgba(44, 62, 80, 0.14);
    padding-top: 0.45rem;
  }

  .hand-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.55rem;
    align-items: center;
    padding: 0.35rem 0.45rem;
    border-radius: 10px;
    font-size: 0.88rem;
    border: 1px solid rgba(44, 62, 80, 0.12);
    background: rgba(255, 255, 255, 0.78);
  }

  .scoreboard.compact .hand-row {
    font-size: 0.85rem;
    padding: 0.25rem 0.35rem;
    gap: 0.5rem;
  }

  .hand-row.header {
    font-weight: 700;
    color: #5a6c7d;
    font-size: 0.76rem;
    border: none;
    border-bottom: 1px solid #dbe4ec;
    border-radius: 0;
    background: transparent;
    padding-bottom: 0.35rem;
  }

  .col-name {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .col-bid,
  .col-tricks {
    text-align: right;
    min-width: 2.5em;
  }

  .cell-value {
    display: inline-block;
    min-width: 1.3em;
    text-align: center;
    font-weight: 800;
    color: #29496b;
  }

  .col-tricks.warning {
    color: #b30000;
  }

  .warning-value {
    color: #c01818;
    text-shadow: 0 0 8px rgba(210, 24, 24, 0.28);
  }

  .score-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: contain;
    border: 1px solid rgba(44, 62, 80, 0.2);
    background: transparent;
    flex: 0 0 auto;
  }

  .you-tag {
    font-weight: 700;
    color: #2f4965;
  }
</style>
