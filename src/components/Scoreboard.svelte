<script lang="ts">
  import { gameState, localPlayer } from '../store';
  import { getAvatarData } from '../avatarData';
  import type { Player } from '../../shared/types';

  /** When true, use compact styling for in-game overlay (e.g. top-right panel). */
  export let compact = false;
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
  <h2>Scoreboard</h2>
  <div class="round-info">Round {$gameState.roundNumber}</div>
  <div class="target-info">👑 First to {$gameState.winningScore ?? 5}</div>

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
  {#if $gameState.state === 'bidding' || $gameState.state === 'tricks' || $gameState.state === 'round_end'}
    <section class="section this-hand">
      <h3 class="section-title">This hand</h3>
      <div class="hand-table">
        <div class="hand-row header">
          <span class="col-name">Player</span>
          <span class="col-bid"><span class="cell-icon" aria-hidden="true">🎯</span> Bid</span>
          <span class="col-tricks"><span class="cell-icon" aria-hidden="true">🃏</span> Tricks</span>
        </div>
        {#each biddingSequence as player}
          <div class="hand-row" class:you={$localPlayer && player.playerId === $localPlayer.playerId}>
            <span class="col-name">
              <img src={player.inGameAvatar || getAvatarData(player.selectedAvatar).avatar1} alt="" class="score-avatar" />
              {getAvatarData(player.selectedAvatar).name}{#if $localPlayer && player.playerId === $localPlayer.playerId}<span class="you-tag"> (you)</span>{/if}
            </span>
            <span class="col-bid">
              <span class="cell-value-chip bid-chip">
                {typeof player.bid === 'number' ? player.bid : '—'}
              </span>
            </span>
            <span class="col-tricks" class:warning={isTricksWarning(player)}>
              <span class="cell-value-chip tricks-chip" class:warning-chip={isTricksWarning(player)}>
                {player.tricksWon}
              </span>
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
    background: linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%);
    border: 1px solid rgba(44, 62, 80, 0.12);
    border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    padding: 1.5rem 2rem;
    margin: 1rem auto;
    max-width: 400px;
    text-align: center;
    color: #223344;
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
    margin: 0 0 0.5rem 0;
    font-size: 1.35rem;
    color: #1f2f44;
    letter-spacing: 0.02em;
  }

  .scoreboard.compact h2 {
    font-size: 1.1rem;
    margin-bottom: 0.25rem;
  }

  .scoreboard .round-info {
    font-size: 0.85rem;
    color: #6c7b89;
    margin-bottom: 1rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .scoreboard.compact .round-info {
    margin-bottom: 0.5rem;
    font-size: 0.85rem;
  }

  .scoreboard .target-info {
    font-size: 0.8rem;
    color: #5f7183;
    margin-bottom: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .scoreboard.compact .target-info {
    margin-bottom: 0.5rem;
    font-size: 0.74rem;
  }

  .section {
    margin-bottom: 1rem;
  }

  .scoreboard.compact .section {
    margin-bottom: 0.5rem;
  }

  .section-title {
    font-size: 0.75rem;
    color: #7a8796;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 0.5rem 0;
    font-weight: 700;
  }

  .score-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .score-list li {
    font-size: 1.05rem;
    margin: 0.35rem 0;
    color: #2d3f53;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.45rem 0.55rem;
    border-radius: 8px;
    border: 1px solid transparent;
    transition: background-color 0.2s, border-color 0.2s;
  }

  .scoreboard.compact .score-list li {
    font-size: 0.95rem;
    margin: 0.25rem 0;
    padding: 0.35rem 0.5rem;
  }

  .score-list li.leading {
    background: linear-gradient(90deg, #fff7d6 0%, #ffefba 100%);
    border-color: #f0d77a;
    font-weight: 600;
  }

  .hand-row.you {
    background: rgba(0,0,0,0.03);
    font-weight: 700;
  }

  .player-name {
    flex: 1;
    text-align: left;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .score {
    font-weight: bold;
    min-width: 50px;
    text-align: right;
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
    border-top: 1px solid rgba(44, 62, 80, 0.12);
    padding-top: 0.35rem;
  }

  .hand-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.35rem 0.45rem;
    border-radius: 8px;
    font-size: 0.9rem;
    border: 1px solid rgba(44, 62, 80, 0.08);
    background: rgba(255, 255, 255, 0.65);
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

  .cell-icon {
    margin-right: 0.2rem;
    opacity: 0.95;
  }

  .cell-value-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.35rem;
    border-radius: 999px;
    border: 1px solid rgba(60, 84, 110, 0.2);
    background: rgba(255, 255, 255, 0.9);
    font-weight: 600;
  }

  .bid-chip {
    border-color: rgba(33, 102, 172, 0.28);
    background: rgba(224, 240, 255, 0.85);
  }

  .tricks-chip {
    border-color: rgba(74, 112, 57, 0.28);
    background: rgba(231, 245, 229, 0.9);
  }

  .col-tricks.warning {
    color: #b30000;
  }

  .warning-chip {
    border-color: rgba(200, 20, 20, 0.55);
    background: linear-gradient(180deg, rgba(255, 225, 225, 0.95), rgba(255, 203, 203, 0.9));
    box-shadow: 0 0 0 1px rgba(255, 150, 150, 0.45);
    font-weight: 700;
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
