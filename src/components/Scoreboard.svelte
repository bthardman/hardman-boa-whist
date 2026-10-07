<script lang="ts">
  import { gameState, localPlayer } from '../store';
  import { displayName } from '../../shared/players';
  import { getPlayerAvatarUrl } from '../avatarUtils';
  import { biddingOrder, bidInTrouble } from '../utils/gameUtils';

  export let showThisRound = true;

  $: state = $gameState;
  $: target = state?.winningScore ?? 5;
  $: standings = state
    ? state.players
        .map((player, index) => ({ player, score: state?.scoreboard?.[index] ?? 0 }))
        .sort((a, b) => b.score - a.score)
    : [];
  $: topScore = standings[0]?.score ?? 0;
  $: soleLeader = topScore > 0 && standings.filter((s) => s.score === topScore).length === 1;
  $: inRound = !!state && (state.state === 'bidding' || state.state === 'tricks' || state.state === 'round_end');
  $: isMe = (id: string) => !!$localPlayer && $localPlayer.playerId === id;
</script>

{#if state}
  <div class="scoreboard">
    <p class="subtitle">Round {state.roundNumber}. First to {target} {target === 1 ? 'point' : 'points'} wins.</p>

    <ol class="standings">
      {#each standings as { player, score }, i (player.playerId)}
        <li class:me={isMe(player.playerId)} class:leader={soleLeader && i === 0}>
          <img class="avatar" src={getPlayerAvatarUrl(player)} alt="" />
          <span class="name">{displayName(player)}{#if isMe(player.playerId)}<span class="you">&nbsp;(you)</span>{/if}</span>
          <span class="progress" aria-hidden="true">
            {#each Array.from({ length: Math.max(target, score) }) as _, n}
              <i class:filled={n < score}></i>
            {/each}
          </span>
          <span class="score num" aria-label="{score} points">{score}</span>
        </li>
      {/each}
    </ol>

    {#if showThisRound && inRound}
      <h4>This round</h4>
      <table>
        <thead>
          <tr><th scope="col">Player</th><th scope="col">Bid</th><th scope="col">Won</th></tr>
        </thead>
        <tbody>
          {#each biddingOrder(state) as player (player.playerId)}
            <tr class:me={isMe(player.playerId)}>
              <td>{displayName(player)}</td>
              <td class="num">{typeof player.bid === 'number' ? player.bid : '–'}</td>
              <td class="num" class:trouble={bidInTrouble(state, player)}>{player.tricksWon}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/if}

<style>
  .subtitle {
    margin: 0.25rem 0 1rem;
    color: var(--ink-soft);
  }
  .standings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .standings li {
    display: grid;
    grid-template-columns: 36px 1fr auto 2rem;
    align-items: center;
    gap: 0.7rem;
    padding: 0.45rem 0.7rem 0.45rem 0.45rem;
    border-radius: 12px;
    background: white;
    box-shadow: inset 0 0 0 1px var(--paper-line);
  }
  .standings li.me {
    box-shadow: inset 0 0 0 2px var(--ice-strong);
  }
  .standings li.leader {
    background: #fff8e2;
    box-shadow: inset 0 0 0 1.5px #f0cf6b;
  }
  .standings .avatar {
    width: 36px;
    height: 36px;
    border-width: 2px;
    border-color: white;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .you {
    font-weight: 400;
    color: var(--ink-soft);
  }
  .progress {
    display: flex;
    gap: 4px;
  }
  .progress i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px #b9c7d4;
  }
  .progress i.filled {
    background: var(--ink);
    box-shadow: none;
  }
  .leader .progress i.filled {
    background: #d9a21b;
  }
  .score {
    font-size: 1.6rem;
    text-align: right;
    line-height: 1;
  }
  h4 {
    margin: 1.2rem 0 0.4rem;
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 700;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink-soft);
    text-align: right;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--paper-line);
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  td {
    padding: 0.4rem 0.5rem;
    text-align: right;
    border-bottom: 1px solid var(--paper-line);
  }
  td.num {
    font-size: 1.2rem;
    width: 3.5rem;
  }
  tr.me td:first-child {
    font-weight: 700;
  }
  td.trouble {
    color: var(--heart);
  }
</style>
