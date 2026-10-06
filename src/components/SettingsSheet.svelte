<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { gameState, roomId } from '../store';
  import { socket } from '../socket';
  import { fxVolume, musicVolume, turnFlash, textSize } from '../utils/prefs';
  import Icon from './ui/Icon.svelte';
  import type { GameSpeed } from '../../shared/types';

  /** 'lobby' shows the target score and "clear seats"; 'game' shows "end game". */
  export let context: 'lobby' | 'game';

  const dispatch = createEventDispatcher<{ close: void }>();
  const speeds: { value: GameSpeed; label: string }[] = [
    { value: 'slow', label: 'Relaxed' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Quick' }
  ];
  const textSizes = [
    { value: 'standard', label: 'Standard', preview: '1em' },
    { value: 'large', label: 'Large', preview: '1.12em' },
    { value: 'largest', label: 'Largest', preview: '1.25em' }
  ] as const;
  let confirmingDanger = false;

  $: speed = $gameState?.gameSpeed ?? 'normal';
  $: target = $gameState?.winningScore ?? 5;

  function close() {
    dispatch('close');
  }
  function setSpeed(value: GameSpeed) {
    socket.emit('set_game_speed', { roomId: $roomId, gameSpeed: value });
  }
  function setTarget(value: number) {
    socket.emit('set_winning_score', { roomId: $roomId, winningScore: value });
  }
  function runDangerAction() {
    if (!confirmingDanger) {
      confirmingDanger = true;
      return;
    }
    if (context === 'lobby') socket.emit('reset_lobby', { roomId: $roomId });
    else socket.emit('cancel_game', { roomId: $roomId });
    close();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
  <button class="overlay-dismiss" type="button" aria-label="Close settings" on:click={close}></button>
  <div class="sheet settings">
    <header>
      <h3 id="settings-title">Settings</h3>
      <button class="close" type="button" aria-label="Close settings" on:click={close}>
        <Icon name="close" />
      </button>
    </header>

    {#if context === 'lobby'}
      <fieldset>
        <legend>Points to win</legend>
        <div class="segmented five">
          {#each [1, 2, 3, 4, 5] as score}
            <button type="button" class:active={target === score} aria-pressed={target === score} on:click={() => setTarget(score)}>
              {score}
            </button>
          {/each}
        </div>
      </fieldset>
    {/if}

    <fieldset>
      <legend>Game pace <span class="hint">for everyone at the table</span></legend>
      <div class="segmented">
        {#each speeds as s}
          <button type="button" class:active={speed === s.value} aria-pressed={speed === s.value} on:click={() => setSpeed(s.value)}>
            {s.label}
          </button>
        {/each}
      </div>
    </fieldset>

    <fieldset>
      <legend>Text size <span class="hint">on this device</span></legend>
      <div class="segmented">
        {#each textSizes as t}
          <button type="button" class:active={$textSize === t.value} aria-pressed={$textSize === t.value} on:click={() => ($textSize = t.value)}>
            <span style="font-size: {t.preview}">{t.label}</span>
          </button>
        {/each}
      </div>
    </fieldset>

    <fieldset>
      <legend>On this device</legend>
      <label class="slider">
        <span>Sound effects</span>
        <input type="range" min="0" max="100" step="5" bind:value={$fxVolume} />
        <output class="num">{$fxVolume}%</output>
      </label>
      <label class="slider">
        <span>Music</span>
        <input type="range" min="0" max="100" step="5" bind:value={$musicVolume} />
        <output class="num">{$musicVolume}%</output>
      </label>
      <label class="toggle">
        <span>Flash the screen edge when it's my turn</span>
        <input type="checkbox" bind:checked={$turnFlash} />
        <span class="switch" aria-hidden="true"></span>
      </label>
    </fieldset>

    <div class="danger">
      <button type="button" class="btn btn-danger btn-block" on:click={runDangerAction}>
        {#if confirmingDanger}
          {context === 'lobby' ? 'Tap again to clear every seat' : 'Tap again to end the game for everyone'}
        {:else}
          {context === 'lobby' ? 'Clear all seats' : 'End game'}
        {/if}
      </button>
    </div>
  </div>
</div>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
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
  fieldset {
    border: 0;
    margin: 0;
    padding: 0.9rem 0;
    border-top: 1px solid var(--paper-line);
  }
  legend {
    float: left;
    width: 100%;
    margin-bottom: 0.6rem;
    font-weight: 700;
    color: var(--ink);
  }
  .hint {
    font-weight: 400;
    color: var(--ink-soft);
    font-size: 0.875rem;
    margin-left: 0.25rem;
  }
  .segmented {
    clear: both;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: #e4ebf2;
  }
  .segmented.five {
    grid-template-columns: repeat(5, 1fr);
  }
  .segmented button {
    min-height: 40px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--ink-soft);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.15rem;
    cursor: pointer;
  }
  .segmented button.active {
    background: var(--ink);
    color: var(--ice);
    box-shadow: 0 2px 6px rgba(14, 34, 53, 0.3);
  }
  .slider {
    clear: both;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas: 'label value' 'range range';
    align-items: center;
    gap: 0.1rem 0.75rem;
    padding: 0.3rem 0;
    color: var(--ink);
  }
  .slider span {
    grid-area: label;
  }
  .slider input {
    grid-area: range;
    min-height: 32px;
  }
  .slider output {
    grid-area: value;
  }
  .slider output {
    text-align: right;
    color: var(--ink-soft);
    font-size: 1.05rem;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--ink);
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 48px;
    color: var(--ink);
    cursor: pointer;
    position: relative;
  }
  .toggle input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .switch {
    flex: 0 0 auto;
    width: 46px;
    height: 28px;
    border-radius: 999px;
    background: #c4d0dc;
    position: relative;
    transition: background-color 160ms;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform 160ms var(--ease-out);
  }
  .toggle input:checked + .switch {
    background: var(--ink);
  }
  .toggle input:checked + .switch::after {
    transform: translateX(18px);
  }
  .toggle input:focus-visible + .switch {
    outline: 3px solid var(--ice-strong);
    outline-offset: 2px;
  }
  .danger {
    padding-top: 0.9rem;
    border-top: 1px solid var(--paper-line);
  }
</style>
