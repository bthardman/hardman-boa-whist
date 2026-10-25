<script lang="ts">
  // Everyone's stats (family games and practice kept apart) and the recent games.
  import { createEventDispatcher, onMount } from 'svelte';
  import { BADGE_MIN_ROUNDS, badgesFor, usualBid, type BadgeId, type GameKind, type PersonStats, type RecentGame, type StatsResponse } from '../../shared/stats';
  import { AvatarChoice } from '../../shared/types';
  import { familyName } from '../../shared/players';
  import { getAvatarData } from '../avatarData';
  import { botAvatarUrl, guestAvatarUrl } from '../avatarUtils';
  import { fetchStats } from '../utils/statsApi';
  import Icon from './ui/Icon.svelte';

  const dispatch = createEventDispatcher<{ close: void }>();
  type Tab = 'family' | 'rivals' | 'practice' | 'recent';
  const tabs: { value: Tab; label: string }[] = [
    { value: 'family', label: 'Family' },
    { value: 'rivals', label: 'Rivals' },
    { value: 'practice', label: 'Practice' },
    { value: 'recent', label: 'Recent' }
  ];
  const BADGE_ICONS: Record<BadgeId, string> = {
    slider: '🛷',
    early: '🐦',
    lastHeart: '❤️',
    highCaller: '📈',
    zeroCaller: '0️⃣'
  };
  let tab: Tab = 'family';
  let data: StatsResponse | null = null;
  let failed = false;
  let expanded: string | null = null;

  onMount(async () => {
    try {
      data = await fetchStats();
    } catch {
      failed = true;
    }
  });

  const faces = new Set<string>(Object.values(AvatarChoice));
  const isFace = (key: string): key is AvatarChoice => faces.has(key) && key !== AvatarChoice.UNDEFINED;
  const personName = (key: string) => (isFace(key) ? familyName(key) : key);
  const personPicture = (key: string) => (isFace(key) ? getAvatarData(key).avatar1 : '');
  function picture(p: RecentGame['players'][number]): string {
    if (p.kind === 'bot') return botAvatarUrl(p.name);
    if (p.kind === 'guest') return guestAvatarUrl(p.name);
    return personPicture(p.key);
  }

  const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
  const winRate = (s: PersonStats) => (s.games ? s.wins / s.games : 0);
  /** Most wins first, then the best win rate, then the most games. */
  function ranked(stats: StatsResponse, kind: GameKind) {
    return stats.people
      .flatMap((p) => {
        const s = p[kind];
        return s ? [{ key: p.key, s }] : [];
      })
      .sort((a, b) => b.s.wins - a.s.wins || winRate(b.s) - winRate(a.s) || b.s.games - a.s.games);
  }
  $: rows = data && (tab === 'family' || tab === 'practice') ? ranked(data, tab) : [];
  /** Head-to-head pairs, most games together first. */
  $: rivals = (data?.headToHead ?? [])
    .slice()
    .sort((x, y) => y.aWins + y.bWins + y.ties - (x.aWins + x.bWins + x.ties) || personName(x.a).localeCompare(personName(y.a)));

  const when = (ms: number) =>
    new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const difficultyLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;

  function close() {
    dispatch('close');
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="stats-title">
  <button class="overlay-dismiss" type="button" aria-label="Close stats" on:click={close}></button>
  <div class="sheet stats">
    <header>
      <h3 id="stats-title">Stats</h3>
      <button class="close" type="button" aria-label="Close stats" on:click={close}><Icon name="close" /></button>
    </header>

    <div class="segmented" role="tablist" aria-label="Which stats">
      {#each tabs as t}
        <button type="button" role="tab" class:active={tab === t.value} aria-selected={tab === t.value} on:click={() => (tab = t.value)}>
          {t.label}
        </button>
      {/each}
    </div>

    {#if failed}
      <p class="note">Stats aren't available right now.</p>
    {:else if !data}
      <p class="note">Loading…</p>
    {:else if tab === 'recent'}
      {#if !data.recent.length}
        <p class="note">No games yet. Finish a game and it'll appear here.</p>
      {:else}
        <ol class="games">
          {#each data.recent as game (game.id)}
            {@const winner = game.players.find((p) => p.place === 1)}
            <li>
              <div class="game-head">
                <span class="when">{when(game.endedAt)}</span>
                {#if game.kind === 'practice'}<span class="tag">Practice</span>{/if}
                {#if game.botDifficulty}<span class="tag">{difficultyLabel[game.botDifficulty]} computer</span>{/if}
              </div>
              {#if winner}
                <p class="winner"><Icon name="trophy" size={16} /> <strong>{winner.name}</strong> won · first to {game.winningScore} · {game.rounds} {game.rounds === 1 ? 'round' : 'rounds'}</p>
              {/if}
              <ul class="scores">
                {#each game.players as p}
                  <li class:first={p.place === 1}>
                    {#if picture(p)}<img src={picture(p)} alt="" />{/if}
                    {p.name} <span class="num">{p.score}</span>
                  </li>
                {/each}
              </ul>
            </li>
          {/each}
        </ol>
      {/if}
    {:else if tab === 'rivals'}
      {#if !rivals.length}
        <p class="note">Head-to-head records appear once two family members have finished a game together.</p>
      {:else}
        <p class="note small">Who finished higher in the family games they played together.</p>
        <ol class="rivals">
          {#each rivals as r (r.a + r.b)}
            <li>
              <span class="side" class:leads={r.aWins > r.bWins}>
                <img src={personPicture(r.a)} alt="" />
                <span>{personName(r.a)}</span>
              </span>
              <span class="score num">{r.aWins} – {r.bWins}</span>
              <span class="side right" class:leads={r.bWins > r.aWins}>
                <span>{personName(r.b)}</span>
                <img src={personPicture(r.b)} alt="" />
              </span>
              {#if r.ties}<span class="ties">{r.ties} {r.ties === 1 ? 'tie' : 'ties'}</span>{/if}
            </li>
          {/each}
        </ol>
      {/if}
    {:else if !rows.length}
      <p class="note">
        {tab === 'practice' ? 'No practice games yet. Play on your own against the computer and they show up here.' : 'No family games yet. Finish a game and it shows up here.'}
      </p>
    {:else}
      <ol class="people">
        {#each rows as { key, s }, i (key)}
          {@const badges = badgesFor(s)}
          {@const usual = usualBid(s)}
          <li>
            <button type="button" class="person" aria-expanded={expanded === key} on:click={() => (expanded = expanded === key ? null : key)}>
              <span class="rank num">{i + 1}</span>
              <img src={personPicture(key)} alt="" />
              <span class="who">
                <strong>{personName(key)}</strong>
                <span class="sub">{s.wins} {s.wins === 1 ? 'win' : 'wins'} · {s.games} {s.games === 1 ? 'game' : 'games'}</span>
              </span>
              <span class="headline">
                <span class="big num">{pct(s.wins, s.games)}</span>
                <span class="sub">won</span>
              </span>
            </button>
            {#if badges.length || usual !== null}
              <ul class="badges" aria-label="Badges">
                {#each badges as b (b.id)}
                  <li class="badge {b.id}"><span aria-hidden="true">{BADGE_ICONS[b.id]}</span> {b.label}</li>
                {/each}
                {#if usual !== null}<li class="badge usual">Usually bids {usual}</li>{/if}
              </ul>
            {/if}
            {#if expanded === key}
              <ul class="explain">
                {#each badges as b (b.id)}
                  <li><strong>{BADGE_ICONS[b.id]} {b.label}:</strong> {b.detail}.</li>
                {:else}
                  <li>
                    {s.rounds < BADGE_MIN_ROUNDS
                      ? `Badges appear after ${BADGE_MIN_ROUNDS} rounds (${s.rounds} so far).`
                      : 'No badges yet: nothing they do much more than everyone else.'}
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</div>

<style>
  .stats {
    width: min(100%, 520px);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.8rem;
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
  /* Same look as the settings sheet's choices. */
  .segmented {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: #e4ebf2;
    margin-bottom: 0.9rem;
  }
  .segmented button {
    min-height: 40px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--ink-soft);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.1rem;
    line-height: 1.05;
    cursor: pointer;
  }
  .segmented button.active {
    background: var(--ink);
    color: var(--ice);
    box-shadow: 0 2px 6px rgba(14, 34, 53, 0.3);
  }
  .note {
    margin: 0.5rem 0;
    color: var(--ink-soft);
  }
  .people,
  .games {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .people > li,
  .games > li {
    border-radius: 12px;
    background: white;
    box-shadow: inset 0 0 0 1px var(--paper-line);
  }
  .person {
    width: 100%;
    display: grid;
    grid-template-columns: 1.4rem 40px 1fr auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.7rem 0.5rem 0.5rem;
    border: 0;
    background: none;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }
  .rank {
    color: var(--ink-soft);
    text-align: center;
  }
  .person img {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid white;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .sub {
    color: var(--ink-soft);
    font-size: 0.88rem;
  }
  .headline {
    display: grid;
    justify-items: end;
    line-height: 1;
  }
  .big {
    font-size: 1.6rem;
  }
  .badges {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin: -0.15rem 0 0;
    /* Lined up under the name, past the rank and picture. */
    padding: 0 0.7rem 0.6rem calc(0.5rem + 1.4rem + 40px + 1.2rem);
  }
  .badge {
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    background: #fff1d6;
    color: #7a4b00;
    font-size: 0.82rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .badge.usual {
    background: #e4ebf2;
    color: var(--ink-soft);
  }
  .explain {
    margin: 0;
    padding: 0 0.9rem 0.8rem calc(0.5rem + 1.4rem + 40px + 1.2rem);
    display: grid;
    gap: 0.3rem;
    color: var(--ink-soft);
    font-size: 0.9rem;
    list-style: none;
  }
  .explain strong {
    color: var(--ink);
  }
  .note.small {
    margin-top: 0;
    font-size: 0.9rem;
  }
  .rivals {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .rivals li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.7rem;
    border-radius: 12px;
    background: white;
    box-shadow: inset 0 0 0 1px var(--paper-line);
  }
  .side {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    color: var(--ink-soft);
    font-weight: 600;
  }
  .side.right {
    justify-content: flex-end;
  }
  .side.leads {
    color: var(--ink);
    font-weight: 800;
  }
  .side span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .side img {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    object-fit: cover;
    flex: 0 0 auto;
  }
  .rivals .score {
    font-size: 1.3rem;
    white-space: nowrap;
    text-align: center;
  }
  .ties {
    grid-column: 1 / -1;
    justify-self: center;
    margin-top: -0.3rem;
    color: var(--ink-soft);
    font-size: 0.8rem;
  }
  /* Narrow phones: less indent for the badges, and names without pictures in Rivals so they fit. */
  @media (max-width: 420px) {
    .badges,
    .explain {
      padding-left: 0.8rem;
    }
    .side img {
      display: none;
    }
  }
  .games > li {
    padding: 0.6rem 0.8rem;
  }
  .game-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .when {
    font-weight: 700;
  }
  .tag {
    padding: 0.05rem 0.5rem;
    border-radius: 999px;
    background: var(--paper-line);
    color: var(--ink-soft);
    font-size: 0.8rem;
    font-weight: 700;
  }
  .winner {
    margin: 0.3rem 0;
    color: var(--ink-soft);
  }
  .winner :global(svg) {
    vertical-align: -2px;
    color: #a87800;
  }
  .winner strong {
    color: var(--ink);
  }
  .scores {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.8rem;
  }
  .scores li {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--ink-soft);
  }
  .scores li.first {
    color: var(--ink);
    font-weight: 700;
  }
  .scores img {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    object-fit: cover;
  }
</style>
