<script lang="ts">
  import { gameState } from '../store';
  import { socket } from '../socket';
  import { getWinnerAvatarUrl } from '../avatarUtils';
  import { getAvatarData } from '../avatarData';
  import type { Player } from '../../shared/types';

  function playAgain() {
    if (!$gameState) return;
    socket.emit('cancel_game', { roomId: $gameState.roomId });
  }

  function getSortedPlayers(): Player[] {
    if (!$gameState) return [];
    
    const state = $gameState;
    return [...state.players].sort((a, b) => {
      const indexA = state.players.indexOf(a);
      const indexB = state.players.indexOf(b);
      const scoreA = state.scoreboard[indexA] || 0;
      const scoreB = state.scoreboard[indexB] || 0;
      return scoreB - scoreA;
    });
  }

</script>

<div class="winner-screen">
  <h1 class="winner-title">🎉 Game Over! 🎉</h1>
  {#if $gameState && $gameState.winner}
    <div class="winner-section">
      <img src={getWinnerAvatarUrl($gameState.winner)} alt="Winner Avatar" class="avatar"/>
      <div class="player-name">{getAvatarData($gameState.winner.selectedAvatar).name}</div>
      <div class="winner-label">Winner!</div>
    </div>
  {/if}
  
  {#if $gameState}
    {@const state = $gameState}
    <div class="final-scores">
      <h2>Final Scores</h2>
      <div class="score-list">
        {#each getSortedPlayers() as player}
          {@const index = state.players.indexOf(player)}
          {@const score = state.scoreboard[index] || 0}
          {@const isWinner = state.winner?.playerId === player.playerId}
          <div class="score-item" class:winner={isWinner}>
            <span class="rank">#{getSortedPlayers().indexOf(player) + 1}</span>
            <span class="name">{getAvatarData(player.selectedAvatar).name}</span>
            <span class="score">{score}</span>
            {#if isWinner}
              <span class="crown">👑</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
  
  <button class="play-again-button" on:click={playAgain}>Back to Lobby</button>
</div>

<style>
  .winner-screen {
    text-align: center;
    padding: 2rem;
    max-width: 600px;
    margin: 0 auto;
  }

  .winner-title {
    font-size: 2.5rem;
    color: #2c3e50;
    margin-bottom: 2rem;
  }

  .winner-section {
    margin-bottom: 3rem;
  }

  .avatar {
    width: 150px;
    height: 150px;
    border-radius: 50%;
    border: 4px solid gold;
    box-shadow: 0 4px 20px rgba(255, 215, 0, 0.5);
    margin-bottom: 1rem;
  }

  .player-name {
    font-size: 2rem;
    font-weight: bold;
    color: #2c3e50;
    margin-bottom: 0.5rem;
  }

  .winner-label {
    font-size: 1.5rem;
    color: #f39c12;
    font-weight: 600;
  }

  .final-scores {
    background: #fff;
    border-radius: 12px;
    padding: 2rem;
    margin: 2rem 0;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  }

  .final-scores h2 {
    margin: 0 0 1.5rem 0;
    font-size: 1.8rem;
    color: #2c3e50;
  }

  .score-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .score-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-radius: 8px;
    background: #f5f5f5;
    transition: all 0.2s;
  }

  .score-item.winner {
    background: #fff9e6;
    border: 2px solid gold;
    font-weight: 600;
  }

  .score-item .rank {
    font-size: 1.2rem;
    font-weight: bold;
    color: #7f8c8d;
    min-width: 40px;
  }

  .score-item .name {
    flex: 1;
    text-align: left;
    margin-left: 1rem;
    font-size: 1.1rem;
  }

  .score-item .score {
    font-size: 1.3rem;
    font-weight: bold;
    color: #2c3e50;
    min-width: 60px;
    text-align: right;
  }

  .score-item .crown {
    margin-left: 0.5rem;
    font-size: 1.5rem;
  }

  .play-again-button {
    margin-top: 2rem;
    padding: 1rem 3rem;
    font-size: 1.2rem;
    font-weight: 600;
    background-color: #004C8C;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.3s;
  }

  .play-again-button:hover {
    background-color: #00B7C2;
  }
</style>
