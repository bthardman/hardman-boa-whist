<script lang="ts">
  // Lobby sheet for adding / removing computer players and choosing how well they play.
  import { createEventDispatcher } from 'svelte';
  import { gameState, roomId } from '../store';
  import { socket } from '../socket';
  import { MAX_PLAYERS } from '../../shared/types';
  import type { BotDifficulty, Player } from '../../shared/types';
  import { displayName, isSeated } from '../../shared/players';
  import { getPlayerAvatarUrl } from '../avatarUtils';
  import Icon from './ui/Icon.svelte';

  const dispatch = createEventDispatcher<{ close: void }>();
  const difficulties: { value: BotDifficulty; label: string; hint: string }[] = [
    { value: 'easy', label: 'Easy', hint: 'Plays by rules of thumb and makes the odd slip.' },
    { value: 'medium', label: 'Medium', hint: 'Looks ahead a little before each bid and card.' },
    { value: 'hard', label: 'Hard', hint: 'Thinks through hundreds of possible deals every move.' }
  ];

  $: players = $gameState?.players ?? [];
  $: bots = players.filter((p) => p.isBot);
  $: full = players.filter(isSeated).length >= MAX_PLAYERS;
  $: difficulty = $gameState?.botDifficulty ?? 'medium';
  $: hint = difficulties.find((d) => d.value === difficulty)?.hint ?? '';

  function close() {
    dispatch('close');
  }
  function addBot() {
    if (!full) socket.emit('add_bot', { roomId: $roomId });
  }
  function removeBot(bot: Player) {
    socket.emit('remove_bot', { roomId: $roomId, playerId: bot.playerId });
  }
  function setDifficulty(value: BotDifficulty) {
    if (value !== difficulty) socket.emit('set_bot_difficulty', { roomId: $roomId, difficulty: value });
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="bots-title">
  <button class="overlay-dismiss" type="button" aria-label="Close" on:click={close}></button>
  <div class="sheet bots">
    <header>
      <h3 id="bots-title">Computer players</h3>
      <button class="close" type="button" aria-label="Close" on:click={close}><Icon name="close" /></button>
    </header>
    <p class="intro">Playing on your own? Your game against the computer is private, so the family table stays free.</p>

    <ul class="bot-list">
      {#each bots as bot (bot.playerId)}
        <li class="bot-chip">
          <img src={getPlayerAvatarUrl(bot)} alt="" />
          <span>{displayName(bot)}</span>
          <button type="button" class="bot-remove" aria-label="Remove {displayName(bot)}" on:click={() => removeBot(bot)}>
            <Icon name="close" size={16} />
          </button>
        </li>
      {/each}
      <li>
        <button type="button" class="bot-add" disabled={full} on:click={addBot}>
          <Icon name="plus" size={18} /> Add
        </button>
      </li>
    </ul>
    {#if full}<p class="note">The table is full ({MAX_PLAYERS} players).</p>{/if}

    <fieldset>
      <legend>How well they play</legend>
      <div class="segmented">
        {#each difficulties as d}
          <button type="button" class:active={difficulty === d.value} aria-pressed={difficulty === d.value} on:click={() => setDifficulty(d.value)}>
            {d.label}
          </button>
        {/each}
      </div>
      <p class="note">{hint}</p>
    </fieldset>

    <button type="button" class="btn btn-primary btn-block done" on:click={close}>Done</button>
  </div>
</div>

<style>
  header {
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
  .intro {
    margin: 0.4rem 0 1rem;
    color: var(--ink-soft);
  }
  .bot-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .bot-chip {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 4px;
    border-radius: 999px;
    background: white;
    box-shadow: inset 0 0 0 1px var(--paper-line);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.1rem;
  }
  .bot-chip img {
    width: 34px;
    height: 34px;
    border-radius: 50%;
  }
  .bot-remove {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .bot-remove:hover {
    background: var(--paper-line);
    color: var(--ink);
  }
  .bot-add {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    height: 42px;
    padding: 0 1rem 0 0.8rem;
    border: 1.5px dashed var(--ink-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--ink);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.1rem;
    cursor: pointer;
  }
  .bot-add:disabled {
    opacity: 0.4;
    cursor: default;
  }
  fieldset {
    margin: 1.2rem 0 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 0.5rem;
    font-weight: 700;
  }
  .segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 4px;
    border-radius: 14px;
    background: var(--paper-line);
  }
  .segmented button {
    min-height: 44px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--ink-soft);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.1rem;
    cursor: pointer;
  }
  .segmented button.active {
    background: white;
    color: var(--ink);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  }
  .note {
    margin: 0.5rem 0 0;
    color: var(--ink-soft);
    font-size: 0.92rem;
  }
  .done {
    margin-top: 1.3rem;
  }
</style>
